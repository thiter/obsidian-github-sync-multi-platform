import { App, PluginSettingTab, Notice, Setting, Platform } from "obsidian";
import { createRoot, Root } from "react-dom/client";

import { SettingsView } from "./views/settings-view";
import { KofiImage } from "./lib/icons";
import { $ } from "./lang/lang";
import FastSync from "./main";


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
  root: Root | null = null

  constructor(app: App, plugin: FastSync) {
    super(app, plugin)
    this.plugin = plugin
    this.plugin.clipboardReadTip = ""
  }

  hide(): void {
    if (this.root) {
      this.root.unmount()
      this.root = null
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

    const apiSet = set.createDiv()
    apiSet.addClass("obsidian-github-sync-multi-platform-settings")

    this.root = createRoot(apiSet)
    this.root.render(<SettingsView plugin={this.plugin} />)

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
      .addText((text) =>
        text
          .setPlaceholder($("输入您的 GitHub 访问令牌"))
          .setValue(this.plugin.settings.githubToken)
          .onChange(async (value) => {
            this.plugin.settings.githubToken = value
            await this.plugin.saveSettings()
          })
      )

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
