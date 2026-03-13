# 实施方案：从 Fast-Note-Sync 到 Obsidian-Github-Sync-Multi-Platform

## 阶段一：环境准备 (Preparation)
1. **GitHub 权限配置**：
   - 生成 **Personal Access Token (PAT)**。
   - 权限需包含 `repo` (读写权限)。
2. **项目骨架搭建**：
   - 复制 `obsidian-github-sync-multi-platform-master` 为新项目。
   - 更新 `manifest.json`：修改 ID、名称和描述。
   - 删除 `src/lib/websocket.ts`，创建 `src/lib/github-api.ts`。

## 阶段二：核心库开发 (Core Development)
1. **实现 GitHub API 封装**：
   - 使用 `fetch` API 或 `Octokit`。
   - 实现核心接口：`getFile(path)`, `putFile(path, content, sha)`, `deleteFile(path, sha)`, `getLatestCommit()`.
2. **实现本地状态管理器 (State Manager)**：
   - 创建 `data.json` 结构，存储 `{ file_path: { sha: string, last_sync: number } }`.
3. **改造 `src/lib/fs.ts`**：
   - 将 `MsgSend("NoteModify", ...)` 替换为 `githubClient.putFile(...)`。
   - 实现重命名逻辑：`DELETE old_path` + `PUT new_path`。

## 阶段三：同步逻辑增强 (Sync Logic)
1. **初始化同步 (Init Sync)**：
   - 逻辑：对比本地所有文件与 GitHub 仓库内容，生成差异列表，逐个同步。
2. **防抖与队列处理**：
   - 参考原项目的 `messageQueue`，由于 GitHub API 有速率限制（Rate Limit），需实现一个任务队列，合并短时间内对同一文件的多次修改。
3. **附件同步 (Attachment Support)**：
   - 对非 MD 文件（如图片）采用二进制流处理。

## 阶段四：UI 与 配置界面 (UI & Config)
1. **更新 `setting.tsx`**：
   - 移除原来的 Server URL, Token 选项。
   - 添加：GitHub Repo (owner/repo), Branch (main/master), GitHub Token (Password 输入框)。
2. **增加同步状态栏**：
   - 在状态栏显示：`Last sync: 2 min ago`, `Status: OK`.

## 阶段五：Antigravity 特色优化 (AI-Native Optimization)
... (保持原有内容) ...

## 阶段六：Dashboard 与 统计系统 (Dashboard & Stats)
1. **静态站点搭建**：
   - 使用 Vite + React 创建简单的 Dashboard 项目。
   - 部署到 GitHub Pages。
2. **鉴权 UI 实现**：
   - 首页显示 GitHub PAT 输入框（Password 类型）。
   - 校验成功后缓存到 `localStorage`.
3. **字数统计算法**：
   - 逻辑：获取文件树 -> 遍历 `.md` 文件 -> Fetch 文件内容 -> 去除 Markdown 格式 -> 计算长度。
   - 汇总：按文件修改时间（`mtime`）归入对应的月份。
4. **可视化集成**：
   - 使用 `Chart.js` 或 `ECharts` 绘制折线/柱状图，展示过去 12 个月的字数增长趋势。

