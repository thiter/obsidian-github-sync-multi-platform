import { requestUrl } from "obsidian";

export interface GitHubConfig {
  owner: string;
  repo: string;
  branch: string;
  token: string;
}

export interface GitHubFileResponse {
  content: string;
  sha: string;
  path: string;
  size: number;
  download_url?: string;
}

export interface GitHubTreeNode {
  path: string;
  mode: string;
  type: "blob" | "tree";
  sha: string;
  size?: number;
  url: string;
}

export interface GitHubTree {
  sha: string;
  url: string;
  tree: GitHubTreeNode[];
  truncated: boolean;
}

export interface GitTreeEntry {
  path: string;
  mode: "100644" | "100755" | "040000" | "160000" | "120000";
  type: "blob" | "tree" | "commit";
  sha: string | null;
  content?: string;
}

export interface GitCommitResponse {
  sha: string;
  tree: {
    sha: string;
    url: string;
  };
  parents: Array<{ sha: string; url: string }>;
  message: string;
}

export interface GitRefResponse {
  ref: string;
  node_id: string;
  url: string;
  object: {
    sha: string;
    type: string;
    url: string;
  };
}

/**
 * Attach the HTTP status to an API error so the UI layer (errors.ts) can
 * classify 401 / 403 / 404 / 422 deterministically instead of parsing JSON.
 */
export function apiFailure(message: string, status: number): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

/**
 * A PATCH /git/refs/heads/{branch} that GitHub rejects with
 * 422 "Update is not a fast forward" means the branch was advanced by another
 * device between our `getRef()` and `updateRef()`. Only this specific error
 * is safe to retry; 401/403/404 and other 422s are configuration problems.
 */
export function isNonFastForwardError(error: unknown): boolean {
  const e = error as { status?: number; message?: string } | null;
  const text = typeof e?.message === "string" ? e.message : String(error ?? "");
  const status = typeof e?.status === "number" ? e.status : null;
  const is422 = status === 422 || /\b422\b/.test(text);
  return is422 && /not a fast forward/i.test(text);
}

/** Max retries (not attempts) after a fast-forward conflict. */
export const MAX_COMMIT_REF_RETRIES = 3;
/** Base delay for exponential backoff: 200 / 400 / 800 ms + jitter. */
export const COMMIT_RETRY_BASE_DELAY_MS = 200;

export interface CommitBatchRetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  /** Injectable for tests so retry tests never actually wait. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Serialize every operation that moves the branch ref.
 *
 * This plugin writes through two different APIs that both create commits:
 *   - Contents API (`putFile` / `deleteFile`): commits implicitly, e.g. the
 *     debounced file watcher, single-file deletion and the fire-and-forget
 *     `updateStats()` upload.
 *   - Git Data API (`commitBatch`): builds a tree/commit then PATCHes the ref,
 *     used by 3-way sync, folder rename and folder deletion.
 *
 * If they overlap, commitBatch reads HEAD=A while a putFile advances it to B,
 * and the PATCH is rejected with 422 "Update is not a fast forward". One FIFO
 * queue per client makes those writes mutually exclusive. A failed predecessor
 * must not poison the queue, so the task is used as both fulfillment and
 * rejection handler. Internal helpers (_doPutRequest, getRef, createTree,
 * createCommit, updateRef, createBlob) deliberately stay outside the queue to
 * avoid self-deadlock; createBlob does not move the ref.
 */
export class WriteQueue {
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;

  run<T>(task: () => Promise<T>): Promise<T> {
    this.pending += 1;
    const result = this.tail.then(task, task);
    this.tail = result.then(
      () => {
        this.pending -= 1;
      },
      () => {
        this.pending -= 1;
      }
    );
    return result;
  }

  /** Queued + running tasks, exposed for tests and diagnostics. */
  get size(): number {
    return this.pending;
  }
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  const CHUNK_SIZE = 0x8000; // 32KB 分块处理，避免堆栈溢出与巨量 GC
  let binary = "";
  for (let i = 0; i < len; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, Math.min(i + CHUNK_SIZE, len));
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}

export class GitHubClient {
  private config: GitHubConfig;
  private readonly writeQueue = new WriteQueue();

  constructor(config: GitHubConfig) {
    // Tokens never contain whitespace, but copy/paste (especially on iOS via
    // WeChat / Notes) frequently adds a trailing space or newline. Leave it
    // in place and GitHub answers `401 Bad credentials`. Cleaning it here
    // covers settings UI, clipboard import and legacy data.json alike.
    this.config = { ...config, token: (config.token ?? "").trim() };
  }

  private get baseUrl() {
    return `https://api.github.com/repos/${this.config.owner}/${this.config.repo}`;
  }

  public get headers() {
    return {
      Authorization: `Bearer ${this.config.token}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
    };
  }

  async getFile(path: string): Promise<GitHubFileResponse | null> {
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    const url = `${this.baseUrl}/contents/${encodedPath}?ref=${this.config.branch}`;
    try {
      const response = await requestUrl({
        url,
        method: "GET",
        headers: this.headers,
        throw: false,
      });

      if (response.status === 200) {
        return response.json as GitHubFileResponse;
      }
      return null;
    } catch (error) {
      if ((error as { status?: number }).status === 404) return null;
      throw error;
    }
  }

  /** All ref-moving writes go through WriteQueue; see its docs. */
  async putFile(path: string, content: string | ArrayBuffer, sha?: string): Promise<string> {
    return this.writeQueue.run(() => this.putFileImpl(path, content, sha));
  }

  private async putFileImpl(
    path: string,
    content: string | ArrayBuffer,
    sha?: string
  ): Promise<string> {
    const response = await this._doPutRequest(path, content, sha);

    // 409 = 本地缓存 sha 已过期（SHA 冲突）
    // 422 = 验证失败，常见原因：文件已存在但未传 sha（GitHub 不一致行为）
    // 两种情况均用相同策略：重新 GET 最新 sha 后重试一次
    if (response.status === 409 || response.status === 422) {
      const remoteFile = await this.getFile(path);
      const freshSha = remoteFile?.sha;
      if (!freshSha && response.status === 422) {
        // 422 且远端也没有这个文件 → 真正的验证失败，不重试
        throw apiFailure(`Failed to put file (422 validation error): ${response.text}`, 422);
      }
      const retry = await this._doPutRequest(path, content, freshSha);
      if (retry.status === 200 || retry.status === 201) {
        return (retry.json as { content: { sha: string } }).content.sha;
      }
      throw apiFailure(
        `Failed to put file after sha retry (${response.status}→${retry.status}): ${retry.text}`,
        retry.status
      );
    }

    if (response.status === 200 || response.status === 201) {
      return (response.json as { content: { sha: string } }).content.sha;
    }
    throw apiFailure(`Failed to put file: ${response.status} ${response.text}`, response.status);
  }

  private async _doPutRequest(
    path: string,
    content: string | ArrayBuffer,
    sha?: string
  ): Promise<{ status: number; json: Record<string, unknown>; text: string }> {
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    const url = `${this.baseUrl}/contents/${encodedPath}`;

    let base64Content: string;
    if (typeof content === "string") {
      const uint8 = new TextEncoder().encode(content);
      base64Content = arrayBufferToBase64(uint8.buffer);
    } else {
      base64Content = arrayBufferToBase64(content);
    }

    const body: Record<string, unknown> = {
      message: `sync: ${sha ? "update" : "create"} ${path}`,
      content: base64Content,
      branch: this.config.branch,
    };
    if (sha) body.sha = sha;

    // requestUrl 在收到 4xx/5xx 时默认抛出异常而非返回
    // 加 throw: false 确保始终返回响应对象，使 409/422 状态码判断 100% 生效
    try {
      const res = await requestUrl({
        url,
        method: "PUT",
        headers: this.headers,
        body: JSON.stringify(body),
        throw: false,
      });
      return { status: res.status, json: res.json as Record<string, unknown>, text: res.text };
    } catch (err: unknown) {
      // 备用分支：如果 throw:false 不生效，捕获异常并返回
      const e = err as { status?: number; message?: string };
      return {
        status: e.status ?? 0,
        json: {} as Record<string, unknown>,
        text: e.message ?? String(err),
      };
    }
  }

  async deleteFile(path: string, sha: string): Promise<void> {
    return this.writeQueue.run(() => this.deleteFileImpl(path, sha));
  }

  private async deleteFileImpl(path: string, sha: string): Promise<void> {
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    const url = `${this.baseUrl}/contents/${encodedPath}`;
    const body = {
      message: `sync: delete ${path}`,
      sha,
      branch: this.config.branch,
    };

    const response = await requestUrl({
      url,
      method: "DELETE",
      headers: this.headers,
      body: JSON.stringify(body),
    });

    // B5: GitHub DELETE 成功返回 200（有响应体）或 204（无内容）
    if (response.status !== 200 && response.status !== 204) {
      throw apiFailure(`Failed to delete file: ${response.status} ${response.text}`, response.status);
    }
  }

  async getLatestCommit(path?: string): Promise<string | null> {
    let url = `${this.baseUrl}/commits?sha=${this.config.branch}&per_page=1`;
    if (path) {
      url += `&path=${encodeURIComponent(path)}`;
    }

    const response = await requestUrl({
      url,
      method: "GET",
      headers: this.headers,
    });

    if (response.status === 200 && response.json.length > 0) {
      return response.json[0].sha;
    }
    return null;
  }

  async getTree(): Promise<GitHubTree> {
    const url = `${this.baseUrl}/git/trees/${this.config.branch}?recursive=1`;
    const response = await requestUrl({
      url,
      method: "GET",
      headers: this.headers,
      throw: false,
    });
    if (response.status === 200) {
      return response.json as GitHubTree;
    }

    // A brand-new repository has no commits or tree yet, and GitHub returns 409.
    // Treat it as an empty remote so the sync flow can create the first commit.
    if (this.isEmptyRepositoryResponse(response.status, response.text)) {
      return { sha: "", url: "", tree: [], truncated: false };
    }

    throw apiFailure(`Failed to get tree: HTTP ${response.status} - ${response.text}`, response.status);
  }

  private isEmptyRepositoryResponse(status: number, text: string): boolean {
    return (status === 409 || status === 404) && (/Git Repository is empty/i.test(text) || /Not Found/i.test(text));
  }

  async downloadZipball(): Promise<ArrayBuffer> {
    const url = `${this.baseUrl}/zipball/${encodeURIComponent(this.config.branch)}`;
    const response = await requestUrl({
      url,
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        Accept: "application/vnd.github+json",
      },
      throw: false,
    });

    if (response.status === 200) {
      return response.arrayBuffer;
    }

    if (this.isEmptyRepositoryResponse(response.status, response.text)) {
      throw new Error("EMPTY_REPO");
    }

    throw apiFailure(`Failed to download zipball: HTTP ${response.status} - ${response.text}`, response.status);
  }

  async createBlob(content: string | ArrayBuffer): Promise<string> {
    const url = `${this.baseUrl}/git/blobs`;
    let base64Content: string;
    if (typeof content === "string") {
      const uint8 = new TextEncoder().encode(content);
      base64Content = arrayBufferToBase64(uint8.buffer);
    } else {
      base64Content = arrayBufferToBase64(content);
    }

    const res = await requestUrl({
      url,
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({
        content: base64Content,
        encoding: "base64",
      }),
      throw: false,
    });

    if (res.status === 201) {
      return (res.json as { sha: string }).sha;
    }
    throw apiFailure(`Failed to create blob: ${res.status} - ${res.text}`, res.status);
  }

  private refReadSeq = 0;

  async getRef(branch: string = this.config.branch): Promise<GitRefResponse | null> {
    // GitHub answers this endpoint with `Cache-Control: private, max-age=60,
    // s-maxage=60`. Reading a cached HEAD makes commitBatch build its commit
    // on a stale parent, so PATCH is rejected as non-fast-forward and every
    // retry (all within ~1.5s) hits the same stale value. A unique URL plus
    // no-cache headers forces a fresh read on every attempt.
    const url = `${this.baseUrl}/git/ref/heads/${encodeURIComponent(branch)}?ts=${Date.now()}-${++this.refReadSeq}`;
    const res = await requestUrl({
      url,
      method: "GET",
      headers: {
        ...this.headers,
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
      throw: false,
    });

    if (res.status === 200) {
      return res.json as GitRefResponse;
    }
    if (res.status === 404 || this.isEmptyRepositoryResponse(res.status, res.text)) {
      return null;
    }
    throw apiFailure(`Failed to get ref: ${res.status} - ${res.text}`, res.status);
  }

  async getCommit(commitSha: string): Promise<GitCommitResponse> {
    const url = `${this.baseUrl}/git/commits/${encodeURIComponent(commitSha)}`;
    const res = await requestUrl({
      url,
      method: "GET",
      headers: this.headers,
      throw: false,
    });

    if (res.status === 200) {
      return res.json as GitCommitResponse;
    }
    throw apiFailure(`Failed to get commit ${commitSha}: ${res.status} - ${res.text}`, res.status);
  }

  async createTree(baseTreeSha: string | null, tree: GitTreeEntry[]): Promise<string> {
    const url = `${this.baseUrl}/git/trees`;
    const body: Record<string, unknown> = { tree };
    if (baseTreeSha) {
      body.base_tree = baseTreeSha;
    }

    const res = await requestUrl({
      url,
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(body),
      throw: false,
    });

    if (res.status === 201) {
      return (res.json as { sha: string }).sha;
    }
    throw apiFailure(`Failed to create tree: ${res.status} - ${res.text}`, res.status);
  }

  async createCommit(message: string, treeSha: string, parents: string[]): Promise<string> {
    const url = `${this.baseUrl}/git/commits`;
    const res = await requestUrl({
      url,
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({
        message,
        tree: treeSha,
        parents,
      }),
      throw: false,
    });

    if (res.status === 201) {
      return (res.json as { sha: string }).sha;
    }
    throw apiFailure(`Failed to create commit: ${res.status} - ${res.text}`, res.status);
  }

  /**
   * Move the branch ref to `commitSha`.
   *
   * `force` exists for API compatibility but MUST stay false: forcing the ref
   * would silently discard commits pushed by other devices (data loss).
   */
  async updateRef(commitSha: string, branch: string = this.config.branch, force: boolean = false): Promise<void> {
    const url = `${this.baseUrl}/git/refs/heads/${encodeURIComponent(branch)}`;
    const res = await requestUrl({
      url,
      method: "PATCH",
      headers: this.headers,
      body: JSON.stringify({
        sha: commitSha,
        force,
      }),
      throw: false,
    });

    if (res.status === 200) {
      return;
    }

    // 404 = ref does not exist yet (brand-new repository, first commit).
    // Only this case should create the branch. A 422 fast-forward conflict
    // must NOT go here: the branch already exists, so POST /git/refs would
    // fail for sure, wasting a request and widening the race window.
    if (res.status === 404) {
      const createRes = await requestUrl({
        url: `${this.baseUrl}/git/refs`,
        method: "POST",
        headers: this.headers,
        body: JSON.stringify({
          ref: `refs/heads/${branch}`,
          sha: commitSha,
        }),
        throw: false,
      });
      if (createRes.status === 201) {
        return;
      }
      throw apiFailure(
        `Failed to create ref: ${createRes.status} - ${createRes.text}`,
        createRes.status
      );
    }

    // 422 "Update is not a fast forward" is handed back to commitBatch,
    // which re-reads HEAD and rebuilds the commit on top of it.
    throw apiFailure(`Failed to update ref: ${res.status} - ${res.text}`, res.status);
  }

  /**
   * Atomically create a tree + commit and move the branch ref.
   *
   * If another device advances the branch between getRef() and updateRef(),
   * GitHub rejects the ref update with 422. We re-read HEAD and rebuild the
   * whole chain on the new parent, up to MAX_COMMIT_REF_RETRIES times with
   * exponential backoff + jitter so two devices do not retry in lockstep.
   * Only fast-forward conflicts are retried; auth / permission / 404 issues
   * are thrown immediately with their original message.
   */
  async commitBatch(
    message: string,
    treeEntries: GitTreeEntry[],
    explicitBaseTreeSha?: string | null,
    retryOptions: CommitBatchRetryOptions = {}
  ): Promise<{ commitSha: string; treeSha: string }> {
    return this.writeQueue.run(() =>
      this.commitBatchImpl(message, treeEntries, explicitBaseTreeSha, retryOptions)
    );
  }

  private async commitBatchImpl(
    message: string,
    treeEntries: GitTreeEntry[],
    explicitBaseTreeSha?: string | null,
    retryOptions: CommitBatchRetryOptions = {}
  ): Promise<{ commitSha: string; treeSha: string }> {
    if (treeEntries.length === 0) {
      throw new Error("Cannot commit an empty tree entry list");
    }

    const maxRetries = Math.max(0, retryOptions.maxRetries ?? MAX_COMMIT_REF_RETRIES);
    const baseDelayMs = retryOptions.baseDelayMs ?? COMMIT_RETRY_BASE_DELAY_MS;
    const sleep = retryOptions.sleep ?? defaultSleep;

    for (let attempt = 0; ; attempt++) {
      // Re-read HEAD on every attempt: parents must always be the CURRENT head,
      // otherwise GitHub will reject the ref update again.
      const currentRef = await this.getRef();
      const baseCommitSha: string | null = currentRef?.object?.sha ?? null;
      let baseTreeSha: string | null = explicitBaseTreeSha !== undefined ? explicitBaseTreeSha : null;
      const parents: string[] = baseCommitSha ? [baseCommitSha] : [];

      // Preserve the upsert semantics: when the caller supplies an explicit
      // base tree, never replace it with the parent commit's tree.
      if (baseCommitSha && explicitBaseTreeSha === undefined) {
        const parentCommit = await this.getCommit(baseCommitSha);
        baseTreeSha = parentCommit.tree.sha;
      }

      const newTreeSha = await this.createTree(baseTreeSha, treeEntries);
      const newCommitSha = await this.createCommit(message, newTreeSha, parents);

      try {
        await this.updateRef(newCommitSha);
        return { commitSha: newCommitSha, treeSha: newTreeSha };
      } catch (refErr) {
        if (!isNonFastForwardError(refErr)) {
          throw refErr;
        }
        if (attempt >= maxRetries) {
          throw apiFailure(
            `Failed to commit batch after ${maxRetries} retries: Update is not a fast forward (remote branch kept changing)`,
            422
          );
        }
        // 200 / 400 / 800 ms + up to 99 ms of jitter.
        const delay = baseDelayMs * Math.pow(2, attempt) + Math.floor(Math.random() * 100);
        await sleep(delay);
      }
    }
  }

  // Helper to decode base64 content from GitHub
  static decodeContent(base64Content: string): string {
    const binary = atob(base64Content.replace(/\n/g, ""));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  }
}
