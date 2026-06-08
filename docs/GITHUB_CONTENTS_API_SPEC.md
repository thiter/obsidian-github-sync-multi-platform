# GitHub REST API — Repository Contents

> 📌 来源：[REST API endpoints for repository contents](https://docs.github.com/en/rest/repos/contents?apiVersion=2022-11-28)  
> 🕐 存档时间：2026-06-08 · API Version: 2022-11-28  
> ⚠️ 本文件为官方文档本地副本，供开发时快速查阅。

---

## 快速参考：状态码速查表

| 接口 | 方法 | 成功 | 冲突 | 验证失败 | 未找到 |
|------|------|------|------|---------|--------|
| 获取文件 | GET | 200 | — | — | 404 |
| 创建/更新文件 | PUT | 201(创建) / 200(更新) | **409** | **422** | 404 |
| 删除文件 | DELETE | 200 | **409** | **422** | 404 |

> [!IMPORTANT]
> **PUT 422 的触发条件（本项目最常见的坑）**：
> 1. `committer.name` 或 `committer.email` 缺失时返回 422
> 2. "Validation failed, or the endpoint has been spammed"（API 被刷）
> 3. **文件已存在但未提供 `sha`** — 部分情况下 GitHub 返回 422 而非 409

---

## 1. 获取文件内容

```
GET /repos/{owner}/{repo}/contents/{path}
```

### 文件大小限制

| 文件大小 | 支持情况 |
|---------|---------|
| ≤ 1 MB | 完整支持，`content` 字段包含 Base64 内容 |
| 1 MB ~ 100 MB | `content` 字段为**空字符串**，`encoding` 为 `"none"`，需通过 `download_url` 下载 |
| > 100 MB | **不支持此接口**，需使用 Git Trees API |

### 查询参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `owner` | string | ✅ | 仓库所有者（大小写不敏感） |
| `repo` | string | ✅ | 仓库名（不含 .git） |
| `path` | string | ✅ | 文件路径 |
| `ref` | string | ❌ | 分支/tag/commit，默认为默认分支 |

### 响应状态码

| 状态码 | 含义 |
|--------|------|
| **200** | 成功 |
| **302** | 重定向 |
| **304** | 未修改（缓存） |
| **403** | 禁止访问 |
| **404** | 文件不存在 |

### 响应体关键字段（文件类型）

```json
{
  "type": "file",
  "encoding": "base64",
  "size": 1234,
  "name": "README.md",
  "path": "README.md",
  "sha": "abc123...",          // ← 更新/删除时需要此字段
  "content": "SGVsbG8...",    // Base64 编码内容（>1MB 时为空字符串）
  "download_url": "https://...", // 直接下载链接（>1MB 时使用）
  "url": "https://api.github.com/repos/..."
}
```

---

## 2. 创建或更新文件内容（核心接口）

```
PUT /repos/{owner}/{repo}/contents/{path}
```

> [!NOTE]
> 创建新文件和更新已有文件使用**同一个接口**，区别在于是否传 `sha`。

### 请求体参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `message` | string | ✅ | commit 提交信息 |
| `content` | string | ✅ | **Base64 编码**的文件内容 |
| `sha` | string | ⚠️ | **更新已有文件时必填**，传文件当前的 blob SHA |
| `branch` | string | ❌ | 目标分支，默认为默认分支 |
| `committer.name` | string | ❌* | committer 姓名（缺失时用认证用户信息；若提供 committer 对象则必填，否则 422） |
| `committer.email` | string | ❌* | committer 邮箱（同上） |

### 响应状态码

| 状态码 | 含义 | 处理方案 |
|--------|------|---------|
| **201** | 文件**创建**成功 | 保存返回的 `content.sha` |
| **200** | 文件**更新**成功 | 保存返回的 `content.sha` |
| **404** | 仓库或分支不存在 | 检查配置 |
| **409** | SHA 冲突（`sha` 字段值过期） | 重新 GET 获取最新 sha 后重试 |
| **422** | 验证失败或被限速 | 见下方详细说明 |

### ⚠️ 422 详细原因（重要）

```
422 = "Validation failed, or the endpoint has been spammed."
```

触发 422 的已知场景：
1. **文件已存在，未传 `sha`**（有时 GitHub 返回 422 而非 409）
2. `committer` 对象提供了但 `name` 或 `email` 为空
3. API 请求频率过高被限速
4. `content` 字段不是合法的 Base64 字符串
5. `branch` 分支不存在

**本项目的处理策略**：对 409 和 422 均执行相同的"重新 GET sha 后重试"逻辑。

### 请求示例

**创建新文件：**
```bash
curl -X PUT https://api.github.com/repos/OWNER/REPO/contents/path/to/file.md \
  -H "Authorization: Bearer TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -d '{
    "message": "create file",
    "content": "SGVsbG8gV29ybGQ="
  }'
```

**更新已有文件（必须带 sha）：**
```bash
curl -X PUT https://api.github.com/repos/OWNER/REPO/contents/path/to/file.md \
  -H "Authorization: Bearer TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -d '{
    "message": "update file",
    "content": "SGVsbG8gV29ybGQ=",
    "sha": "abc123..."
  }'
```

### 响应体关键字段

```json
{
  "content": {
    "sha": "new_sha_after_update",  // ← 务必更新本地缓存
    "path": "path/to/file.md",
    "size": 1234
  },
  "commit": {
    "sha": "commit_sha",
    "message": "update file"
  }
}
```

---

## 3. 删除文件

```
DELETE /repos/{owner}/{repo}/contents/{path}
```

### 请求体参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `message` | string | ✅ | commit 提交信息 |
| `sha` | string | ✅ | 要删除文件的当前 blob SHA |
| `branch` | string | ❌ | 目标分支 |

### 响应状态码

| 状态码 | 含义 |
|--------|------|
| **200** | 删除成功（有响应体） |
| **404** | 文件不存在 |
| **409** | SHA 冲突 |
| **422** | 验证失败 |
| **503** | 服务不可用 |

> [!WARNING]
> 官方文档中 DELETE 成功**只返回 200**，不返回 204。但实践中偶有 204，代码中建议同时接受两者。

---

## 4. 路径编码规则

GitHub Contents API 的 `{path}` 参数遵循标准 URL 路径编码：

- **正确**：每个路径段单独编码，`/` 保留
  ```
  path/to/文件名.md  →  path/to/%E6%96%87%E4%BB%B6%E5%90%8D.md
  ```
- **错误**：整个路径一起编码，`/` 被编成 `%2F`
  ```
  path/to/文件名.md  →  path%2Fto%2F%E6%96%87%E4%BB%B6%E5%90%8D.md  ← 404
  ```

**本项目实现：**
```typescript
const encodedPath = path.split('/').map(encodeURIComponent).join('/');
```

---

## 5. 关键注意事项

### API 限速（Rate Limit）
- 认证用户：每小时 **5,000 次**请求
- 超出后返回 **403** 或 **429**
- 响应头 `X-RateLimit-Remaining` 可查看剩余次数

### 并发限制
> [!CAUTION]
> **不能并发**调用 `PUT`（创建/更新）和 `DELETE` 接口，必须串行执行，否则返回冲突错误。

### SHA 缓存策略
每次成功的 PUT 响应都会返回新的 `content.sha`，**必须立即更新本地缓存**，否则下次操作会触发 409/422。

```typescript
// 每次 PUT 成功后
const newSha = response.json.content.sha;
plugin.syncData.files[path] = { sha: newSha, lastSync: Date.now() };
await plugin.saveSyncData();
```

---

## 6. 本项目 github-api.ts 对照

| API 接口 | 对应函数 | 文件 |
|---------|---------|------|
| GET contents | `getFile()` | [github-api.ts](file:///opt/project/obsidian-github-sync-multi-platform/src/lib/github-api.ts) |
| PUT contents | `putFile()` + `_doPutRequest()` | [github-api.ts](file:///opt/project/obsidian-github-sync-multi-platform/src/lib/github-api.ts) |
| DELETE contents | `deleteFile()` | [github-api.ts](file:///opt/project/obsidian-github-sync-multi-platform/src/lib/github-api.ts) |
| GET tree | `getTree()` | [github-api.ts](file:///opt/project/obsidian-github-sync-multi-platform/src/lib/github-api.ts) |
