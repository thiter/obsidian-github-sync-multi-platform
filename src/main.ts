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

    // 注册文件事件 - 现在支持所有文件类型
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

    // 在布局加载完成后，自动触发同步以拉取云端新增或修改的文件
    this.app.workspace.onLayoutReady(() => {
      if (
        this.settings.syncEnabled &&
        this.settings.githubToken &&
        this.settings.githubOwner &&
        this.settings.githubRepo
      ) {
        // 延迟 1 秒触发，避免阻塞 Obsidian 的界面加载和其他插件的初始化
        setTimeout(() => {
          StartupFullNotesSync(this);
        }, 1000);
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

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData())
  }

  async saveSettings() {
    await this.saveData(this.settings)
    this.initGitHubClient()
    this.updateRibbonIcon(!!(this.settings.githubToken && this.settings.githubOwner && this.settings.githubRepo))
  }

  async loadSyncData() {
    const data = await this.loadData();
    if (data && data.syncData) {
      this.syncData = data.syncData;
    } else {
      this.syncData = { files: {} };
    }
  }

  async saveSyncData() {
    const data = await this.loadData();
    await this.saveData({ ...data, syncData: this.syncData });
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
