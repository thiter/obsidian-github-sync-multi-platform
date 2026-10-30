import test from "node:test";
import assert from "node:assert/strict";

import { isMassDeletion } from "../src/lib/fs";
import { isPathBlocked, isWhitelistedHiddenPath, MAX_FILE_SIZE } from "../src/lib/storage";
import { computeGitBlobSha } from "../src/lib/helps";

test("熔断算法测试 (isMassDeletion) - 绝对数量门限", () => {
  // 待删除数量 >= 5 时必须严格熔断
  assert.equal(isMassDeletion(5, 100), true, "删除 5 个应该触发熔断");
  assert.equal(isMassDeletion(10, 100), true, "删除 10 个应该触发熔断");
  assert.equal(isMassDeletion(50, 50), true, "整库删除必须触发熔断");
});

test("熔断算法测试 (isMassDeletion) - 相对比例门限 (>= 30% 且 >= 2)", () => {
  // 总跟踪数 10，删除 3 (30%) -> 必须熔断
  assert.equal(isMassDeletion(3, 10), true, "10个删3个(30%)应该触发熔断");
  // 总跟踪数 10，删除 4 (40%) -> 必须熔断
  assert.equal(isMassDeletion(4, 10), true, "10个删4个(40%)应该触发熔断");
  // 总跟踪数 10，删除 2 (20%) -> 未达到 30%，放行
  assert.equal(isMassDeletion(2, 10), false, "10个删2个(20%)不应触发熔断");
  // 总跟踪数 10，删除 1 (10%) -> 放行
  assert.equal(isMassDeletion(1, 10), false, "10个删1个不应触发熔断");
});

test("熔断算法测试 (isMassDeletion) - 正常小规模修改放行", () => {
  // 日常正常单文件删除，不打扰用户
  assert.equal(isMassDeletion(1, 100), false, "正常单文件删除不应误报熔断");
  assert.equal(isMassDeletion(2, 50), false, "正常删除2个不应误报熔断");
  assert.equal(isMassDeletion(0, 100), false, "0个删除绝不应触发熔断");
});

test("路径安全过滤 - 危险黑名单目录与文件必须绝对拦截", () => {
  const dangerousPaths = [
    ".git/config",
    ".git/HEAD",
    ".obsidian/workspace.json",
    ".obsidian/plugins/sync/data.json",
    ".trash/deleted_note.md",
    ".DS_Store",
    "folder/.DS_Store",
    "sub/Thumbs.db",
  ];

  for (const path of dangerousPaths) {
    assert.equal(isPathBlocked(path), true, `危险路径 ${path} 必须被阻止`);
  }
});

test("路径安全过滤 - 正常笔记与白名单目录必须正常放行", () => {
  const safePaths = [
    "Tech/Docker.md",
    "Daily/2026-10-30.md",
    "Notes/Overview.md",
    "Assets/image.png",
  ];

  for (const path of safePaths) {
    assert.equal(isPathBlocked(path), false, `正常路径 ${path} 不能被阻止`);
  }

  // 白名单目录 .github 必须被允许
  assert.equal(isWhitelistedHiddenPath(".github/workflows/mirror-code.yml"), true, ".github 白名单文件必须允许");
  assert.equal(isWhitelistedHiddenPath(".obsidian/app.json"), false, ".obsidian 非白名单隐藏文件必须阻止");
});

test("大文件限制守卫", () => {
  assert.equal(MAX_FILE_SIZE, 10 * 1024 * 1024, "最大同步文件大小必须为 10MB");
});

test("Git Blob SHA-1 规范计算验证", async () => {
  // Git 规范测试："hello\n"
  // 在 bash 中执行: printf "hello\n" | git hash-object --stdin -> 输出 ce013625030ba8dba906f756967f9e9ca394464a
  const sha = await computeGitBlobSha("hello\n");
  assert.equal(sha, "ce013625030ba8dba906f756967f9e9ca394464a", "Git Blob SHA 必须与原生 git hash-object 完全一致");

  // 空文件测试：
  // 标准 Git 空对象 SHA: e69de29bb2d1d6434b8b29ae775ad8c2e48c5391
  const emptySha = await computeGitBlobSha("");
  assert.equal(emptySha, "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391", "空文件 Git SHA 必须正确");
});
