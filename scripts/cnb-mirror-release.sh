#!/usr/bin/env bash
#
# 把一次 GitHub Release 镜像到 CNB 仓库：创建同名 Release + 上传同样的附件。
# 幂等：同名 tag 的 Release 已存在时复用，附件用 overwrite 覆盖。
#
# 必填环境变量：
#   CNB_TOKEN   CNB 访问令牌（需 repo-release:rw，部署令牌即可）
#   CNB_SLUG    仓库路径，如 weiguanghui/chunmiao/obsidian-github-sync-multi-platform-cnb
#   TAG         版本号（同时也是 Release 的 tag_name）
# 可选环境变量：
#   BODY        Release 描述（默认空）
#   PRERELEASE  true / false（默认 false）
#   FILES       空格分隔的附件列表（默认 main.js manifest.json styles.css + 同目录 zip）
#   CNB_API_ENDPOINT  默认 https://api.cnb.cool
set -euo pipefail

if [ -z "${CNB_TOKEN:-}" ]; then
  echo "==> 未配置 CNB_TOKEN，跳过 CNB 镜像（不影响 GitHub 主发布）"
  exit 0
fi
: "${CNB_SLUG:?缺少 CNB_SLUG}"
: "${TAG:?缺少 TAG}"

API="${CNB_API_ENDPOINT:-https://api.cnb.cool}"
BODY="${BODY:-}"
PRERELEASE="${PRERELEASE:-false}"
MAKE_LATEST="${MAKE_LATEST:-}"

AUTH=(-H "Authorization: Bearer ${CNB_TOKEN}" -H "Accept: application/vnd.cnb.api+json")

# 从 stdin 的 JSON 里取一个字段
jget() { python3 -c "import sys,json;d=json.load(sys.stdin);v=d.get('$1','');print('' if v is None else v)"; }

echo "==> CNB 镜像：${CNB_SLUG} tag=${TAG}"

# 1) 幂等：查同名 tag 的 release 是否已存在
EXISTING="$(curl -s "${AUTH[@]}" "${API}/${CNB_SLUG}/-/releases/tags/${TAG}" || true)"
RID="$(printf '%s' "$EXISTING" | jget id 2>/dev/null || true)"

if [ -n "$RID" ]; then
  echo "==> Release 已存在，复用 id=${RID}"
else
  echo "==> 创建 Release ..."
  PAYLOAD="$(TAG="$TAG" BODY="$BODY" PRE="$PRERELEASE" python3 -c '
import json, os
print(json.dumps({
    "tag_name": os.environ["TAG"],
    "target_commitish": os.environ["TAG"],
    "name": os.environ["TAG"],
    "body": os.environ.get("BODY", ""),
    "prerelease": os.environ.get("PRE", "false").lower() == "true",
    "draft": False,
}, ensure_ascii=False))
')"
  CREATED="$(curl -s -X POST "${AUTH[@]}" -H "Content-Type: application/json" -d "$PAYLOAD" "${API}/${CNB_SLUG}/-/releases")"
  RID="$(printf '%s' "$CREATED" | jget id 2>/dev/null || true)"
  if [ -z "$RID" ]; then
    echo "!! 创建 Release 失败：$CREATED" >&2
    exit 1
  fi
  echo "==> 已创建 Release id=${RID}"
fi

# 2) 确定附件列表
if [ -z "${FILES:-}" ]; then
  FILES="main.js manifest.json styles.css"
  for z in *"${TAG}"*.zip; do
    [ -f "$z" ] && FILES="$FILES $z"
  done
fi

# 3) 逐个上传附件（取上传地址 -> PUT -> 确认）
for f in $FILES; do
  if [ ! -f "$f" ]; then
    echo "--> 跳过不存在的文件：$f"
    continue
  fi
  name="$(basename "$f")"
  size="$(wc -c < "$f" | tr -d ' ')"
  echo "--> 上传 ${name} (${size} bytes) ..."

  URLS="$(curl -s -X POST "${AUTH[@]}" -H "Content-Type: application/json" \
    -d "{\"asset_name\":\"${name}\",\"size\":${size},\"overwrite\":true}" \
    "${API}/${CNB_SLUG}/-/releases/${RID}/asset-upload-url")"

  UPLOAD_URL="$(printf '%s' "$URLS" | jget upload_url 2>/dev/null || true)"
  VERIFY_URL="$(printf '%s' "$URLS" | jget verify_url 2>/dev/null || true)"
  if [ -z "$UPLOAD_URL" ]; then
    echo "!! 获取上传地址失败：$URLS" >&2
    exit 1
  fi

  put_code="$(curl -s -o /dev/null -w '%{http_code}' -X PUT --upload-file "$f" "$UPLOAD_URL")"
  if [ "$put_code" != "200" ] && [ "$put_code" != "201" ]; then
    echo "!! 上传 ${name} 失败 HTTP ${put_code}" >&2
    exit 1
  fi

  conf_code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "${AUTH[@]}" "$VERIFY_URL")"
  if [ "$conf_code" != "200" ] && [ "$conf_code" != "201" ]; then
    echo "!! 确认 ${name} 失败 HTTP ${conf_code}" >&2
    exit 1
  fi
  echo "    完成 ${name}"
done

# 3.5) 标记为最新（MAKE_LATEST 未指定时：非预发布默认 true）
if [ -z "$MAKE_LATEST" ]; then
  if [ "$PRERELEASE" = "true" ]; then MAKE_LATEST="false"; else MAKE_LATEST="true"; fi
fi
if [ "$MAKE_LATEST" = "true" ]; then
  curl -s -o /dev/null -X PATCH "${AUTH[@]}" -H "Content-Type: application/json" \
    -d '{"make_latest":"true"}' "${API}/${CNB_SLUG}/-/releases/${RID}" || true
  echo "==> 已标记为最新版本"
fi

# 4) 回读确认
echo "==> 最终 Release 附件："
curl -s "${AUTH[@]}" "${API}/${CNB_SLUG}/-/releases/${RID}" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print('  id=%s tag=%s assets=%s'%(d.get('id'),d.get('tag_name'),[a.get('name') for a in (d.get('assets') or [])]))"

echo "==> 完成。下载页：https://cnb.cool/${CNB_SLUG}/-/releases/tag/${TAG}"
