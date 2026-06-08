# Obsidian Plugin Review Guidelines

> 📌 来源：[Plugin guidelines - Obsidian Developer Docs](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines)  
> 🕐 存档时间：2026-06-08  
> ⚠️ 本文件为官方规范的本地副本，供开发时对齐使用。如需最新内容请访问官方链接。

---

## 📁 仓库结构要求（提交前必须满足）

GitHub 仓库根目录**必须**包含以下文件：

| 文件 | 说明 |
|------|------|
| `README.md` | 描述插件功能和使用方法 |
| `LICENSE` | 必须存在，决定他人如何使用代码 |
| `manifest.json` | 插件元数据 |
| `versions.json` | 映射插件版本与最低 Obsidian 版本的关系 |
| GitHub Release | 版本 tag 必须与 `manifest.json` 一致，Release 附件需包含 `main.js`、`manifest.json`，可选 `styles.css` |

---

## 📋 manifest.json 字段规范

| 字段 | 要求 |
|------|------|
| `id` | 唯一；只允许小写字母和连字符；**不得包含 "obsidian"**；**不得以 "plugin" 结尾** |
| `name` | 简短描述性；避免包含 "Obsidian" 或 "Plugin" |
| `description` | 最多 **250 个字符**；必须以标点符号结尾（`.`、`?`、`!`）；**不得包含 "Obsidian"**；**不得以 "This is a plugin" 开头**；不使用 emoji 或特殊字符；句子大小写 |
| `version` | 必须与 GitHub Release tag 完全一致 |
| `minAppVersion` | 设置为插件兼容的最低 Obsidian 版本 |
| `isDesktopOnly` | 若插件使用 Node.js 或 Electron API（`fs`、`crypto`、`os`、`electron`），**必须设为 `true`** |
| `author` | 真实姓名或 ID |
| `authorUrl` | 可选，但建议填写 |

---

## 🚫 常见被拒原因 Top 12

1. **保留 `console.log`** — 生产代码必须移除；只允许 `console.error`
2. **使用 `window.app` 或全局 `app`** — 仅限调试，生产代码必须用 `this.app`
3. **使用 Node.js/Electron API 但未设 `isDesktopOnly: true`** — 在移动端会崩溃
4. **保留模板占位类名** — 如 `MyPlugin`、`SampleSettingTab` 必须重命名
5. **插件 ID 包含 "obsidian" 或以 "plugin" 结尾**
6. **描述超过 250 字符或末尾没有标点**
7. **使用 `innerHTML`、`outerHTML`、`insertAdjacentHTML`** — XSS 安全风险
8. **在 `data.json` 中存储凭据/Token 明文**
9. **设置页使用 `<h1>`/`<h2>` HTML 标签** — 应使用 Obsidian API
10. **`onunload()` 中未清理资源** — 导致内存泄漏
11. **使用 `var`** — 应使用 `const`/`let`
12. **描述以 "This is a plugin" 开头或包含 "Obsidian"**

---

## 💻 代码风格规范

- 使用 `const` 和 `let`，**禁止 `var`**
- 提交前删除所有 `console.log`（生产只允许 `console.error`）
- 不使用模板占位类名（`MyPlugin`、`SampleSettingTab`、`MyModal` 等）
- 使用 TypeScript（Obsidian 插件推荐标准）
- 若插件代码超过单文件，组织为模块/文件夹

---

## 🖼️ DOM 操作规范

| 类型 | 状态 | 说明 |
|------|------|------|
| `innerHTML` | ❌ 禁止 | XSS 风险 |
| `outerHTML` | ❌ 禁止 | XSS 风险 |
| `insertAdjacentHTML` | ❌ 禁止 | XSS 风险 |
| `createEl()` | ✅ 推荐 | Obsidian 内置，输入当文本处理 |
| `createDiv()` | ✅ 推荐 | 同上 |
| `createSpan()` | ✅ 推荐 | 同上 |
| `createFragment()` | ✅ 推荐 | 同上 |

> 若确实需要插入 HTML，使用 `DOMPurify` 净化后再插入。

---

## 🎨 UI / 设置页规范

### 文字大小写
所有 UI 文本（设置标签、描述、按钮文字、标题、占位符）使用**句子大小写（Sentence case）**：

```
✅ 正确：Template folder location
❌ 错误：Template Folder Location
```

### 设置页标题规范
- **不要**在顶部加插件名作为一级标题
- **不要**在标题中包含 "Settings"（用 "Advanced"，不用 "Advanced settings"）
- 只有存在多个设置分组时才使用标题
- 通用设置放顶部，不加标题
- **不要使用** `<h1>` 或 `<h2>` HTML 标签，使用 Obsidian API

### CSS 规范
- 使用 Obsidian 内置 CSS 变量（如 `--background-secondary`、`--text-normal`）
- **禁止**硬编码颜色值，否则会在其他主题下显示异常

---

## 🔒 安全要求（Token / 凭据处理）

> [!CAUTION]
> **绝不**将 API Key、OAuth Token 或其他密钥以明文存储在 `data.json` 中。`data.json` 会随 vault 同步，容易泄漏。

### 推荐方式：使用 `SecretStorage` API

```typescript
import { SecretComponent } from 'obsidian';

// 存储 Token（写入 OS 安全存储）
await this.app.plugins.plugins['your-plugin-id'].saveSecret('github-token', token);

// 读取 Token
const token = await this.app.plugins.plugins['your-plugin-id'].loadSecret('github-token');
```

`SecretStorage` 底层使用：
- macOS → **Keychain**
- Windows → **Credential Manager**
- Linux → **libsecret**

`data.json` 中只存储 secret 的引用/名称，不存储实际值。

---

## 📱 移动端兼容性

- **禁止**在非 `isDesktopOnly` 插件中使用 Node.js（`fs`、`path`、`os`、`crypto`）或 Electron API
- 移动端替代方案：

| 禁止（桌面专属） | 推荐（跨平台） |
|-----------------|--------------|
| Node.js `crypto` | Web API `SubtleCrypto` |
| Electron clipboard | `navigator.clipboard` |
| Node.js `fs` | Obsidian Vault API |

- 平台检测方式：

```typescript
import { Platform } from 'obsidian';

if (Platform.isMobileApp) {
  // 移动端专属逻辑
}
if (Platform.isDesktopApp) {
  // 桌面端专属逻辑
}
```

---

## ⚙️ Obsidian API 使用规范

### 资源生命周期管理（重要）

所有资源、事件监听、定时器、DOM 元素**必须**在 `onunload()` 中清理。

```typescript
// ✅ 正确：使用 registerEvent，插件卸载时自动清理
this.registerEvent(
  this.app.vault.on('modify', callback)
);

// ✅ 正确：使用 registerDomEvent
this.registerDomEvent(document, 'click', callback);

// ✅ 正确：使用 registerInterval
this.registerInterval(
  window.setInterval(callback, 5000)
);

// ⚠️ 手动创建的 timeout/interval 需在 onunload 中手动清理
onunload() {
  this.debounceTimers.forEach(timer => clearTimeout(timer));
  this.debounceTimers.clear();
}
```

### App 实例引用

```typescript
// ✅ 正确
this.app.vault.getFiles()

// ❌ 禁止（仅限调试，未来可能移除）
window.app.vault.getFiles()
```

### 数据存储

```typescript
// ✅ 使用官方 API
await this.loadData()   // 读取 data.json
await this.saveData(data)  // 写入 data.json

// 只存储非敏感数据！
```

---

## ✅ 提交前检查清单

### 仓库结构
- [ ] `README.md` 存在且描述清晰
- [ ] `LICENSE` 文件存在
- [ ] `manifest.json` 字段完整正确
- [ ] `versions.json` 存在
- [ ] GitHub Release 已发布，tag 与版本一致，附件包含 `main.js` + `manifest.json`

### manifest.json
- [ ] Plugin ID：只含小写字母和连字符，不含 "obsidian"，不以 "plugin" 结尾
- [ ] Description：≤250 字符，末尾有标点，不含 "Obsidian"，句子大小写
- [ ] 使用 Node.js/Electron API 时设置了 `isDesktopOnly: true`

### 代码质量
- [ ] 无 `console.log`（只保留 `console.error`）
- [ ] 无 `innerHTML` / `outerHTML` / `insertAdjacentHTML`
- [ ] 无 `window.app` 或全局 `app`
- [ ] 无模板占位类名（MyPlugin、SampleSettingTab 等）
- [ ] 使用 `const`/`let`，无 `var`

### 安全
- [ ] Token / 密钥通过 `SecretStorage` 存储，不写入 `data.json`

### 资源管理
- [ ] 所有事件通过 `registerEvent()` / `registerDomEvent()` 注册
- [ ] 手动创建的 timer 在 `onunload()` 中清理
- [ ] `onunload()` 完整清理所有资源

### UI
- [ ] 所有 UI 文本使用句子大小写
- [ ] CSS 使用 Obsidian CSS 变量，无硬编码颜色
- [ ] 设置页不使用 `<h1>`/`<h2>` 标签
- [ ] Token 输入框使用 `type="password"` 隐藏显示

---

## 🔗 官方参考链接

- [Plugin guidelines（官方文档）](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines)
- [Submit your plugin（提交流程）](https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin)
- [obsidian-releases（GitHub）](https://github.com/obsidianmd/obsidian-releases)
- [Obsidian API 类型定义](https://github.com/obsidianmd/obsidian-api)
