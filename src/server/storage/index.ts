import "server-only";
import { getEnv } from "../env";
import { LocalFileStorage } from "./local";
import type { FileStorage } from "./types";
import { VercelBlobStorage } from "./vercel-blob";

export type * from "./types";

let storage: FileStorage | undefined;

/** The configured private file store. Chosen by STORAGE_DRIVER only. */
export function getFileStorage(): FileStorage {
  if (storage) return storage;
  const env = getEnv();
  switch (env.STORAGE_DRIVER) {
    case "local":
      storage = new LocalFileStorage(env.LOCAL_UPLOADS_DIR);
      return storage;
    case "vercel-blob":
      if (!env.BLOB_READ_WRITE_TOKEN) throw new Error("STORAGE_DRIVER=vercel-blob requires BLOB_READ_WRITE_TOKEN");
      storage = new VercelBlobStorage(env.BLOB_READ_WRITE_TOKEN);
      return storage;
    case "s3":
      throw new Error("S3 storage is not implemented; use STORAGE_DRIVER=local or vercel-blob");
    default: {
      const never: never = env.STORAGE_DRIVER;
      throw new Error(`Unknown STORAGE_DRIVER: ${String(never)}`);
    }
  }
}
