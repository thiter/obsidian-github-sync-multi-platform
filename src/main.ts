import { Plugin, setIcon } from "obsidian";

import { NoteModify, NoteDelete, NoteRename, StartupFullNotesForceOverSync, StartupFullNotesSync } from "./lib/fs";
import { SettingTab, PluginSettings, DEFAULT_SETTINGS } from "./setting";
import { GitHubClient } from "./lib/github-api";
import { $, moment } from "./lang/lang";
import { calculateWordCount } from "./lib/helps";


interface SyncSkipFiles {
  [key: string]: string
}
interface EditorChangeTimeout {
  [key: string]: unknown
}

export interface FileState {
  sha: string;
  lastSync: number;
  hash?: string; // Cache the content hash
}

export interface SyncData {
  files: { [path: string]: FileState };
}

export default class FastSync extends Plugin {
  settingTab: SettingTab
  settings: PluginSettings
  githubClient: GitHubClient
  syncData: SyncData = { files: {} }
  
  isSyncInProgress: boolean = false
  debounceTimers: Map<string, number> = new Map()
  
  syncSkipFiles: SyncSkipFiles = {}
  syncSkipDelFiles: SyncSkipFiles = {}
  syncSkipModifyFiles: SyncSkipFiles = {}
  clipboardReadTip: string = ""

  editorChangeTimeout: EditorChangeTimeout = {}

  ribbonIcon: HTMLElement
  ribbonIconStatus: boolean = false

  isWatchEnabled: boolean = true
  ignoredFiles: Set<string> = new Set()

  enableWatch() {
    this.isWatchEnabled = true
  }

  disableWatch() {
    this.isWatchEnabled = false
  }

  addIgnoredFile(path: string) {
    this.ignoredFiles.add(path)
  }

  removeIgnoredFile(path: string) {
    this.ignoredFiles.delete(path)
  }


  async onload() {
    this.syncSkipFiles = {}

    await this.loadSettings()
    await this.loadSyncData()
    
    this.settingTab = new SettingTab(this.app, this)
    this.addSettingTab(this.settingTab)
    
    this.initGitHubClient()

    // Create Ribbon Icon once
    this.ribbonIcon = this.addRibbonIcon("loader-circle", "Obsidian-Github-Sync-Multi-Platform: " + $("同步全部笔记"), () => {
      StartupFullNotesSync(this)
    })

    this.updateRibbonIcon(!!(this.settings.githubToken && this.settings.githubOwner && this.settings.githubRepo))

    // 注册文件事件（只监听 md 和图片，过滤其他类型在 performSync 内完成）
    // 启动时先禁用 watch，防止 vault 索引触发大量文件事件并发打 API 被 GitHub 限速（422）
    this.disableWatch()
    this.registerEvent(this.app.vault.on("create", (file) => NoteModify(file, this, true)))
    this.registerEvent(this.app.vault.on("modify", (file) => NoteModify(file, this, true)))
    this.registerEvent(this.app.vault.on("delete", (file) => NoteDelete(file, this, true)))
    this.registerEvent(this.app.vault.on("rename", (file, oldfile) => NoteRename(file, oldfile, this, true)))

    // 注册命令
    this.addCommand({
      id: "init-all-files",
      name: $("同步全部笔记(覆盖远端)"),
      callback: () => StartupFullNotesForceOverSync(this),
    })

    this.addCommand({
      id: "sync-all-files",
      name: $("同步全部笔记"),
      callback: () => StartupFullNotesSync(this),
    })

    // 布局加载完成后统一执行启动同步，完成后再开启实时 watch
    this.app.workspace.onLayoutReady(() => {
      if (
        this.settings.syncEnabled &&
        this.settings.githubToken &&
        this.settings.githubOwner &&
        this.settings.githubRepo
      ) {
        // 延迟 1.5 秒，等待 Obsidian 初始化完成
        setTimeout(() => {
          // syncAllFilesImpl 内部完成后会调用 enableWatch()
          StartupFullNotesSync(this);
        }, 1500);
      } else {
        // 未配置则直接开启 watch
        this.enableWatch();
      }
    });
  }

  initGitHubClient() {
    if (this.settings.githubToken && this.settings.githubOwner && this.settings.githubRepo) {
      this.githubClient = new GitHubClient({
        token: this.settings.githubToken,
        owner: this.settings.githubOwner,
        repo: this.settings.githubRepo,
        branch: this.settings.githubBranch || "main",
      });
    }
  }

  onunload() {
    // 清理所有防抖计时器，防止插件卸载后仍有回调触发（内存泄漏）
    this.debounceTimers.forEach(timer => clearTimeout(timer));
    this.debounceTimers.clear();
  }

  updateRibbonIcon(status: boolean) {
    if (status) {
      setIcon(this.ribbonIcon, "rotate-cw")
      this.ribbonIcon.setAttribute("aria-label", "Obsidian-Github-Sync-Multi-Platform: " + $("同步全部笔记") + " (Configured)")
    } else {
      setIcon(this.ribbonIcon, "loader-circle")
      this.ribbonIcon.setAttribute("aria-label", "Obsidian-Github-Sync-Multi-Platform: " + $("同步全部笔记") + " (Not Configured)")
    }
  }

  /**
   * 统一持久化入口：settings 和 syncData 始终存储在同一个对象中，
   * 避免 saveSettings / saveSyncData 互相覆盖对方的数据。
   */
  async persistData() {
    await this.saveData({
      settings: this.settings,
      syncData: this.syncData,
    });
  }

  async loadSettings() {
    const data = await this.loadData() ?? {};
    // 兼容旧版本：旧版直接把 settings 字段铺在顶层
    const savedSettings = data.settings ?? data;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, savedSettings);
  }

  async saveSettings() {
    this.initGitHubClient()
    this.updateRibbonIcon(!!(this.settings.githubToken && this.settings.githubOwner && this.settings.githubRepo))
    await this.persistData()
  }

  async loadSyncData() {
    const data = await this.loadData() ?? {};
    this.syncData = data.syncData ?? { files: {} };
  }

  async saveSyncData() {
    await this.persistData();
  }

  async updateStats() {
    if (!this.githubClient) return;

    const stats: { [month: string]: number } = {};
    const files = this.app.vault.getMarkdownFiles();

    for (const file of files) {
      const content = await this.app.vault.read(file);
      const wordCount = calculateWordCount(content);
      const month = moment(file.stat.mtime).format("YYYY-MM");
      stats[month] = (stats[month] || 0) + wordCount;
    }

    const statsJson = JSON.stringify({
      lastUpdate: Date.now(),
      monthlyStats: stats
    }, null, 2);

    const path = `${this.app.vault.configDir}/sync-stats.json`;
    try {
      const existingSha = this.syncData.files[path]?.sha;
      const newSha = await this.githubClient.putFile(path, statsJson, existingSha);
      this.syncData.files[path] = {
        sha: newSha,
        lastSync: Date.now()
      };
      await this.saveSyncData();
    } catch (e) {
      console.error("Failed to update stats on GitHub", e);
    }
  }
}
