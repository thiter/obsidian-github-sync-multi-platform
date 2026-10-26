import { Vault, TFile, normalizePath } from "obsidian";

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
export const WHITELIST_HIDDEN_DIRS = [".github"];

export const BLACKLIST_PATTERNS = [
  /^\.git(\/|$)/i,
  /^\.obsidian(\/|$)/i,
  /^\.trash(\/|$)/i,
  /(^|\/)\.DS_Store$/i,
  /(^|\/)Thumbs\.db$/i,
];

export interface UnifiedSyncFile {
  path: string;           // 规范化 POSIX 路径 (如 .github/workflows/sync.yml)
  isMarkdown: boolean;    // 是否作为文本处理
  tFile?: TFile;          // 普通笔记保留 TFile 引用以优化性能；白名单文件此项为 undefined
}

export function isPathBlocked(path: string): boolean {
  const normalized = normalizePath(path);
  return BLACKLIST_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isWhitelistedHiddenPath(path: string): boolean {
  const normalized = normalizePath(path);
  if (isPathBlocked(normalized)) return false;
  return WHITELIST_HIDDEN_DIRS.some(
    (dir) => normalized.toLowerCase() === dir || normalized.toLowerCase().startsWith(`${dir}/`)
  );
}

export async function getWhitelistedHiddenFiles(vault: Vault): Promise<string[]> {
  const adapter = vault.adapter;
  const result: string[] = [];

  async function walk(dir: string) {
    try {
      // 关键守卫：iOS 下直接 list 不存在的文件夹会直接抛异常崩溃
      if (!(await adapter.exists(dir))) return;
      const listing = await adapter.list(dir);

      for (const filePath of listing.files) {
        const normalized = normalizePath(filePath);
        if (isPathBlocked(normalized)) continue;

        // P1 防御：移动端 OOM 防护，跳过 >10MB 大文件
        try {
          const stat = await adapter.stat(normalized);
          if (stat && stat.size > MAX_FILE_SIZE) {
            console.warn(`[Sync] Skipping large hidden file (>10MB): ${normalized}`);
            continue;
          }
        } catch {
          continue;
        }

        result.push(normalized);
      }

      for (const subDir of listing.folders) {
        const normalizedSub = normalizePath(subDir);
        if (!isPathBlocked(normalizedSub)) {
          await walk(normalizedSub);
        }
      }
    } catch (walkErr) {
      // P2 防御：单目录异常隔离，防止个别只读/损坏子目录打断全局同步
      console.warn(`[Sync] Failed to traverse hidden folder ${dir}:`, walkErr);
    }
  }

  for (const rootDir of WHITELIST_HIDDEN_DIRS) {
    await walk(rootDir);
  }
  return result;
}

export async function getAllVaultSyncFiles(vault: Vault): Promise<Map<string, UnifiedSyncFile>> {
  const fileMap = new Map<string, UnifiedSyncFile>();

  // 1. 获取普通文件 (过滤超过 10MB 的大文件)
  for (const file of vault.getFiles()) {
    if (file.stat.size > MAX_FILE_SIZE) continue;
    if (isPathBlocked(file.path)) continue;

    fileMap.set(file.path, {
      path: file.path,
      isMarkdown: file.extension === "md",
      tFile: file,
    });
  }

  // 2. 补齐白名单隐藏文件
  const hiddenPaths = await getWhitelistedHiddenFiles(vault);
  for (const p of hiddenPaths) {
    fileMap.set(p, {
      path: p,
      isMarkdown: p.toLowerCase().endsWith(".md"),
    });
  }

  return fileMap;
}

export async function safeEnsureFolderExists(vault: Vault, folderPath: string): Promise<void> {
  if (!folderPath || folderPath === "/" || folderPath === ".") return;
  const normalized = normalizePath(folderPath);
  if (!normalized || normalized === ".") return;
  const adapter = vault.adapter;
  const parts = normalized.split("/");
  let current = "";

  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    // 真理源以底层 adapter.exists 为准，彻底根治隐藏目录重复创建报错
    if (await adapter.exists(current)) continue;

    if (current.startsWith(".") || current.includes("/.")) {
      try {
        await adapter.mkdir(current);
      } catch (e) {
        if (!(await adapter.exists(current))) throw e;
      }
    } else {
      try {
        await vault.createFolder(current);
      } catch (e) {
        if (!(await adapter.exists(current))) throw e;
      }
    }
  }
}

export async function safeReadSyncFile(vault: Vault, entry: UnifiedSyncFile): Promise<ArrayBuffer> {
  if (entry.tFile) {
    return await vault.readBinary(entry.tFile);
  }
  return await vault.adapter.readBinary(entry.path);
}

export async function safeWriteSyncFile(
  vault: Vault,
  path: string,
  buffer: ArrayBuffer,
  isMarkdown: boolean
): Promise<void> {
  const normalized = normalizePath(path);
  if (isPathBlocked(normalized)) {
    throw new Error(`Security Violation: Blocked writing to blacklisted path: ${normalized}`);
  }

  const folder = normalized.split("/").slice(0, -1).join("/");
  if (folder) {
    await safeEnsureFolderExists(vault, folder);
  }

  if (isWhitelistedHiddenPath(normalized)) {
    // 白名单隐藏文件走 adapter 写入
    await vault.adapter.writeBinary(normalized, buffer);
  } else {
    // 普通文件优先走 TFile
    const existing = vault.getAbstractFileByPath(normalized);
    if (existing instanceof TFile) {
      if (isMarkdown) {
        await vault.modify(existing, new TextDecoder().decode(buffer));
      } else {
        await vault.modifyBinary(existing, buffer);
      }
    } else {
      if (isMarkdown) {
        await vault.create(normalized, new TextDecoder().decode(buffer));
      } else {
        await vault.createBinary(normalized, buffer);
      }
    }
  }
}

export async function safeDeleteSyncFile(vault: Vault, path: string): Promise<void> {
  const normalized = normalizePath(path);
  const existing = vault.getAbstractFileByPath(normalized);

  if (existing) {
    const parent = existing.parent;
    await vault.delete(existing);
    let curParent = parent;
    while (curParent && curParent.children && curParent.children.length === 0 && curParent.path !== "" && curParent.path !== "/") {
      try {
        const nextParent = curParent.parent;
        await vault.delete(curParent);
        curParent = nextParent;
      } catch {
        break;
      }
    }
  } else if (isWhitelistedHiddenPath(normalized) && (await vault.adapter.exists(normalized))) {
    await vault.adapter.remove(normalized);

    // 自动向上递归清理白名单空父目录
    let parent = normalized.split("/").slice(0, -1).join("/");
    while (parent && isWhitelistedHiddenPath(parent)) {
      try {
        const parentListing = await vault.adapter.list(parent);
        if (parentListing.files.length === 0 && parentListing.folders.length === 0) {
          await vault.adapter.rmdir(parent, false);
          parent = parent.split("/").slice(0, -1).join("/");
        } else {
          break;
        }
      } catch {
        break;
      }
    }
  }
}
