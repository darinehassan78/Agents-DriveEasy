import { getEnv } from "../env";
import { LocalFileStorage } from "./local";
import type { FileStorage } from "./types";

export type * from "./types";

let storage: FileStorage | undefined;

export function getFileStorage(): FileStorage {
  if (storage) return storage;
  const env = getEnv();
  switch (env.STORAGE_DRIVER) {
    case "local":
      storage = new LocalFileStorage(env.LOCAL_UPLOADS_DIR);
      return storage;
    case "s3":
      throw new Error("S3 storage not implemented yet: add src/server/storage/s3.ts");
  }
}
