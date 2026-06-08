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
      let binary = "";
      for (let i = 0; i < uint8.byteLength; i++) {
        binary += String.fromCharCode(uint8[i]);
      }
      base64Content = btoa(binary);
    } else {
      const bytes = new Uint8Array(content);
      let binary = "";
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      base64Content = btoa(binary);
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
    throw new Error(`Failed to get tree: HTTP ${response.status} - ${response.text}`);
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
