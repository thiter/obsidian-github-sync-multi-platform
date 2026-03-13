# Github-Sync-Multi-Platform

[![GitHub release (latest by date)](https://img.shields.io/github/v/release/Zhang-cm/github-sync-multi-platform?style=flat-square)](https://github.com/Zhang-cm/github-sync-multi-platform/releases)
[![Downloads](https://img.shields.io/badge/dynamic/json?logo=obsidian&color=9437ff&label=downloads&query=github-sync-multi-platform.downloads&url=https%3A%2F%2Fraw.githubusercontent.com%2Fobsidianmd%2Fobsidian-releases%2Fmaster%2Fcommunity-plugin-stats.json&style=flat-square)](https://obsidian.md/plugins?id=github-sync-multi-platform)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)

[English](#english) | [简体中文](#chinese)

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
-   **Binary File Support**: Handles images and attachments efficiently (up to 10MB per file).
-   **Visual Dashboard**: Support for a web-based dashboard to visualize your writing progress and sync stats.

## 🛠 Tech Stack

-   **Core**: TypeScript, Plugin API.
-   **UI**: React, Tailwind-like modular CSS.
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
-   **附件支持**：高效处理图片等二进制附件（支持单文件最高 10MB）。
-   **可视化看板**：配套数据看板，直观展示写作进度与同步状态。

## 🛠 技术架构

-   **核心**: TypeScript, Plugin API.
-   **UI 框架**: React, 模块化 CSS 设计.
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
