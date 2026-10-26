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

  constructor(config: GitHubConfig) {
    this.config = config;
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
      if (error.status === 404) return null;
      throw error;
    }
  }

  async putFile(path: string, content: string | ArrayBuffer, sha?: string): Promise<string> {
    const response = await this._doPutRequest(path, content, sha);

    // 409 = 本地缓存 sha 已过期（SHA 冲突）
    // 422 = 验证失败，常见原因：文件已存在但未传 sha（GitHub 不一致行为）
    // 两种情况均用相同策略：重新 GET 最新 sha 后重试一次
    if (response.status === 409 || response.status === 422) {
      const remoteFile = await this.getFile(path);
      const freshSha = remoteFile?.sha;
      if (!freshSha && response.status === 422) {
        // 422 且远端也没有这个文件 → 真正的验证失败，不重试
        throw new Error(`Failed to put file (422 validation error): ${response.text}`);
      }
      const retry = await this._doPutRequest(path, content, freshSha);
      if (retry.status === 200 || retry.status === 201) {
        return (retry.json as { content: { sha: string } }).content.sha;
      }
      throw new Error(`Failed to put file after sha retry (${response.status}→${retry.status}): ${retry.text}`);
    }

    if (response.status === 200 || response.status === 201) {
      return (response.json as { content: { sha: string } }).content.sha;
    }
    throw new Error(`Failed to put file: ${response.status} ${response.text}`);
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
      throw new Error(`Failed to delete file: ${response.status} ${response.text}`);
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

    throw new Error(`Failed to get tree: HTTP ${response.status} - ${response.text}`);
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

    throw new Error(`Failed to download zipball: HTTP ${response.status} - ${response.text}`);
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
    throw new Error(`Failed to create blob: ${res.status} - ${res.text}`);
  }

  async getRef(branch: string = this.config.branch): Promise<GitRefResponse | null> {
    const url = `${this.baseUrl}/git/ref/heads/${encodeURIComponent(branch)}`;
    const res = await requestUrl({
      url,
      method: "GET",
      headers: this.headers,
      throw: false,
    });

    if (res.status === 200) {
      return res.json as GitRefResponse;
    }
    if (res.status === 404 || this.isEmptyRepositoryResponse(res.status, res.text)) {
      return null;
    }
    throw new Error(`Failed to get ref: ${res.status} - ${res.text}`);
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
    throw new Error(`Failed to get commit ${commitSha}: ${res.status} - ${res.text}`);
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
    throw new Error(`Failed to create tree: ${res.status} - ${res.text}`);
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
    throw new Error(`Failed to create commit: ${res.status} - ${res.text}`);
  }

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

    if (res.status === 404 || res.status === 422) {
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
    }

    throw new Error(`Failed to update ref: ${res.status} - ${res.text}`);
  }

  async commitBatch(
    message: string,
    treeEntries: GitTreeEntry[],
    explicitBaseTreeSha?: string | null
  ): Promise<{ commitSha: string; treeSha: string }> {
    if (treeEntries.length === 0) {
      throw new Error("Cannot commit an empty tree entry list");
    }

    const currentRef = await this.getRef();
    let baseCommitSha: string | null = currentRef?.object?.sha ?? null;
    let baseTreeSha: string | null = explicitBaseTreeSha !== undefined ? explicitBaseTreeSha : null;
    let parents: string[] = [];

    if (baseCommitSha) {
      parents = [baseCommitSha];
      if (explicitBaseTreeSha === undefined) {
        const parentCommit = await this.getCommit(baseCommitSha);
        baseTreeSha = parentCommit.tree.sha;
      }
    }

    const newTreeSha = await this.createTree(baseTreeSha, treeEntries);
    const newCommitSha = await this.createCommit(message, newTreeSha, parents);

    try {
      await this.updateRef(newCommitSha);
    } catch (refErr) {
      const retryRef = await this.getRef();
      const retryCommitSha = retryRef?.object?.sha;
      if (retryCommitSha && retryCommitSha !== baseCommitSha) {
        const retryCommit = await this.getCommit(retryCommitSha);
        const retryTreeSha = await this.createTree(
          explicitBaseTreeSha !== undefined ? explicitBaseTreeSha : retryCommit.tree.sha,
          treeEntries
        );
        const retryNewCommit = await this.createCommit(message, retryTreeSha, [retryCommitSha]);
        await this.updateRef(retryNewCommit);
        return { commitSha: retryNewCommit, treeSha: retryTreeSha };
      }
      throw refErr;
    }

    return { commitSha: newCommitSha, treeSha: newTreeSha };
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
