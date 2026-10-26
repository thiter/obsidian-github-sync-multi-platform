# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.8] - 2026-10-16

### 🚀 新功能 (Features)
- **覆盖本地强制初始化 (`同步全部笔记(覆盖本地/强制初始化)`)**:
  - 新增单向全量覆盖本地命令，专门解决移动端（iOS / Android）冷启动初始化、换新设备建库以及本地批量改名混乱后的“一键还原”需求。
  - 引入操作安全二次确认弹窗（[`ConfirmModal`](src/lib/modal.ts)），明确提示警告信息，防止用户误触覆盖未备份的本地笔记。
- **极速 Zipball 打包下载引擎**:
  - 引入超轻量纯 JS 解压库 `fflate`（约 8KB，无原生 Node 依赖，跨平台 iOS / Android / 桌面端高兼容）。
  - 通过 GitHub Zipball API（`GET /repos/{owner}/{repo}/zipball/{branch}`）**仅用 1 次 API 请求** 即可下载整库快照并在内存中完成高速解压与 Vault 覆写。
  - 相比以往逐个文件调用 `GET /contents` 遍历下载，下载 1000 篇笔记的 API 消耗**降低 99.9%**，极大节省 GitHub API 限制配额（5000 次/小时）。
  - 下载过程中自动排除 `.obsidian/` 配置目录、`.git/` 及系统隐藏文件，保护用户自定义插件与外观配置。

### ⚡ 架构重构与性能优化 (Performance & Architecture)
- **全面接入 Git Data API 批量提交引擎**:
  - [`GitHubClient`](src/lib/github-api.ts) 深度封装底层 Git 数据库接口：`createBlob`、`getRef`、`getCommit`、`createTree`、`createCommit`、`updateRef`，并提供高阶事务管道 `commitBatch`。
- **文件夹批量重命名/移动 0 内容上传**:
  - 重构 [`NoteRename`](src/lib/fs.ts) 文件夹分支：重命名或移动文件夹时，笔记内容未变，**直接复用现有 Git Blob SHA，无需重新上传任何文件内容**。
  - 所有旧路径打上 `sha: null`（删除），新路径挂载原 Blob SHA，数十上百个文件的移动变动合并在 **1 次 POST tree 请求** 中完成。
  - **彻底根治 409 Conflict 冲突风暴**：单次批量操作仅生成 **1 个原子 Commit**，杜绝以往连续多次修改分支 HEAD 引发的并发竞争与重试恶性循环。
  - 以移动包含 50 篇笔记的文件夹为例，API 请求数由 **100+ 次直降至 3~4 次**，同步耗时由数十秒缩短至 1~2 秒。
- **单文件重命名原子化**:
  - 单文件重命名不再拆分为独立的 `DELETE` 和 `PUT` 两个 Commit，合并为单次原子提交，彻底规避中途异常导致“旧文件已删新文件未建”的数据不一致风险。
- **全量覆盖远端 (`overrideRemoteAllFilesImpl`) 提交聚合**:
  - 全量推送到远端切换为单 Tree 单 Commit 批量打包提交，不再对每个文件逐一调用 `putFile`，Git 提交历史极度整洁。

### 🌐 国际化支持 (i18n)
- 补齐简体中文与英文的多语言翻译（命令名、二次确认弹窗、状态通知等）。

---

## [1.0.7] - 2026-10-10

### 优化与修复
- 优化全量双向同步，完善 3-Way 状态比对与一致性对齐。
- 合并社区 PR，优化空仓库判定与目录递归创建。
- 新增常见问题排查文档（FAQ）及繁体中文支持。

---

## [1.0.6] - 2026-06-08

### 优化与修复
- 修复并发调用 Contents API 造成的 409 / 422 同步报错与重试逻辑。
- 优化启动同步时序，避免 Obsidian 启动索引时触发并发同步被打限流。
- 规范英文文案首字母大小写（Sentence case），完全符合 Obsidian 官方插件审核准则。

---

## [1.0.5] - 2026-03-17

### 杂项
- 优化工作流与自动化构建触发条件。
- 更新并统一锁文件依赖版本。

---

## [1.0.2] - 2026-03-13

### 初始发布
- Obsidian-Github-Sync-Multi-Platform 首个正式可用版本。
- 支持全平台（Mac、Windows、Android、iOS）通过 GitHub API 实现无缝实时笔记同步。
