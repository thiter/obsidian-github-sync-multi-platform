import { App, PluginSettingTab, Notice, Setting, Platform } from "obsidian";
import { KofiImage } from "./lib/icons";
import { $ } from "./lang/lang";
import FastSync from "./main";
import { dump } from "./lib/helps";

export interface PluginSettings {
  //是否自动上传
  syncEnabled: boolean
  // GitHub 配置
  githubOwner: string
  githubRepo: string
  githubBranch: string
  githubToken: string

  vault: string
  lastSyncTime: number
  //  [propName: string]: any;
  clipboardReadTip: string
}

/**
 *

![这是图片](https://markdown.com.cn/assets/img/philly-magic-garden.9c0b4415.jpg)

 */

// 默认插件设置
export const DEFAULT_SETTINGS: PluginSettings = {
  // 是否自动上传
  syncEnabled: true,
  // GitHub 默认值
  githubOwner: "",
  githubRepo: "",
  githubBranch: "main",
  githubToken: "",
  lastSyncTime: 0,
  vault: "defaultVault",
  // 剪贴板读取提示
  clipboardReadTip: "",
}

export class SettingTab extends PluginSettingTab {
  plugin: FastSync

  constructor(app: App, plugin: FastSync) {
    super(app, plugin)
    this.plugin = plugin
    this.plugin.clipboardReadTip = ""
  }

  hide(): void {
    // 不再需要 React root.unmount()
  }

  /**
   * 从剪贴板读取 GitHub 配置 JSON 并自动填入设置
   */
  async handleClipboardPaste(tipEl: HTMLElement): Promise<void> {
    const showTip = (msg: string) => {
      tipEl.setText(msg)
      setTimeout(() => tipEl.setText(""), 2000)
    }

    try {
      if (!navigator.clipboard) {
        showTip($("未检测到配置信息!"))
        return
      }
      const text = await navigator.clipboard.readText()
      const parsed = JSON.parse(text)
      if (typeof parsed === "object" && parsed !== null) {
        const hasOwner = "githubOwner" in parsed || "owner" in parsed
        const hasRepo = "githubRepo" in parsed || "repo" in parsed
        const hasToken = "githubToken" in parsed || "token" in parsed
        if (hasOwner && hasRepo && hasToken) {
          this.plugin.settings.githubOwner = parsed.githubOwner || parsed.owner
          this.plugin.settings.githubRepo = parsed.githubRepo || parsed.repo
          this.plugin.settings.githubBranch = parsed.githubBranch || parsed.branch || "main"
          this.plugin.settings.githubToken = parsed.githubToken || parsed.token
          await this.plugin.saveSettings()
          this.display()
          showTip($("接口配置信息已经粘贴到设置中!"))
          return
        }
      }
      showTip($("未检测到配置信息!"))
    } catch (err) {
      dump(err)
      showTip($("未检测到配置信息!"))
    }
  }

  display(): void {
    const { containerEl: set } = this

    set.empty()

    // new Setting(set).setName("Fast Note Sync").setDesc($("Fast sync")).setHeading()

    new Setting(set)
      .setName($("启用同步"))
      .setDesc($("关闭后您的笔记将不做任何同步"))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.syncEnabled).onChange(async (value) => {
          if (value != this.plugin.settings.syncEnabled) {
            this.plugin.settings.syncEnabled = value
            this.display()
            await this.plugin.saveSettings()
          }
        })
      )

    new Setting(set)
      .setName("| " + $("远端"))
      .setHeading()
      .setClass("obsidian-github-sync-multi-platform-settings-tag")

    // 用 Obsidian 原生 API 替换 React 组件（移除 react-dom 依赖）
    new Setting(set)
      .setName($("GitHub 同步配置"))
      .setDesc($("使用 GitHub API 进行同步"))

    const apiInfoDiv = set.createDiv("obsidian-github-sync-multi-platform-settings")
    const table = apiInfoDiv.createEl("table", { cls: "obsidian-github-sync-multi-platform-settings-openapi" })
    const thead = table.createEl("thead")
    const headerRow = thead.createEl("tr")
    headerRow.createEl("th", { text: $("方式") })
    headerRow.createEl("th", { text: $("说明") })
    headerRow.createEl("th", { text: $("详情参考") })
    const tbody = table.createEl("tbody")
    const row = tbody.createEl("tr")
    row.createEl("td", { text: "GitHub" })
    row.createEl("td", { text: $("使用 GitHub 仓库存储和同步笔记") })
    const linkTd = row.createEl("td")
    linkTd.createEl("a", { text: "GitHub PAT Settings", href: "https://github.com/settings/tokens" })

    // 粘贴配置按鈕
    const clipboardDiv = set.createDiv("clipboard-read")
    const clipboardBtn = clipboardDiv.createEl("button", {
      text: $("粘贴的远端配置"),
      cls: "clipboard-read-button"
    })
    const clipboardTip = clipboardDiv.createEl("div", { cls: "clipboard-read-description" })
    clipboardTip.setText(this.plugin.clipboardReadTip)
    clipboardBtn.addEventListener("click", () => {
      void this.handleClipboardPaste(clipboardTip)
    })

    new Setting(set)
      .setName($("GitHub 用户名"))
      .setDesc($("输入您的 GitHub 用户名"))
      .addText((text) =>
        text
          .setPlaceholder($("输入您的 GitHub 用户名"))
          .setValue(this.plugin.settings.githubOwner)
          .onChange(async (value) => {
            this.plugin.settings.githubOwner = value
            await this.plugin.saveSettings()
          })
      )

    new Setting(set)
      .setName($("GitHub 仓库名"))
      .setDesc($("输入您的 GitHub 仓库名"))
      .addText((text) =>
        text
          .setPlaceholder($("输入您的 GitHub 仓库名"))
          .setValue(this.plugin.settings.githubRepo)
          .onChange(async (value) => {
            this.plugin.settings.githubRepo = value
            await this.plugin.saveSettings()
          })
      )

    new Setting(set)
      .setName($("GitHub 分支名"))
      .setDesc($("输入您的 GitHub 分支名"))
      .addText((text) =>
        text
          .setPlaceholder($("输入您的 GitHub 分支名"))
          .setValue(this.plugin.settings.githubBranch)
          .onChange(async (value) => {
            this.plugin.settings.githubBranch = value
            await this.plugin.saveSettings()
          })
      )

    new Setting(set)
      .setName($("GitHub 访问令牌"))
      .setDesc($("用于访问 GitHub API 的 Personal Access Token"))
      .addText((text) => {
        text.inputEl.type = "password"  // C4: mask 显示，防止 Token 明文泄露
        text
          .setPlaceholder($("输入您的 GitHub 访问令牌"))
          .setValue(this.plugin.settings.githubToken)
          .onChange(async (value) => {
            this.plugin.settings.githubToken = value
            await this.plugin.saveSettings()
          })
      })

    new Setting(set)
      .setName($("远端仓库名"))
      .setDesc($("远端仓库名"))
      .addText((text) =>
        text
          .setPlaceholder($("远端仓库名"))
          .setValue(this.plugin.settings.vault)
          .onChange(async (value) => {
            this.plugin.settings.vault = value
            await this.plugin.saveSettings()
          })
      )

    const debugDiv = set.createDiv()
    debugDiv.addClass("obsidian-github-sync-multi-platform-settings-debug")

    const debugButton = debugDiv.createEl("button")
    debugButton.setText($("复制 Debug 信息"))
    debugButton.onclick = async () => {
      await window.navigator.clipboard.writeText(
        JSON.stringify(
          {
            settings: {
              ...this.plugin.settings,
              githubToken: this.plugin.settings.githubToken ? "***HIDDEN***" : "",
            },
            pluginVersion: this.plugin.manifest.version,
          },
          null,
          4
        )
      )
      new Notice($("将调试信息复制到剪贴板, 可能包含敏感信!"))
    }

    if (Platform.isDesktopApp) {
      const info = debugDiv.createDiv()
      info.setText($("通过快捷键打开控制台，你可以看到这个插件和其他插件的日志"))

      const keys = debugDiv.createDiv()
      keys.addClass("custom-shortcuts")
      if (Platform.isMacOS === true) {
        keys.createEl("kbd", { text: $("console_mac") })
      } else {
        keys.createEl("kbd", { text: $("console_windows") })
      }
    }

    // Support section
    new Setting(set).setName($("支持")).setHeading()
    const supportDiv = set.createDiv("github-sync-support-section")

    // Add donation title
    new Setting(supportDiv).setName($("捐赠")).setHeading()

    // Add donation text
    supportDiv.createEl("p", { 
      text: $("如果您喜欢这个插件，请考虑捐赠以支持继续开发。") 
    })

    const kofiLink = supportDiv.createEl("a", {
      href: "https://ko-fi.com/thiter",
    })
    const kofiImg = kofiLink.createEl("img", { cls: "kofi-img" })
    kofiImg.src = KofiImage
  }
}
