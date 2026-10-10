# Github-Sync-Multi-Platform

[![GitHub release (latest by date)](https://img.shields.io/github/v/release/Zhang-cm/github-sync-multi-platform?style=flat-square)](https://github.com/Zhang-cm/github-sync-multi-platform/releases)
[![Downloads](https://img.shields.io/badge/dynamic/json?logo=obsidian&color=9437ff&label=downloads&query=github-sync-multi-platform.downloads&url=https%3A%2F%2Fraw.githubusercontent.com%2Fobsidianmd%2Fobsidian-releases%2Fmaster%2Fcommunity-plugin-stats.json&style=flat-square)](https://obsidian.md/plugins?id=github-sync-multi-platform)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)

[English](#english) | [繁體中文](#traditional-chinese) | [简体中文](#chinese)

---

<a name="english"></a>

## 🚀 Overview

**Github-Sync-Multi-Platform** is a high-performance, serverless synchronization solution. It leverages the GitHub REST API to provide seamless, real-time note synchronization across Desktop (Windows/macOS/Linux) and Mobile (iOS/Android) devices within your notes environment.

Unlike traditional Git-based plugins, this tool interacts directly with the GitHub API, eliminating the need for a local Git environment on mobile devices and providing a faster, more stable experience.

### ✨ Key Features

-   **Native Mobile Support**: Full compatibility with iOS and Android without requiring Git binaries.
-   **Real-time Auto-Sync**: Intelligent event listening triggers synchronization on file modification with a 5-second debounce to optimize API usage.
-   **Serverless Architecture**: No middle-man server required. Your data goes directly to your private GitHub repository.
-   **Conflict Resolution**: Built-in hash-based change detection to minimize sync conflicts.
-   **Multi-File Type Support**: Markdown synced as text; other Vault files like DOCX, XLSX, PDF, Canvas, JSON, images synced as binary (up to 10MB per file).
-   **Visual Dashboard**: Support for a web-based dashboard to visualize your writing progress and sync stats.

## 🛠 Tech Stack

-   **Core**: TypeScript, Plugin API.
-   **UI**: Vanilla CSS, native Obsidian setting controls.
-   **Network**: GitHub REST API (v3).
-   **Build**: esbuild for high-speed bundling.

## 📥 Installation

1.  Open **Settings** > **Community plugins**.
2.  Disable **Restricted mode**.
3.  Click **Browse** and search for `Github Sync (Multi-Platform)`.
4.  Click **Install**, then **Enable**.

*(Alternatively, download the latest release and place `main.js`, `manifest.json`, and `styles.css` into `.obsidian/plugins/github-sync-multi-platform/`)*

## ⚙️ Configuration

1.  **GitHub Token**: Generate a [Personal Access Token (PAT)](https://github.com/settings/tokens) with `repo` scope.
2.  **Repo Settings**:
    -   **Owner**: Your GitHub username.
    -   **Repo**: Your private notes repository name.
    -   **Branch**: Typically `main`.
3.  **Sync Options**: Enable "Auto Sync" for the real-time experience.

## ❓ FAQ

For detailed information about synchronization mechanisms, incremental sync, and conflict resolution, please refer to our [FAQ Document](docs/FAQ.md).

---

<a name="chinese"></a>

## 🚀 项目简介

**Github-Sync-Multi-Platform** 是一款高性能、无服务器同步方案。它直接利用 GitHub REST API，在桌面端（Windows/macOS/Linux）与移动端（iOS/Android）之间提供流畅的实时笔记同步体验。

与传统的基于 Git 命令行工具的插件不同，本项目通过 API 直接操作，在移动端无需安装 Git 环境，运行更轻快、更稳定。

### ✨ 核心特性

-   **原生移动端支持**：完美适配 iOS 和 Android，无需复杂的 Git 环境配置。
-   **实时自动同步**：智能监听文件修改事件，内置 5 秒防抖（Debounce）逻辑，平衡实时性与 API 调用额度。
-   **无服务器架构**：数据直接点对点传输至您的私有 GitHub 仓库，隐私安全。
-   **冲突检测**：基于内容哈希的智能检测，最大限度减少同步冲突。
-   **多文件类型支持**：Markdown 以文本方式同步，DOCX、XLSX、PDF、Canvas、JSON、图片等其他 Vault 文件以二进制方式同步（单文件最高 10MB）。
-   **可视化看板**：配套数据看板，直观展示写作进度与同步状态。

## 🛠 技术架构

-   **核心**: TypeScript, Plugin API.
-   **UI 框架**: 原生 CSS, Obsidian 内置设置组件.
-   **通信**: GitHub REST API (v3).
-   **构建工具**: esbuild 极速打包.

## 📥 安装方式

1.  打开 **设置** > **第三方插件**。
2.  关闭 **安全模式**。
3.  点击 **浏览** 并搜索 `Github Sync (Multi-Platform)`。
4.  点击 **安装**，随后 **启用**。

*(或从 Release 页面下载最新版本，将 `main.js`、`manifest.json`、`styles.css` 放入 `.obsidian/plugins/github-sync-multi-platform/` 目录)*

## ⚙️ 配置指南

1.  **GitHub 令牌**: 访问 [GitHub Settings](https://github.com/settings/tokens) 生成一个具有 `repo` 权限的个人访问令牌 (PAT)。
2.  **仓库配置**:
    -   **Owner**: 您的 GitHub 用户名。
    -   **Repo**: 您的私有笔记仓库名称。
    -   **Branch**: 默认为 `main`。
3.  **Sync Options**: 开启“启用同步”即可享受实时同步体验。

## ❓ 常见问题 (FAQ)

关于同步机制、增量同步以及多设备冲突处理的详细说明，请参阅 [常见问题解答 (FAQ)](docs/FAQ.md)。

---

<a name="traditional-chinese"></a>

## 🚀 專案簡介

**Github-Sync-Multi-Platform** 是一款高效能、無伺服器的 Obsidian 同步方案。它直接使用 GitHub REST API，在桌面端（Windows/macOS/Linux）與行動裝置（iOS/Android）之間提供即時同步體驗。

與傳統依賴 Git 指令列的同步外掛不同，本專案直接透過 GitHub API 操作，因此行動裝置不需要額外安裝 Git 環境，設定更簡單，也能維持跨平台一致的同步流程。

### ✨ 核心功能

-   **原生行動裝置支援**：支援 iOS 與 Android，不需要 Git 執行檔。
-   **即時自動同步**：監聽檔案修改事件，內建 5 秒 Debounce，降低不必要的 API 呼叫。
-   **無伺服器架構**：資料直接同步到你的 GitHub Repository，不需要額外架設中介伺服器。
-   **衝突偵測**：透過內容 Hash 與 GitHub SHA 判斷變更，減少不必要的重複同步。
-   **多檔案類型支援**：Markdown 以文字方式同步；DOCX、XLSX、PDF、Canvas、JSON、圖片等其他 Vault 檔案則以 Binary 方式同步（單一檔案最高 10 MB）。
-   **視覺化看板**：可搭配網頁式 Dashboard 顯示寫作進度與同步統計。

## 🛠 技術架構

-   **核心**：TypeScript、Obsidian Plugin API
-   **介面**：原生 CSS、Obsidian 設定元件
-   **網路**：GitHub REST API (v3)
-   **建置**：esbuild

## 📥 安裝方式

1. 開啟 Obsidian **設定** > **第三方外掛**。
2. 關閉 **受限模式（Restricted mode）**。
3. 點擊 **瀏覽**，搜尋 `Github Sync (Multi-Platform)`。
4. 點擊 **安裝**，再啟用外掛。

也可以從 Release 頁面下載最新版本，將 `main.js`、`manifest.json`、`styles.css` 放到：

```text
<Vault>/.obsidian/plugins/github-sync-multi-platform/
```

## ⚙️ 設定方式

1. **GitHub Token**：建立具有 Repository 存取權限的 Personal Access Token (PAT)。
2. **Repository 設定**：
   - **Owner**：GitHub 使用者名稱或組織名稱。
   - **Repo**：用來存放 Obsidian Vault 的 Repository 名稱。
   - **Branch**：通常為 `main`。
3. **同步選項**：開啟「啟用同步」即可使用即時同步功能。

## ❓ 常見問題

關於雙向同步、增量同步與衝突處理方式，請參考 [FAQ](docs/FAQ.md)。

---

## 💖 Support / 支持

If this plugin has helped you with multi-device synchronization, please consider supporting the project. Your contribution keeps the development alive!

如果这个插件解决了您的多端同步需求，请考虑支持我一下。您的支持是持续开发的最大动力！

| Ko-fi (International / 国际) | WeChat (China / 微信支付) |
| :---: | :---: |
| [<img src="docs/images/kofi.png" height="36" alt="Buy Me a Coffee at ko-fi.com" />](https://ko-fi.com/thiter) | <img src="docs/images/qrcode.png" width="180" alt="WeChat Support" /> |

---

## 📄 License

MIT © [Thiter](https://github.com/thiter)
