import { TFile, TAbstractFile, Notice, requestUrl } from "obsidian";

import { hashContent, dump } from "./helps";
import FastSync from "../main";
import { GitHubClient, GitHubTreeNode } from "./github-api";

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "tiff"];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * 核心修改逻辑，包含防抖和哈希校验
 */
export const NoteModify = function (file: TAbstractFile, plugin: FastSync, eventEnter: boolean = false) {
  if (!(file instanceof TFile)) return;
  if (!plugin.isWatchEnabled && eventEnter) return;
  if (plugin.ignoredFiles.has(file.path) && eventEnter) return;
  if (!plugin.githubClient) return;

  // 1. 文件大小限制 (10MB)
  if (file.stat.size > MAX_FILE_SIZE) {
    new Notice(`File too large (>10MB): ${file.path}. Skipped sync.`);
    return;
  }

  // 2. 防抖处理
  if (plugin.debounceTimers.has(file.path)) {
    clearTimeout(plugin.debounceTimers.get(file.path));
  }

  const timer = window.setTimeout(() => {
    void (async () => {
      plugin.debounceTimers.delete(file.path);
      await performSync(file, plugin);
    })();
  }, 5000); // 5秒防抖

  plugin.debounceTimers.set(file.path, timer);
};

const performSync = async (file: TFile, plugin: FastSync) => {
  plugin.addIgnoredFile(file.path);
  try {
    const isMarkdown = file.extension === "md";
    const isImage = IMAGE_EXTENSIONS.includes(file.extension.toLowerCase());
    
    // 如果不是笔记也不是图片，且非必要，可以跳过或支持所有附件
    // 目前优先处理笔记和图片
    if (!isMarkdown && !isImage) {
      // 如果您希望支持所有类型，可以注释掉下面这行
      // return; 
    }

    let content: string | ArrayBuffer;
    let currentHash: string;

    if (isMarkdown) {
      content = await plugin.app.vault.read(file);
      currentHash = hashContent(content);
    } else {
      content = await plugin.app.vault.readBinary(file);
      // 对二进制文件使用简单的摘要校验
      currentHash = file.stat.size + "_" + file.stat.mtime;
    }

    // 3. 检查内容是否真正变化 (对比缓存的哈希)
    if (plugin.syncData.files[file.path]?.hash === currentHash) {
      dump(`No content change for ${file.path}, skip sync.`);
      return;
    }

    const sha = plugin.syncData.files[file.path]?.sha;
    const newSha = await plugin.githubClient.putFile(file.path, content, sha);

    plugin.syncData.files[file.path] = {
      sha: newSha,
      lastSync: Date.now(),
      hash: currentHash
    };
    await plugin.saveSyncData();
    dump(`Synced ${file.path} to GitHub`, newSha);

  } catch (error) {
    console.error("Sync failed:", error);
    new Notice(`Sync failed for ${file.path}: ${error.message}`);
  } finally {
    plugin.removeIgnoredFile(file.path);
  }
};

export const NoteDelete = async function (file: TAbstractFile, plugin: FastSync, eventEnter: boolean = false) {
  if (!plugin.isWatchEnabled && eventEnter) return;
  if (plugin.ignoredFiles.has(file.path) && eventEnter) return;
  if (!plugin.githubClient) return;

  // 清除防抖计时器
  if (plugin.debounceTimers.has(file.path)) {
    clearTimeout(plugin.debounceTimers.get(file.path));
    plugin.debounceTimers.delete(file.path);
  }

  plugin.addIgnoredFile(file.path);
  try {
    const sha = plugin.syncData.files[file.path]?.sha;
    if (sha) {
      await plugin.githubClient.deleteFile(file.path, sha);
      delete plugin.syncData.files[file.path];
      await plugin.saveSyncData();
      dump(`Deleted ${file.path} from GitHub`);
    }
  } catch (error) {
    console.error("Delete failed:", error);
  } finally {
    plugin.removeIgnoredFile(file.path);
  }
};

export const NoteRename = async function (file: TAbstractFile, oldfile: string, plugin: FastSync, eventEnter: boolean = false) {
  if (!(file instanceof TFile)) return;
  if (!plugin.isWatchEnabled && eventEnter) return;
  if (!plugin.githubClient) return;

  plugin.addIgnoredFile(file.path);
  try {
    // 1. 删除旧路径
    const oldSha = plugin.syncData.files[oldfile]?.sha;
    if (oldSha) {
      await plugin.githubClient.deleteFile(oldfile, oldSha);
      delete plugin.syncData.files[oldfile];
    }

    // 2. 上传新路径
    const isMarkdown = file.extension === "md";
    let content: string | ArrayBuffer;
    let currentHash: string;

    if (isMarkdown) {
      content = await plugin.app.vault.read(file);
      currentHash = hashContent(content);
    } else {
      content = await plugin.app.vault.readBinary(file);
      currentHash = file.stat.size + "_" + file.stat.mtime;
    }

    const newSha = await plugin.githubClient.putFile(file.path, content);
    plugin.syncData.files[file.path] = {
      sha: newSha,
      lastSync: Date.now(),
      hash: currentHash
    };
    await plugin.saveSyncData();
    dump(`Renamed ${oldfile} -> ${file.path}`);
  } catch (error) {
    console.error("Rename failed:", error);
  } finally {
    plugin.removeIgnoredFile(file.path);
  }
};

/**
 * 初始化与同步逻辑 (保持之前实现的 Full Sync, 稍作修改以适配 hash)
 */

export async function overrideRemoteAllFilesImpl(plugin: FastSync): Promise<void> {
  if (plugin.isSyncInProgress) {
    new Notice("Sync in progress...");
    return;
  }
  if (!plugin.githubClient) return;

  plugin.isSyncInProgress = true;
  plugin.disableWatch();
  
  try {
    // 获取所有文件 (不仅是 Markdown)
    const files = plugin.app.vault.getFiles();
    for (const file of files) {
       if (file.stat.size > MAX_FILE_SIZE) continue;
       
       const isMarkdown = file.extension === "md";
       const isImage = IMAGE_EXTENSIONS.includes(file.extension.toLowerCase());
       if (!isMarkdown && !isImage) continue;

       let content: string | ArrayBuffer;
       let currentHash: string;

       if (isMarkdown) {
         content = await plugin.app.vault.read(file);
         currentHash = hashContent(content);
       } else {
         content = await plugin.app.vault.readBinary(file);
         currentHash = file.stat.size + "_" + file.stat.mtime;
       }

       const sha = plugin.syncData.files[file.path]?.sha;
       const newSha = await plugin.githubClient.putFile(file.path, content, sha);
       plugin.syncData.files[file.path] = {
         sha: newSha,
         lastSync: Date.now(),
         hash: currentHash
       };
    }
    await plugin.saveSyncData();
    await plugin.updateStats();
    new Notice("All assets synced to GitHub");
  } catch (error) {
    console.error("Force sync failed:", error);
  } finally {
    plugin.isSyncInProgress = false;
    plugin.enableWatch();
  }
}

export const StartupFullNotesForceOverSync = (plugin: FastSync): void => {
  void overrideRemoteAllFilesImpl(plugin);
};

export async function syncAllFilesImpl(plugin: FastSync): Promise<void> {
  if (plugin.isSyncInProgress) return;
  if (!plugin.githubClient) return;

  plugin.isSyncInProgress = true;
  plugin.disableWatch();
  new Notice("Starting full sync...");

  try {
    const remoteTree = await plugin.githubClient.getTree();
    // 过滤 Markdown 和 图片
    const remoteFiles = remoteTree.tree.filter((node: GitHubTreeNode) => {
      const ext = node.path.split(".").pop()?.toLowerCase();
      return node.type === "blob" && (ext === "md" || IMAGE_EXTENSIONS.includes(ext || ""));
    });
    const remoteFilesMap = new Map<string, string>(remoteFiles.map((f: GitHubTreeNode) => [f.path, f.sha] as [string, string]));

    const allLocalFiles = plugin.app.vault.getFiles();
    const localFilesMap = new Map<string, TFile>(allLocalFiles.map(f => [f.path, f]));

    // 1. 下拉远端变更
    for (const [path, remoteSha] of Array.from(remoteFilesMap.entries())) {
      const localFile = localFilesMap.get(path);
      const localState = plugin.syncData.files[path];

      // 强制修复逻辑：如果文件不存在，或者 SHA 不一致，或者本地文件大小为 0（说明之前同步出错了）
      const isLocalFileEmpty = localFile && localFile.stat.size === 0;
      
      if (!localFile || (localState && localState.sha !== remoteSha) || isLocalFileEmpty) {
        const remoteData = await plugin.githubClient.getFile(path);
        if (remoteData) {
          const ext = path.split(".").pop()?.toLowerCase();
          const isMarkdown = ext === "md";
          
          plugin.addIgnoredFile(path);
          
          // 确保文件夹存在
          const folderPath = path.split("/").slice(0, -1).join("/");
          if (folderPath && !plugin.app.vault.getAbstractFileByPath(folderPath)) {
            await plugin.app.vault.createFolder(folderPath);
          }

          // 处理 GitHub API 限制（大于 1MB 文件 content 为空）
          let finalContent: string | ArrayBuffer;
          if (!remoteData.content && remoteData.download_url) {
            const downloadRes = await requestUrl({ 
              url: remoteData.download_url,
              headers: plugin.githubClient.headers
            });
            finalContent = downloadRes.arrayBuffer;
          } else {
            finalContent = remoteData.content;
          }

          if (isMarkdown) {
            const content = typeof finalContent === "string" 
              ? GitHubClient.decodeContent(finalContent)
              : new TextDecoder().decode(finalContent);
              
            if (localFile) await plugin.app.vault.modify(localFile, content);
            else await plugin.app.vault.create(path, content);
            
            plugin.syncData.files[path] = {
              sha: remoteSha,
              lastSync: Date.now(),
              hash: hashContent(content)
            };
          } else {
            // 二进制处理
            let buffer: ArrayBuffer;
            if (typeof finalContent === "string") {
              const binaryString = atob(finalContent.replace(/\n/g, ""));
              const len = binaryString.length;
              const bytes = new Uint8Array(len);
              for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
              buffer = bytes.buffer;
            } else {
              buffer = finalContent;
            }
            
            if (localFile) await plugin.app.vault.modifyBinary(localFile, buffer);
            else await plugin.app.vault.createBinary(path, buffer);
            
            const newlyCreatedFile = plugin.app.vault.getAbstractFileByPath(path);
            if (newlyCreatedFile instanceof TFile) {
               plugin.syncData.files[path] = {
                 sha: remoteSha,
                 lastSync: Date.now(),
                 hash: newlyCreatedFile.stat.size + "_" + newlyCreatedFile.stat.mtime
               };
            }
          }
          plugin.removeIgnoredFile(path);
        }
      }
    }

    // 2. 推送本地新文件
    for (const file of allLocalFiles) {
      const isMarkdown = file.extension === "md";
      const isImage = IMAGE_EXTENSIONS.includes(file.extension.toLowerCase());
      if (!isMarkdown && !isImage) continue;
      if (file.stat.size > MAX_FILE_SIZE) continue;

      const remoteSha = remoteFilesMap.get(file.path);
      if (!remoteSha) {
        let content: string | ArrayBuffer;
        let currentHash: string;
        if (isMarkdown) {
          content = await plugin.app.vault.read(file);
          currentHash = hashContent(content);
        } else {
          content = await plugin.app.vault.readBinary(file);
          currentHash = file.stat.size + "_" + file.stat.mtime;
        }

        const newSha = await plugin.githubClient.putFile(file.path, content);
        plugin.syncData.files[file.path] = {
          sha: newSha,
          lastSync: Date.now(),
          hash: currentHash
        };
      }
    }
    
    await plugin.saveSyncData();
    await plugin.updateStats();
    new Notice("Sync completed");
  } catch (error) {
    console.error("Sync failed:", error);
  } finally {
    plugin.isSyncInProgress = false;
    plugin.enableWatch();
  }
}

export const StartupFullNotesSync = (plugin: FastSync): void => {
  void syncAllFilesImpl(plugin);
};
