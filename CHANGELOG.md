# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.9] - 2026-10-30

### 🛡️ 重大防灾与安全加固 (Critical Safety & Disaster Prevention)
- **“覆盖远端”核心语义重构（由 Mirror 切换为 Upsert 模式）**:
  - 彻底移除 `base_tree: null` 空基底树提交，改为基于远端父 Commit 的 `tree.sha` 进行补丁覆写。
  - **杜绝误删远端**：本地变动与新增笔记强制上传并覆盖远端同名文件，**本地没有但远端存在的文件百分之百安全保留**，彻底消灭“新设备/空目录清空远端仓库”的严重漏洞。
- **全链路零笔记安全守卫 (Zero-Note Guard)**:
  - 扫描本地有效文件为 0 时，直接阻断覆盖远端操作，绝不向 GitHub 提交空变更。
- **多端防灾安全熔断引擎 (Circuit Breaker)**:
  - 在双向同步中引入批量删除安全门限：待删除文件数 $\ge 5$ 篇或占比 $\ge 30\%$ 时，**严禁静默删除**，强制弹出阻塞式告警弹窗。
  - **默认 Fail-Safe 原则**：用户未明确确认或关闭弹窗时，**默认不删除任何本地或远端文件**，彻底切断“单端清空 $\to$ 全网多端级联删除雪崩”的惨剧。
- **本地强制软删除保护 (Trash Protection)**:
  - 将所有本地删除操作全面升级为 **`vault.trash(file, true)`**，删除的文件强制进入系统废纸篓或 `.trash` 文件夹，确保物理可逆与一键放回。
- **高危操作二次防误触确认**:
  - 为命令面板中的 `同步全部笔记(覆盖远端)` 增加红色高危确认弹窗；
  - 为删除包含 $\ge 5$ 个子文件的文件夹增加二次确认保护。
- **覆盖本地防缩水熔断**:
  - 强制全量覆盖本地（`forcePull`）时，若检测到远端有效文件为 0 或相比本地缩水超过 70%，强制阻断清空本地。

### ⚡ 双向同步全面升级与 API 额度防限流优化 (Performance & Anti-Throttling)
- **双向同步升级为 Git Tree 原子批量提交引擎**:
  - 彻底废除以往双向同步中对每个修改/删除文件逐一调用 Contents API（`PUT` / `DELETE`）的旧循环逻辑。
  - 所有待上传的变动与待删除的文件统一打包为单次 Git Tree，**仅生成 1 个原子 Commit 提交**！
  - **彻底消灭 HTTP 403 Secondary Rate Limit**（次要高频写入限流）与 **409 Conflict**（HEAD 指针竞争冲突）。
  - 同步 50 篇笔记的 API 请求次数由以往的 50+ 次**骤降为 2~3 次**，节约 95% 以上的 GitHub 免费额度。
- **文件夹删除批量提交优化**:
  - 本地删除大文件夹时，使用 Git Data API 挂载 `sha: null` 单次原子提交删除，杜绝循环并发 API 洪峰。

### 🧪 工程质量与本地安全门禁 (Local Quality Gate)
- **内置纯本地极速安全测试套件**:
  - 复用项目已有的 `esbuild` 与 Node.js 22 内置原生测试框架（`node:test`），**0 新增外部 npm 依赖，0 云端 GitHub Actions 资源消耗**。
  - 新增 `npm run check` 质检命令：TypeScript 静态类型检查 + 7 项核心防灾自动化测试（熔断算法、路径黑白名单、Git Blob SHA 校验等），仅需 **70 毫秒** 极速跑通！

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
