#!/usr/bin/env python3
"""从 CHANGELOG.md 提取指定版本的更新内容，用作 Release Notes。

用法:
    python3 scripts/extract-changelog.py 1.0.8

命中时把该版本章节正文（不含 "## [1.0.8] - 日期" 标题行）打印到 stdout 并退出 0；
未命中返回退出码 1，方便调用方回退到其它来源。
"""

from __future__ import annotations
import pathlib
import re
import sys


def extract(version: str, changelog: str = "CHANGELOG.md") -> str | None:
    path = pathlib.Path(changelog)
    if not path.exists():
        return None
    text = path.read_text(encoding="utf-8")

    # 整行消费掉标题（含后面的 " - 2026-10-16" 日期），避免日期漏进正文
    header = re.compile(
        r"^##\s*\[?v?" + re.escape(version) + r"\]?[^\n]*",
        re.MULTILINE,
    )
    match = header.search(text)
    if not match:
        return None

    rest = text[match.end():]
    # 下一个版本标题（## 开头）为止
    nxt = re.search(r"^##\s", rest, re.MULTILINE)
    body = rest[: nxt.start()] if nxt else rest

    # 去掉章节末尾的分隔线
    body = re.sub(r"\n-{3,}\s*$", "", body.strip())
    return body.strip() or None


def main() -> int:
    version = (sys.argv[1] if len(sys.argv) > 1 else "").lstrip("vV")
    if not version:
        print("用法: extract-changelog.py <version>", file=sys.stderr)
        return 2

    body = extract(version)
    if not body:
        print(f"CHANGELOG.md 中未找到版本 {version}", file=sys.stderr)
        return 1

    print(body)
    return 0


if __name__ == "__main__":
    sys.exit(main())
