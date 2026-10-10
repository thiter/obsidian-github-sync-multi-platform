import { TFile, TFolder, TAbstractFile, Notice, requestUrl, Vault } from "obsidian";

import { computeGitBlobSha, dump } from "./helps";
import FastSync from "../main";
import { GitHubClient, GitHubTreeNode } from "./github-api";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * 递归确保多级目录存在
 * 解决 Obsidian vault.createFolder 遇到嵌套路径未提前创建父目录时报错的问题
 */
export async function ensureFolderExists(vault: Vault, folderPath: string): Promise<void> {
  if (!folderPath || folderPath === "/" || folderPath === ".") return;
  const normalized = folderPath.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
  if (!normalized) return;
  const parts = normalized.split("/");
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    const existing = vault.getAbstractFileByPath(current);
    if (!existing) {
      try {
        await vault.createFolder(current);
      } catch (e) {
        // 如果已被并发创建或已存在，跳过抛错
        if (!vault.getAbstractFileByPath(current)) {
          throw e;
        }
      }
    }
  }
}

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
    // 边界拦截：超过 MAX_FILE_SIZE (10MB) 必须跳过，防止内存飙升与 GitHub API 422
    if (file.stat.size > MAX_FILE_SIZE) {
      new Notice(`File too large (>10MB): ${file.path}. Skipped sync.`);
      return;
    }

    const isMarkdown = file.extension === "md";

    let content: string | ArrayBuffer;
    if (isMarkdown) {
      content = await plugin.app.vault.read(file);
    } else {
      content = await plugin.app.vault.readBinary(file);
    }

    // 3. 计算 Git Blob SHA 校验内容是否变化
    const currentSha = await computeGitBlobSha(content);
    const cachedState = plugin.syncData.files[file.path];
    if (cachedState && (cachedState.sha === currentSha || cachedState.hash === currentSha)) {
      dump(`No content change for ${file.path}, skip sync.`);
      return;
    }

    const sha = cachedState?.sha;
    const newSha = await plugin.githubClient.putFile(file.path, content, sha);

    plugin.syncData.files[file.path] = {
      sha: newSha,
      lastSync: Date.now(),
      hash: currentSha
    };
    await plugin.saveSyncData();
    dump(`Synced ${file.path} to GitHub`, newSha);

  } catch (error) {
    console.error("Sync failed:", error);
    new Notice(`Sync failed for ${file.path}: ${(error as Error).message}`);
  } finally {
    plugin.removeIgnoredFile(file.path);
  }
};

export const NoteDelete = async function (file: TAbstractFile, plugin: FastSync, eventEnter: boolean = false) {
  if (!plugin.isWatchEnabled && eventEnter) return;
  if (plugin.ignoredFiles.has(file.path) && eventEnter) return;
  if (!plugin.githubClient) return;

  // 1. 如果删除的是文件夹 (TFolder)
  if (file instanceof TFolder) {
    const prefix = file.path.endsWith("/") ? file.path : `${file.path}/`;
    const matchingPaths = Object.keys(plugin.syncData.files).filter(p => p.startsWith(prefix));

    for (const path of matchingPaths) {
      if (plugin.debounceTimers.has(path)) {
        clearTimeout(plugin.debounceTimers.get(path));
        plugin.debounceTimers.delete(path);
      }
      plugin.addIgnoredFile(path);
      try {
        const sha = plugin.syncData.files[path]?.sha;
        if (sha) {
          await plugin.githubClient.deleteFile(path, sha);
          delete plugin.syncData.files[path];
          dump(`Deleted subfile ${path} from GitHub`);
        }
      } catch (error) {
        console.error(`Delete failed for folder subfile ${path}:`, error);
      } finally {
        plugin.removeIgnoredFile(path);
      }
    }
    await plugin.saveSyncData();
    return;
  }

  // 2. 如果删除的是单个文件 (TFile)
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
  if (!plugin.isWatchEnabled && eventEnter) return;
  if (!plugin.githubClient) return;

  // 1. 如果重命名的是文件夹 (TFolder)
  if (file instanceof TFolder) {
    const prefix = oldfile.endsWith("/") ? oldfile : `${oldfile}/`;
    const matchingPaths = Object.keys(plugin.syncData.files).filter(p => p.startsWith(prefix));

    for (const oldPath of matchingPaths) {
      plugin.addIgnoredFile(oldPath);
      try {
        const relPath = oldPath.slice(prefix.length);
        const newPath = `${file.path}/${relPath}`;
        const oldSha = plugin.syncData.files[oldPath]?.sha;

        if (oldSha) {
          await plugin.githubClient.deleteFile(oldPath, oldSha);
          delete plugin.syncData.files[oldPath];
        }

        const newLocalFile = plugin.app.vault.getAbstractFileByPath(newPath);
        if (newLocalFile instanceof TFile) {
          if (newLocalFile.stat.size > MAX_FILE_SIZE) continue;
          let content: string | ArrayBuffer;
          if (newLocalFile.extension === "md") {
            content = await plugin.app.vault.read(newLocalFile);
          } else {
            content = await plugin.app.vault.readBinary(newLocalFile);
          }
          const currentSha = await computeGitBlobSha(content);
          const newSha = await plugin.githubClient.putFile(newPath, content);
          plugin.syncData.files[newPath] = {
            sha: newSha,
            lastSync: Date.now(),
            hash: currentSha
          };
        }
      } catch (err) {
        console.error(`Folder rename failed for file ${oldPath}:`, err);
      } finally {
        plugin.removeIgnoredFile(oldPath);
      }
    }
    await plugin.saveSyncData();
    return;
  }

  // 2. 如果重命名的是单个文件 (TFile)
  if (!(file instanceof TFile)) return;
  if (file.stat.size > MAX_FILE_SIZE) return;

  plugin.addIgnoredFile(file.path);
  try {
    // 删除旧路径
    const oldSha = plugin.syncData.files[oldfile]?.sha;
    if (oldSha) {
      await plugin.githubClient.deleteFile(oldfile, oldSha);
      delete plugin.syncData.files[oldfile];
    }

    // 上传新路径
    const isMarkdown = file.extension === "md";
    let content: string | ArrayBuffer;

    if (isMarkdown) {
      content = await plugin.app.vault.read(file);
    } else {
      content = await plugin.app.vault.readBinary(file);
    }

    const currentSha = await computeGitBlobSha(content);
    const newSha = await plugin.githubClient.putFile(file.path, content);
    plugin.syncData.files[file.path] = {
      sha: newSha,
      lastSync: Date.now(),
      hash: currentSha
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
 * 强制全量覆盖远端
 */
export async function overrideRemoteAllFilesImpl(plugin: FastSync): Promise<void> {
  if (plugin.isSyncInProgress) {
    new Notice("Sync in progress...");
    return;
  }
  if (!plugin.githubClient) return;

  plugin.debounceTimers.forEach(timer => clearTimeout(timer));
  plugin.debounceTimers.clear();

  plugin.isSyncInProgress = true;
  plugin.disableWatch();
  
  try {
    // 先获取远端 Tree 进行 SHA 对比，内容已完全一致的文件直接跳过，绝不重复上传
    let remoteFilesMap = new Map<string, string>();
    try {
      const remoteTree = await plugin.githubClient.getTree();
      remoteFilesMap = new Map<string, string>(
        remoteTree.tree.filter((node: GitHubTreeNode) => node.type === "blob").map(f => [f.path, f.sha])
      );
    } catch (e) {
      console.warn("Failed to get remote tree in override, will fall back to cache check:", e);
    }

    const files = plugin.app.vault.getFiles();
    for (const file of files) {
       if (file.stat.size > MAX_FILE_SIZE) continue;
       
       const isMarkdown = file.extension === "md";

       let content: string | ArrayBuffer;
       if (isMarkdown) {
         content = await plugin.app.vault.read(file);
       } else {
         content = await plugin.app.vault.readBinary(file);
       }

       const currentSha = await computeGitBlobSha(content);
       const remoteSha = remoteFilesMap.get(file.path);
       const cachedSha = plugin.syncData.files[file.path]?.sha;

       // 核心优化：若远端 SHA 已经与本地计算的 SHA 完全一致，直接跳过上传！
       if (remoteSha && remoteSha === currentSha) {
         plugin.syncData.files[file.path] = {
           sha: remoteSha,
           lastSync: Date.now(),
           hash: currentSha
         };
         continue;
       }

       const newSha = await plugin.githubClient.putFile(file.path, content, remoteSha || cachedSha);
       plugin.syncData.files[file.path] = {
         sha: newSha,
         lastSync: Date.now(),
         hash: currentSha
       };
    }
    await plugin.saveSyncData();
    plugin.updateStats().catch(e => console.error("Stats update failed:", e));
    new Notice("All assets synced to GitHub");
  } catch (error) {
    console.error("Force sync failed:", error);
    new Notice(`Sync failed: ${(error as Error).message}`);
  } finally {
    plugin.isSyncInProgress = false;
    plugin.enableWatch();
  }
}

export const StartupFullNotesForceOverSync = (plugin: FastSync): void => {
  void overrideRemoteAllFilesImpl(plugin);
};

/**
 * 辅助下载远程文件并写入本地，且自动创建上级目录
 */
async function downloadRemoteFile(
  path: string,
  remoteSha: string,
  plugin: FastSync,
  existingLocalFile?: TFile
): Promise<void> {
  const remoteData = await plugin.githubClient.getFile(path);
  if (!remoteData) return;

  const ext = path.split(".").pop()?.toLowerCase();
  const isMarkdown = ext === "md";

  plugin.addIgnoredFile(path);
  try {
    const folderPath = path.split("/").slice(0, -1).join("/");
    if (folderPath) {
      await ensureFolderExists(plugin.app.vault, folderPath);
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
        
      if (existingLocalFile) {
        await plugin.app.vault.modify(existingLocalFile, content);
      } else {
        await plugin.app.vault.create(path, content);
      }
      
      const localSha = await computeGitBlobSha(content);
      plugin.syncData.files[path] = {
        sha: remoteSha,
        lastSync: Date.now(),
        hash: localSha
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
      
      if (existingLocalFile) {
        await plugin.app.vault.modifyBinary(existingLocalFile, buffer);
      } else {
        await plugin.app.vault.createBinary(path, buffer);
      }
      
      const localSha = await computeGitBlobSha(buffer);
      plugin.syncData.files[path] = {
        sha: remoteSha,
        lastSync: Date.now(),
        hash: localSha
      };
    }
  } finally {
    plugin.removeIgnoredFile(path);
  }
}

/**
 * 经典 3-Way 状态对齐全量双向同步
 */
export async function syncAllFilesImpl(plugin: FastSync): Promise<void> {
  if (plugin.isSyncInProgress) return;
  if (!plugin.githubClient) return;

  // 清除所有正在等待的防抖定时器，防止全量同步过程中发生并发冲突
  plugin.debounceTimers.forEach(timer => clearTimeout(timer));
  plugin.debounceTimers.clear();

  plugin.isSyncInProgress = true;
  plugin.disableWatch();

  try {
    const remoteTree = await plugin.githubClient.getTree();
    // 支持同步 Vault 中的所有文件类型；Markdown 作为文本处理，其余文件作为二进制处理
    const remoteFiles = remoteTree.tree.filter((node: GitHubTreeNode) => {
      return node.type === "blob";
    });
    const remoteFilesMap = new Map<string, string>(
      remoteFiles.map((f: GitHubTreeNode) => [f.path, f.sha] as [string, string])
    );

    const allLocalFiles = plugin.app.vault.getFiles().filter(file => {
      return file.stat.size <= MAX_FILE_SIZE;
    });
    const localFilesMap = new Map<string, TFile>(allLocalFiles.map(f => [f.path, f]));

    // ----------------------------------------------------
    // 步骤 1: 检查“远端已被删除”的文件（被其他设备删除）
    // 如果 syncData 有记录，但远端 Tree 已经没有了：说明远端删除了该文件，本地同步删除
    // ----------------------------------------------------
    for (const trackedPath of Object.keys(plugin.syncData.files)) {
      if (!remoteFilesMap.has(trackedPath)) {
        const localFile = localFilesMap.get(trackedPath);
        if (localFile) {
          plugin.addIgnoredFile(trackedPath);
          try {
            await plugin.app.vault.delete(localFile);
            localFilesMap.delete(trackedPath);
            // 若父目录空了，顺便清理空目录
            const parent = localFile.parent;
            if (parent && parent.children.length === 0 && parent.path !== "" && parent.path !== "/") {
              try {
                await plugin.app.vault.delete(parent);
              } catch (e) {
                // 忽略清理空文件夹错误
              }
            }
          } catch (delErr) {
            console.error(`Failed to delete local file ${trackedPath}:`, delErr);
          } finally {
            plugin.removeIgnoredFile(trackedPath);
          }
        }
        delete plugin.syncData.files[trackedPath];
      }
    }

    // ----------------------------------------------------
    // 步骤 2: 遍历远端文件
    // ----------------------------------------------------
    for (const [path, remoteSha] of Array.from(remoteFilesMap.entries())) {
      try {
        const localFile = localFilesMap.get(path);
        const isTracked = !!plugin.syncData.files[path];

        if (!localFile) {
          if (isTracked) {
            // 本地删除了该文件，但远端还在 -> 同步删除远端文件
            try {
              await plugin.githubClient.deleteFile(path, remoteSha);
              delete plugin.syncData.files[path];
              dump(`Deleted remote file ${path} because it was deleted locally.`);
            } catch (e) {
              console.error(`Failed to delete remote file ${path}:`, e);
            }
          } else {
            // 远端新建的文件 -> 下载到本地
            await downloadRemoteFile(path, remoteSha, plugin);
          }
        } else {
          // 本地存在该文件：计算真实 Git Blob SHA 进行比对
          let localContent: string | ArrayBuffer;
          if (localFile.extension === "md") {
            localContent = await plugin.app.vault.read(localFile);
          } else {
            localContent = await plugin.app.vault.readBinary(localFile);
          }
          const localSha = await computeGitBlobSha(localContent);

          if (localSha === remoteSha) {
            // 两端内容完全一致，更新缓存状态
            plugin.syncData.files[path] = {
              sha: remoteSha,
              lastSync: Date.now(),
              hash: localSha
            };
          } else {
            // 内容不一致：
            const cachedSha = plugin.syncData.files[path]?.sha;
            if (localFile.stat.size === 0 || cachedSha !== remoteSha) {
              // 远端发生了修改，下载远端最新内容覆盖本地
              await downloadRemoteFile(path, remoteSha, plugin, localFile);
            } else {
              // 本地发生了修改，推送到远端
              const newSha = await plugin.githubClient.putFile(path, localContent, remoteSha);
              plugin.syncData.files[path] = {
                sha: newSha,
                lastSync: Date.now(),
                hash: localSha
              };
            }
          }
        }
      } catch (fileError) {
        console.error(`Step 2 failed for ${path}:`, fileError);
      }
    }

    // ----------------------------------------------------
    // 步骤 3: 遍历本地文件，推送本地真正新建的文件
    // ----------------------------------------------------
    for (const localFile of allLocalFiles) {
      const path = localFile.path;
      if (remoteFilesMap.has(path)) continue; // 已经在步骤 2 中处理
      if (plugin.syncData.files[path]) continue; // 已经在步骤 1 中被确认为远端删除

      try {
        let content: string | ArrayBuffer;
        if (localFile.extension === "md") {
          content = await plugin.app.vault.read(localFile);
        } else {
          content = await plugin.app.vault.readBinary(localFile);
        }
        const localSha = await computeGitBlobSha(content);
        const newSha = await plugin.githubClient.putFile(path, content);
        plugin.syncData.files[path] = {
          sha: newSha,
          lastSync: Date.now(),
          hash: localSha
        };
      } catch (pushErr) {
        console.error(`Step 3 failed for new local file ${path}:`, pushErr);
      }
    }
    
    await plugin.saveSyncData();
    plugin.updateStats().catch(e => console.error("Stats update failed:", e));
    new Notice("Sync completed");
  } catch (error) {
    console.error("Sync failed:", error);
    new Notice(`❌ Sync failed: ${(error as Error).message}`);
  } finally {
    plugin.isSyncInProgress = false;
    plugin.enableWatch();
  }
}

export const StartupFullNotesSync = (plugin: FastSync): void => {
  void syncAllFilesImpl(plugin);
};
