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
    const url = `${this.baseUrl}/contents/${encodeURIComponent(path)}?ref=${this.config.branch}`;
    try {
      const response = await requestUrl({
        url,
        method: "GET",
        headers: this.headers,
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
    const url = `${this.baseUrl}/contents/${encodeURIComponent(path)}`;
    
    let base64Content: string;
    if (typeof content === "string") {
      const uint8 = new TextEncoder().encode(content);
      let binary = "";
      for (let i = 0; i < uint8.byteLength; i++) {
        binary += String.fromCharCode(uint8[i]);
      }
      base64Content = btoa(binary);
    } else {
      // Handle binary content (ArrayBuffer)
      const bytes = new Uint8Array(content);
      let binary = "";
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      base64Content = btoa(binary);
    }

    const body = {
      message: `sync: ${sha ? "update" : "create"} ${path}`,
      content: base64Content,
      sha,
      branch: this.config.branch,
    };

    const response = await requestUrl({
      url,
      method: "PUT",
      headers: this.headers,
      body: JSON.stringify(body),
    });

    if (response.status === 200 || response.status === 201) {
      return response.json.content.sha;
    }
    throw new Error(`Failed to put file: ${response.status} ${response.text}`);
  }

  async deleteFile(path: string, sha: string): Promise<void> {
    const url = `${this.baseUrl}/contents/${encodeURIComponent(path)}`;
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

    if (response.status !== 200) {
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
    });
    if (response.status === 200) {
      return response.json as GitHubTree;
    }
    throw new Error(`Failed to get tree: ${response.status}`);
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
