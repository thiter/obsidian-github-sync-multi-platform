import { TFile, TFolder, TAbstractFile, Notice, requestUrl, Vault, normalizePath } from "obsidian";

import { computeGitBlobSha, dump } from "./helps";
import FastSync from "../main";
import { GitHubClient, GitHubTreeNode, GitTreeEntry } from "./github-api";
import { unzip, Unzipped } from "fflate";
import { $ } from "../lang/lang";
import {
  MAX_FILE_SIZE,
  UnifiedSyncFile,
  getAllVaultSyncFiles,
  safeEnsureFolderExists,
  safeReadSyncFile,
  safeWriteSyncFile,
  safeDeleteSyncFile,
  isPathBlocked,
  isWhitelistedHiddenPath,
} from "./storage";

/**
 * 递归确保多级目录存在
 * 兼容原有接口，底层委托给 safeEnsureFolderExists
 */
export async function ensureFolderExists(vault: Vault, folderPath: string): Promise<void> {
  await safeEnsureFolderExists(vault, folderPath);
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
    const matchingPaths = Object.keys(plugin.syncData.files).filter((p) => p.startsWith(prefix));

    if (matchingPaths.length === 0) return;

    const treeEntries: GitTreeEntry[] = [];
    const pendingUpdates: Array<{ oldPath: string; newPath: string; sha: string; hash: string }> = [];

    for (const oldPath of matchingPaths) {
      plugin.addIgnoredFile(oldPath);
      const relPath = oldPath.slice(prefix.length);
      const newPath = `${file.path}/${relPath}`;
      plugin.addIgnoredFile(newPath);

      const oldState = plugin.syncData.files[oldPath];
      if (!oldState) continue;

      // 1. 旧路径标记删除 (sha: null)
      treeEntries.push({
        path: oldPath,
        mode: "100644",
        type: "blob",
        sha: null,
      });

      // 2. 检查新路径内容是否发生过变化，未变化则直接复用旧 Blob SHA（0 上传消耗！）
      let finalSha = oldState.sha;
      let finalHash = oldState.hash || oldState.sha;
      const newLocalFile = plugin.app.vault.getAbstractFileByPath(newPath);
      if (newLocalFile instanceof TFile && newLocalFile.stat.size <= MAX_FILE_SIZE) {
        try {
          const content =
            newLocalFile.extension === "md"
              ? await plugin.app.vault.read(newLocalFile)
              : await plugin.app.vault.readBinary(newLocalFile);
          const currentSha = await computeGitBlobSha(content);
          if (currentSha !== oldState.sha && currentSha !== oldState.hash) {
            finalSha = await plugin.githubClient.createBlob(content);
            finalHash = currentSha;
          }
        } catch (readErr) {
          console.warn(`Failed to read renamed file ${newPath}, fallback to old sha:`, readErr);
        }
      }

      // 3. 新路径挂载 finalSha (0 上传直接迁移原文件 Blob)
      treeEntries.push({
        path: newPath,
        mode: "100644",
        type: "blob",
        sha: finalSha,
      });

      pendingUpdates.push({
        oldPath,
        newPath,
        sha: finalSha,
        hash: finalHash,
      });
    }

    try {
      await plugin.githubClient.commitBatch(
        `sync: rename folder ${oldfile} -> ${file.path} (${matchingPaths.length} files)`,
        treeEntries
      );

      // 提交成功后原子更新 syncData
      for (const update of pendingUpdates) {
        delete plugin.syncData.files[update.oldPath];
        plugin.syncData.files[update.newPath] = {
          sha: update.sha,
          lastSync: Date.now(),
          hash: update.hash,
        };
      }
      await plugin.saveSyncData();
      dump(`Batch renamed folder ${oldfile} -> ${file.path} via Git Data API`);
    } catch (err) {
      console.error(`Folder batch rename failed:`, err);
      new Notice(`Folder rename failed: ${(err as Error).message}`);
    } finally {
      for (const update of pendingUpdates) {
        plugin.removeIgnoredFile(update.oldPath);
        plugin.removeIgnoredFile(update.newPath);
      }
    }
    return;
  }

  // 2. 如果重命名的是单个文件 (TFile)
  if (!(file instanceof TFile)) return;
  if (file.stat.size > MAX_FILE_SIZE) return;

  plugin.addIgnoredFile(file.path);
  plugin.addIgnoredFile(oldfile);

  try {
    const oldState = plugin.syncData.files[oldfile];
    let finalSha = oldState?.sha;
    let finalHash = oldState?.hash || oldState?.sha;

    const isMarkdown = file.extension === "md";
    let content: string | ArrayBuffer;
    if (isMarkdown) {
      content = await plugin.app.vault.read(file);
    } else {
      content = await plugin.app.vault.readBinary(file);
    }
    const currentSha = await computeGitBlobSha(content);

    // 如果内容改变或者没有旧 SHA，上传新 Blob
    if (!finalSha || (currentSha !== oldState?.sha && currentSha !== oldState?.hash)) {
      finalSha = await plugin.githubClient.createBlob(content);
      finalHash = currentSha;
    }

    const treeEntries: GitTreeEntry[] = [
      { path: oldfile, mode: "100644", type: "blob", sha: null },
      { path: file.path, mode: "100644", type: "blob", sha: finalSha },
    ];

    await plugin.githubClient.commitBatch(
      `sync: rename ${oldfile} -> ${file.path}`,
      treeEntries
    );

    delete plugin.syncData.files[oldfile];
    plugin.syncData.files[file.path] = {
      sha: finalSha,
      lastSync: Date.now(),
      hash: finalHash || currentSha,
    };
    await plugin.saveSyncData();
    dump(`Renamed ${oldfile} -> ${file.path} via Git Data API`);
  } catch (error) {
    console.error("Rename failed:", error);
    new Notice(`Rename failed: ${(error as Error).message}`);
  } finally {
    plugin.removeIgnoredFile(file.path);
    plugin.removeIgnoredFile(oldfile);
  }
};

/**
 * 强制全量覆盖远端
 * 基于 Git Data API：本地全量树一次性打包提交，生成单个原子 Commit
 */
export async function overrideRemoteAllFilesImpl(plugin: FastSync): Promise<void> {
  if (plugin.isSyncInProgress) {
    new Notice("Sync in progress...");
    return;
  }
  if (!plugin.githubClient) return;

  plugin.debounceTimers.forEach((timer) => clearTimeout(timer));
  plugin.debounceTimers.clear();

  plugin.isSyncInProgress = true;
  plugin.disableWatch();

  try {
    // 1. 获取远端 Tree 进行 SHA 对比，内容已完全一致的文件直接跳过，绝不重复上传
    let remoteFilesMap = new Map<string, string>();
    try {
      const remoteTree = await plugin.githubClient.getTree();
      remoteFilesMap = new Map<string, string>(
        remoteTree.tree.filter((node: GitHubTreeNode) => node.type === "blob").map((f) => [f.path, f.sha])
      );
    } catch (e) {
      console.warn("Failed to get remote tree in override, will fall back to cache check:", e);
    }

    const syncFilesMap = await getAllVaultSyncFiles(plugin.app.vault);
    const syncFiles = Array.from(syncFilesMap.values());

    const treeEntries: GitTreeEntry[] = [];
    const updatedSyncData: { [path: string]: { sha: string; lastSync: number; hash: string } } = {};

    new Notice(`Preparing ${syncFiles.length} files for remote override...`);

    for (const syncFile of syncFiles) {
      const content = await safeReadSyncFile(plugin.app.vault, syncFile);
      const currentSha = await computeGitBlobSha(content);
      const remoteSha = remoteFilesMap.get(syncFile.path);
      let finalBlobSha = remoteSha;

      // 核心优化：若远端 SHA 已经与本地计算的 SHA 完全一致，直接复用 blob SHA，跳过上传！
      if (!finalBlobSha || remoteSha !== currentSha) {
        finalBlobSha = await plugin.githubClient.createBlob(content);
      }

      treeEntries.push({
        path: syncFile.path,
        mode: "100644",
        type: "blob",
        sha: finalBlobSha,
      });

      updatedSyncData[syncFile.path] = {
        sha: finalBlobSha,
        lastSync: Date.now(),
        hash: currentSha,
      };
    }

    // 2. 将整棵树作为全新根树一次性提交 (explicitBaseTreeSha: null 表示全新根树，自动清理远端孤儿文件)
    await plugin.githubClient.commitBatch(
      `sync: override remote with all local assets (${syncFiles.length} files)`,
      treeEntries,
      null
    );

    // 3. 更新同步元数据
    plugin.syncData.files = updatedSyncData;
    await plugin.saveSyncData();
    plugin.updateStats().catch((e) => console.error("Stats update failed:", e));
    new Notice("All assets synced to GitHub (1 atomic commit)");
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

export function unzipBuffer(buffer: ArrayBuffer): Promise<Unzipped> {
  return new Promise((resolve, reject) => {
    unzip(new Uint8Array(buffer), (err, unzipped) => {
      if (err) return reject(err);
      resolve(unzipped);
    });
  });
}

/**
 * 强制全量覆盖本地（以 GitHub 远端快照为准）
 * 核心特性：通过 Zipball API 1 次 HTTP 请求下载全库，本地内存解压覆写，0 上传消耗
 */
export async function forcePullRemoteAllFilesImpl(plugin: FastSync): Promise<void> {
  if (plugin.isSyncInProgress) {
    new Notice("Sync in progress...");
    return;
  }
  if (!plugin.githubClient) {
    new Notice("GitHub Client is not configured");
    return;
  }

  plugin.debounceTimers.forEach((timer) => clearTimeout(timer));
  plugin.debounceTimers.clear();

  plugin.isSyncInProgress = true;
  plugin.disableWatch();

  try {
    new Notice($("正在下载远端快照(Zipball)..."));
    let zipBuffer: ArrayBuffer;
    try {
      zipBuffer = await plugin.githubClient.downloadZipball();
    } catch (e) {
      if ((e as Error).message === "EMPTY_REPO") {
        new Notice($("远端仓库为空，没有可下载的内容"));
        return;
      }
      throw e;
    }

    new Notice($("正在解压并同步到本地..."));
    const unzipped = await unzipBuffer(zipBuffer);

    // 过滤并提取有效文件：GitHub zipball 根目录是 <owner>-<repo>-<commitSha>/...
    const remoteFilesMap = new Map<string, Uint8Array>();
    for (const [key, data] of Object.entries(unzipped)) {
      const parts = key.split("/");
      const relPath = parts.slice(1).join("/");
      if (!relPath || key.endsWith("/")) continue;

      const normalizedPath = normalizePath(relPath);
      if (isPathBlocked(normalizedPath)) {
        continue;
      }
      const segments = normalizedPath.split("/");
      const isHidden = segments.some((seg) => seg.startsWith("."));
      if (isHidden && !isWhitelistedHiddenPath(normalizedPath)) {
        continue;
      }
      if (data.byteLength > MAX_FILE_SIZE) {
        console.warn(`[Sync] Skipping large remote file (>10MB): ${normalizedPath}`);
        continue;
      }

      remoteFilesMap.set(normalizedPath, data);
    }

    // 1. 获取本地全量同步文件 (包含 .github/ 白名单目录)
    const localFilesMap = await getAllVaultSyncFiles(plugin.app.vault);

    // 2. 清理本地存在但远端已被删除或不存在的孤儿文件
    for (const localPath of localFilesMap.keys()) {
      if (!remoteFilesMap.has(localPath)) {
        plugin.addIgnoredFile(localPath);
        try {
          await safeDeleteSyncFile(plugin.app.vault, localPath);
          delete plugin.syncData.files[localPath];
          dump(`Deleted local orphan file during force pull: ${localPath}`);
        } catch (delErr) {
          console.error(`Failed to delete local file ${localPath}:`, delErr);
        } finally {
          plugin.removeIgnoredFile(localPath);
        }
      }
    }

    // 3. 写入远端文件至本地
    for (const [path, data] of remoteFilesMap.entries()) {
      plugin.addIgnoredFile(path);
      try {
        const ext = path.split(".").pop()?.toLowerCase();
        const isMarkdown = ext === "md";
        const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
        const currentSha = await computeGitBlobSha(buffer);

        const cachedSha = plugin.syncData.files[path]?.sha;
        const existsLocally = localFilesMap.has(path);

        if (!existsLocally || cachedSha !== currentSha) {
          await safeWriteSyncFile(plugin.app.vault, path, buffer, isMarkdown);
        }

        // 重建 syncData 状态
        plugin.syncData.files[path] = {
          sha: currentSha,
          lastSync: Date.now(),
          hash: currentSha,
        };
      } catch (fileErr) {
        console.error(`Failed to write file ${path} during force pull:`, fileErr);
      } finally {
        plugin.removeIgnoredFile(path);
      }
    }

    await plugin.saveSyncData();
    plugin.updateStats().catch((e) => console.error("Stats update failed:", e));
    new Notice($("远端笔记已成功覆盖至本地！"));
  } catch (error) {
    console.error("Force pull failed:", error);
    new Notice(`❌ Force pull failed: ${(error as Error).message}`);
  } finally {
    plugin.isSyncInProgress = false;
    plugin.enableWatch();
  }
}

export const StartupFullNotesForcePullSync = (plugin: FastSync): void => {
  void forcePullRemoteAllFilesImpl(plugin);
};

/**
 * 辅助下载远程文件并写入本地，且自动创建上级目录
 */
async function downloadRemoteFile(
  path: string,
  remoteSha: string,
  plugin: FastSync,
  _existingLocalFile?: unknown
): Promise<void> {
  const remoteData = await plugin.githubClient.getFile(path);
  if (!remoteData) return;

  const ext = path.split(".").pop()?.toLowerCase();
  const isMarkdown = ext === "md";

  plugin.addIgnoredFile(path);
  try {
    let buffer: ArrayBuffer;
    if (!remoteData.content && remoteData.download_url) {
      const downloadRes = await requestUrl({ 
        url: remoteData.download_url,
        headers: plugin.githubClient.headers
      });
      buffer = downloadRes.arrayBuffer;
    } else if (typeof remoteData.content === "string") {
      const binaryString = atob(remoteData.content.replace(/\n/g, ""));
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
      buffer = bytes.buffer;
    } else {
      buffer = remoteData.content as ArrayBuffer;
    }

    await safeWriteSyncFile(plugin.app.vault, path, buffer, isMarkdown);

    const localSha = await computeGitBlobSha(buffer);
    plugin.syncData.files[path] = {
      sha: remoteSha,
      lastSync: Date.now(),
      hash: localSha
    };
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
      if (node.type !== "blob") return false;
      const normalized = normalizePath(node.path);
      if (isPathBlocked(normalized)) return false;
      const segments = normalized.split("/");
      const isHidden = segments.some((seg) => seg.startsWith("."));
      if (isHidden && !isWhitelistedHiddenPath(normalized)) return false;
      return true;
    });
    const remoteFilesMap = new Map<string, string>(
      remoteFiles.map((f: GitHubTreeNode) => [f.path, f.sha] as [string, string])
    );

    const localFilesMap = await getAllVaultSyncFiles(plugin.app.vault);
    const allLocalFiles = Array.from(localFilesMap.values());

    // ----------------------------------------------------
    // 步骤 1: 检查“远端已被删除”的文件（被其他设备删除）
    // 如果 syncData 有记录，但远端 Tree 已经没有了：说明远端删除了该文件，本地同步删除
    // ----------------------------------------------------
    for (const trackedPath of Object.keys(plugin.syncData.files)) {
      if (isPathBlocked(trackedPath)) {
        delete plugin.syncData.files[trackedPath];
        continue;
      }
      if (!remoteFilesMap.has(trackedPath)) {
        if (localFilesMap.has(trackedPath)) {
          plugin.addIgnoredFile(trackedPath);
          try {
            await safeDeleteSyncFile(plugin.app.vault, trackedPath);
            localFilesMap.delete(trackedPath);
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
          const localContent = await safeReadSyncFile(plugin.app.vault, localFile);
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
            if (localContent.byteLength === 0 || cachedSha !== remoteSha) {
              // 远端发生了修改，下载远端最新内容覆盖本地
              await downloadRemoteFile(path, remoteSha, plugin);
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
        const content = await safeReadSyncFile(plugin.app.vault, localFile);
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
