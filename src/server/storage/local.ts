import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FileStorage, StoredFile } from "./types";

// Stores files in a private folder outside /public, so they are never served
// directly. The app must stream them through an authorised route.
// Content type is kept in a sidecar "<file>.meta.json".

export class LocalFileStorage implements FileStorage {
  readonly name = "local";
  private root: string;

  constructor(rootDir: string) {
    this.root = path.resolve(rootDir);
  }

  async put(key: string, data: Buffer | Uint8Array, contentType: string): Promise<StoredFile> {
    const file = this.resolve(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, data);
    await writeFile(`${file}.meta.json`, JSON.stringify({ contentType }));
    return { key, size: data.byteLength, contentType };
  }

  async get(key: string) {
    const file = this.resolve(key);
    try {
      const [data, meta] = await Promise.all([readFile(file), readFile(`${file}.meta.json`, "utf8")]);
      return { data, contentType: (JSON.parse(meta) as { contentType: string }).contentType };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async delete(key: string) {
    const file = this.resolve(key);
    await rm(file, { force: true });
    await rm(`${file}.meta.json`, { force: true });
  }

  async exists(key: string) {
    try {
      return (await stat(this.resolve(key))).isFile();
    } catch {
      return false;
    }
  }

  private resolve(key: string): string {
    if (!key || key.includes("\0") || path.isAbsolute(key)) throw new Error(`Invalid storage key: ${key}`);
    const file = path.resolve(this.root, key);
    if (!file.startsWith(this.root + path.sep)) throw new Error(`Invalid storage key: ${key}`);
    return file;
  }
}
