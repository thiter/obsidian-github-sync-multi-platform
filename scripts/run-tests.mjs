import * as esbuild from "esbuild";
import { spawn } from "node:child_process";
import { rm, mkdir } from "node:fs/promises";
import path from "node:path";

const TMP_DIR = path.resolve(".tmp-test");
const TEST_BUNDLE = path.join(TMP_DIR, "safety.test.mjs");

async function main() {
  await rm(TMP_DIR, { recursive: true, force: true });
  await mkdir(TMP_DIR, { recursive: true });

  // 1. 使用已安装的 esbuild 极速编译并 mock obsidian 模块
  await esbuild.build({
    entryPoints: ["tests/safety.test.ts"],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: TEST_BUNDLE,
    alias: {
      obsidian: path.resolve("tests/mocks/obsidian.ts"),
    },
    external: ["node:*"],
    logLevel: "error",
  });

  // 2. 调用 Node.js 原生测试套件执行
  const child = spawn(process.execPath, ["--test", TEST_BUNDLE], {
    stdio: "inherit",
  });

  child.on("close", async (code) => {
    await rm(TMP_DIR, { recursive: true, force: true });
    process.exit(code || 0);
  });
}

main().catch(async (err) => {
  console.error("Test runner failed:", err);
  await rm(TMP_DIR, { recursive: true, force: true });
  process.exit(1);
});
