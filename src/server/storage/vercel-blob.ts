import { BlobNotFoundError, del, get, head, put } from "@vercel/blob";
import type { FileStorage, StoredFile } from "./types";

// Vercel Blob driver (STORAGE_DRIVER=vercel-blob). Files are stored with
// `access: "private"`, so they are never reachable by URL; the app streams them
// through its authorised file route exactly like the local driver.
// Live verification is BLOCKED until a Blob store token is provided.

export class VercelBlobStorage implements FileStorage {
  readonly name = "vercel-blob";

  constructor(private readonly token: string) {}

  async put(key: string, data: Buffer | Uint8Array, contentType: string): Promise<StoredFile> {
    assertKey(key);
    await put(key, Buffer.from(data), {
      access: "private",
      contentType,
      token: this.token,
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return { key, size: data.byteLength, contentType };
  }

  async get(key: string) {
    assertKey(key);
    const res = await get(key, { access: "private", token: this.token, useCache: false });
    if (!res || res.statusCode !== 200) return null;
    const data = Buffer.from(await new Response(res.stream).arrayBuffer());
    return { data, contentType: res.blob.contentType };
  }

  async delete(key: string) {
    assertKey(key);
    await del(key, { token: this.token });
  }

  async exists(key: string) {
    assertKey(key);
    try {
      await head(key, { token: this.token });
      return true;
    } catch (err) {
      if (err instanceof BlobNotFoundError) return false;
      throw err;
    }
  }
}

function assertKey(key: string) {
  if (!key || key.includes("\0") || key.startsWith("/") || key.split("/").some((p) => p === ".." || p === ".")) {
    throw new Error(`Invalid storage key: ${key}`);
  }
}
