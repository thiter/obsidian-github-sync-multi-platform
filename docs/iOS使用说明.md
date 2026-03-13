# iOS 端 Obsidian Obsidian-Github-Sync-Multi-Platform 使用指南

为了在 iPhone 或 iPad 上实现与电脑端完全一致的笔记同步体验，请遵循本配置指南。

---

## 1. 软件选型与准备

### 1.1 核心软件
- **Obsidian 官方 App**：在 App Store 免费下载。
- **Obsidian-Github-Sync-Multi-Platform 插件**：即本项目编译后的插件文件夹。

### 1.2 辅助工具 (可选，用于初始配置)
- **Alook 浏览器** 或 **Safari**：用于访问 GitHub 获取 Token。
- **文件 App (Files)**：iOS 自带，用于管理插件目录。

---

## 2. 初始安装步骤

由于 iOS 端的特殊性，您需要手动将插件放入 Obsidian 文件夹。

### 2.1 创建库 (Vault)
1. 在 iPhone 上打开 **Obsidian**。
2. 点击 **Create new vault**。
3. 建议命名为与电脑端一致（例如 `my-notes`）。
4. 选择存储在 **On My iPhone**（以便插件正常运行）。

### 2.2 导入插件
1. 将电脑端编译好的 `github-sync` 插件文件夹通过 **AirDrop (隔空投送)** 或 **iCloud** 发送到手机。
2. 打开手机自带的 **文件 (Files) App**。
3. 找到该文件夹，将其移动到以下路径：
   `在我的 iPhone 上 > Obsidian > [您的库名] > .obsidian > plugins > github-sync`
   *(注意：如果看不到 .obsidian 文件夹，请点击文件 App 右上角的三个点 > 显示所有扩展名/隐藏文件)*

---

## 3. 插件配置 (关键)

1. 在手机上打开 **Obsidian**。
2. 进入 **Settings > Community plugins**，开启插件并找到 **Obsidian-Github-Sync-Multi-Platform**。
3. 在插件设置中填入与电脑端**完全一致**的信息：
   - **GitHub Owner**: `Zhang-cm`
   - **GitHub Repo**: `testnote`
   - **GitHub Token**: `ghp_...` (建议通过微信/备忘录拷贝过来)
4. **开启 "Enable Sync" (启用同步)**。

---

## 4. 配合方案的使用逻辑

### 4.1 自动对齐 (启动同步)
- **操作**：每次在 iOS 上打开 Obsidian 时，**请停留约 3-5 秒**。
- **现象**：您会看到右上角弹出 `Starting full sync...` 提示。
- **结果**：插件会自动把您在电脑上新写的笔记拉取到手机上。请确保看到 `Sync completed` 后再开始阅读或写作。

### 4.2 实时保存 (写作同步)
- **操作**：在手机上写完笔记后，**不要立即划掉/关闭 App**。
- **逻辑**：插件有 **5 秒防抖**机制。
- **建议**：写完最后一行，停留 5 秒，直到提示消失或确认没有报错，再切换到其他 App。

### 4.3 附件处理 (图片优先)
- **图片上传**：在手机上插入图片（照片）后，插件会自动将其转换为二进制流推送到 GitHub。
- **限制**：单张图片建议小于 **10MB**，以确保在移动网络下同步成功。

---

## 5. 常见问题与对策

### 5.1 iOS 后台限制
- **问题**：如果我在写一半时接电话，笔记会丢失吗？
- **对策**：Obsidian 自身有自动保存机制。只要您重新回到 Obsidian，插件就会再次检测变化并尝试上传。但**强烈建议不要在弱网环境下进行超长篇幅的编辑**。

### 5.2 冲突解决
- **场景**：电脑和手机同时开着同一篇笔记改。
- **后果**：GitHub 会拒绝其中一个冲突的提交。
- **解决**：回到电脑端，查看 GitHub 的 **Commit History**（提交历史），找回被覆盖的内容。

### 5.3 流量建议
- 看板 (Dashboard) 也会记录您的同步状态。如果您在外面不确定是否同步成功，可以打开手机浏览器访问您的 **Dashboard 链接**，查看 `Last Sync` 时间。

---

## 6. 维护建议
- **.gitignore**：确保您的仓库根目录有 `.gitignore`，排除 `workspace-mobile.json`，这样您的手机布局就不会被电脑端的布局覆盖，保持两端界面各自舒适。
