# Antigravity IDE 兼容性与开发指南

为了让 **Antigravity IDE** (AI 原生开发环境) 能更好地理解本项目并提供辅助，我们遵循以下开发准则。

## 1. 结构化代码库
- **扁平化逻辑**：避免过深的类继承。核心同步逻辑位于 `src/lib/sync/` 目录下，按功能细分为 `conflict.ts`, `api.ts`, `state.ts`。
- **显式接口声明**：为所有 API 请求和响应数据结构定义 `interface` 或 `type`。

## 2. 文档作为代码
- **README 优先**：每个子目录应包含简短的 `README.md`，解释该模块在同步生命周期中的位置。
- **代码注释规范**：使用标准 JSDoc。AI 能基于这些注释生成更准确的代码片段。
  ```typescript
  /**
   * 推送文件到 GitHub 仓库
   * @param path 文件相对于库根目录的路径
   * @param content 笔记内容（Markdown 字符串）
   * @param localSha 本地记录的文件 SHA，用于并发控制
   * @throws {ConflictError} 当远端 SHA 与本地记录不匹配时抛出
   */
  async pushFile(path: string, content: string, localSha?: string): Promise<string>
  ```

## 3. 测试驱动 AI (TDAI)
- 在 Antigravity 中，你可以先写测试用例（如 `sync.test.ts`），然后要求 AI 填充实现代码。这种方式比直接写逻辑更能保证同步逻辑的正确性。

## 4. 为什么 GitHub API 方案更适合 Antigravity 用户？
- **数据透明**：Antigravity IDE 也可以直接打开你的 GitHub 仓库文件夹。这意味着你可以一边在 Obsidian 笔记，一边在 Antigravity 中利用 AI 分析你的笔记，而它们都共用同一个云端数据源。
- **无状态后端**：由于没有复杂的 Node.js 后端，AI 只需关注插件代码，大大降低了开发和调试的复杂度。

## 5. 推荐的 AI 指令 (Prompt 示例)
在 Antigravity 中，你可以使用如下指令：
- *"根据 `ARCHITECT.md` 中的 4.1 节逻辑，在 `src/lib/github-api.ts` 中实现 `pushFile` 方法。"*
- *"参考 `obsidian-github-sync-multi-platform` 的文件监听器代码，将其适配到 GitHub API 的推送逻辑中。"*
