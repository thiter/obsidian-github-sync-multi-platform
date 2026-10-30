/**
 * Mock Obsidian API for local test environment
 */

export function normalizePath(path: string): string {
  if (!path) return "";
  return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
}

export class TAbstractFile {
  path: string;
  name: string;
  parent: TFolder | null = null;
  constructor(path: string) {
    this.path = normalizePath(path);
    this.name = this.path.split("/").pop() || "";
  }
}

export class TFile extends TAbstractFile {
  stat: { size: number; mtime: number; ctime: number };
  extension: string;
  constructor(path: string, size: number = 100) {
    super(path);
    this.stat = { size, mtime: Date.now(), ctime: Date.now() };
    this.extension = this.name.split(".").pop() || "";
  }
}

export class TFolder extends TAbstractFile {
  children: TAbstractFile[] = [];
  constructor(path: string) {
    super(path);
  }
}

export class Vault {
  files: Map<string, string | ArrayBuffer> = new Map();

  getAbstractFileByPath(path: string): TAbstractFile | null {
    const norm = normalizePath(path);
    if (this.files.has(norm)) {
      return new TFile(norm);
    }
    return null;
  }

  async read(file: TFile): Promise<string> {
    const val = this.files.get(file.path);
    return typeof val === "string" ? val : "";
  }

  async readBinary(file: TFile): Promise<ArrayBuffer> {
    const val = this.files.get(file.path);
    return val instanceof ArrayBuffer ? val : new ArrayBuffer(0);
  }

  async delete(_file: TAbstractFile): Promise<void> {}
  async trash(_file: TAbstractFile, _system: boolean): Promise<void> {}
}

export class Notice {
  message: string;
  constructor(message: string) {
    this.message = message;
  }
}

export class Modal {
  app: any;
  contentEl = {
    empty: () => {},
    createEl: () => ({}),
  };
  constructor(app: any) {
    this.app = app;
  }
  open() {}
  close() {}
}

export class Setting {
  constructor(_el: any) {}
  addButton(cb: (b: any) => any) {
    cb({
      setButtonText: () => ({ setWarning: () => ({ onClick: () => {} }), onClick: () => {} }),
      setWarning: () => ({ onClick: () => {} }),
      onClick: () => {},
    });
    return this;
  }
}

export const moment: any = () => ({
  format: () => "2026-10-30 20:00:00",
});
moment.locale = () => "zh-cn";

export const requestUrl = async () => ({
  status: 200,
  text: "",
  json: {},
  arrayBuffer: new ArrayBuffer(0),
});
