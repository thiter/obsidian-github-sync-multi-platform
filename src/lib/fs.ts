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
    
    // 只同步 Markdown 笔记和图片，其余类型（.zip .canvas .base 等）跳过
    // 避免向 GitHub API 发送无法处理的文件类型导致 422
    if (!isMarkdown && !isImage) {
      return;
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
    // B6: updateStats 异步执行，不阻塞主流程
    plugin.updateStats().catch(e => console.error("Stats update failed:", e));
    new Notice("All assets synced to GitHub");
  } catch (error) {
    console.error("Force sync failed:", error);
    // B3: 失败时弹出通知，用户可感知
    new Notice(`Sync failed: ${(error as Error).message}`);
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
    let step1Count = 0;
    for (const [path, remoteSha] of Array.from(remoteFilesMap.entries())) {
      try {
        const localFile = localFilesMap.get(path);
        const localState = plugin.syncData.files[path];

        const isLocalFileEmpty = localFile && localFile.stat.size === 0;
        
        if (!localFile || (localState && localState.sha !== remoteSha) || isLocalFileEmpty) {
          const remoteData = await plugin.githubClient.getFile(path);
          if (remoteData) {
            const ext = path.split(".").pop()?.toLowerCase();
            const isMarkdown = ext === "md";
            
            plugin.addIgnoredFile(path);
            
            const folderPath = path.split("/").slice(0, -1).join("/");
            if (folderPath && !plugin.app.vault.getAbstractFileByPath(folderPath)) {
              await plugin.app.vault.createFolder(folderPath);
            }

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
            step1Count++;
          }
        }
      } catch (fileError) {
        // 单个文件失败不中断整个同步
        console.error(`Step1 failed for ${path}:`, fileError);
      }
    }


    // 2. 推送本地文件：新增文件 + 本地内容有变化的已有文件
    let step2Push = 0, step2Skip = 0, step2Fail = 0;
    for (const file of allLocalFiles) {
      const isMarkdown = file.extension === "md";
      const isImage = IMAGE_EXTENSIONS.includes(file.extension.toLowerCase());
      if (!isMarkdown && !isImage) continue;
      if (file.stat.size > MAX_FILE_SIZE) continue;

      try {
        const remoteSha = remoteFilesMap.get(file.path);
        const localState = plugin.syncData.files[file.path];

        // 计算当前内容 hash
        let content: string | ArrayBuffer;
        let currentHash: string;
        if (isMarkdown) {
          content = await plugin.app.vault.read(file);
          currentHash = hashContent(content);
        } else {
          content = await plugin.app.vault.readBinary(file);
          currentHash = file.stat.size + "_" + file.stat.mtime;
        }

        if (!remoteSha) {
          // 远端没有 → 新增文件，直接上传
          const newSha = await plugin.githubClient.putFile(file.path, content);
          plugin.syncData.files[file.path] = {
            sha: newSha,
            lastSync: Date.now(),
            hash: currentHash
          };
          step2Push++;
        } else if (!localState || localState.hash !== currentHash) {
          // B2: 远端有、但本地内容发生了变化 → 推送本地改动
          const newSha = await plugin.githubClient.putFile(file.path, content, remoteSha);
          plugin.syncData.files[file.path] = {
            sha: newSha,
            lastSync: Date.now(),
            hash: currentHash
          };
          step2Push++;
        } else {
          // 两端内容一致，只更新本地 sha 缓存（防止 performSync 重复触发）
          plugin.syncData.files[file.path] = {
            sha: remoteSha,
            lastSync: plugin.syncData.files[file.path]?.lastSync ?? Date.now(),
            hash: currentHash  // 更新为当前真实 hash
          };
          step2Skip++;
        }
      } catch (fileError) {
        // 单个文件失败不中断整个同步
        console.error(`Step2 failed for ${file.path}:`, fileError);
        step2Fail++;
      }
    }
    
    await plugin.saveSyncData();
    // B6: updateStats 异步执行，不阻塞主同步流程
    plugin.updateStats().catch(e => console.error("Stats update failed:", e));
    new Notice("Sync completed");
  } catch (error) {
    console.error("Sync failed:", error);
    // B3: 同步失败时弹出通知
    new Notice(`❌ Sync failed: ${(error as Error).message}`);
  } finally {
    plugin.isSyncInProgress = false;
    plugin.enableWatch();
  }
}

export const StartupFullNotesSync = (plugin: FastSync): void => {
  void syncAllFilesImpl(plugin);
};
