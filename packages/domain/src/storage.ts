import { mkdir, readFile, open, writeFile, rename, rm } from "node:fs/promises";
import { resolve, dirname, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "@cert/config";
export interface StorageProvider {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string, maxBytes?: number): Promise<Buffer>;
}
export class FileStorage implements StorageProvider {
  constructor(private root = resolve(config.STORAGE_ROOT)) {}
  private path(key: string) {
    if (!/^[a-zA-Z0-9_./-]+$/.test(key) || key.split("/").includes(".."))
      throw new Error("Invalid storage key");
    const p = resolve(this.root, key);
    if (!p.startsWith(this.root + sep)) throw new Error("Invalid storage path");
    return p;
  }
  async put(key: string, data: Buffer) {
    const path = this.path(key);
    await mkdir(dirname(path), { recursive: true });
    const tmp = path + "." + randomUUID() + ".tmp";
    try {
      await writeFile(tmp, data, { mode: 0o600 });
      await rename(tmp, path);
    } finally {
      await rm(tmp, { force: true });
    }
  }
  async get(key: string, maxBytes?: number) {
    if (maxBytes === undefined) return readFile(this.path(key));
    const file = await open(this.path(key), "r");
    try {
      if ((await file.stat()).size > maxBytes)
        throw Object.assign(
          new Error("檔案超過本次下載大小限制，請減少勾選數量"),
          { statusCode: 413 },
        );
      return await file.readFile();
    } finally {
      await file.close();
    }
  }
}
export const storage: StorageProvider = new FileStorage();
