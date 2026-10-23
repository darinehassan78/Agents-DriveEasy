import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalFileStorage } from "./local";

describe("LocalFileStorage", () => {
  let dir: string;
  let storage: LocalFileStorage;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "driveeasy-uploads-"));
    storage = new LocalFileStorage(dir);
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("stores, reads and deletes files", async () => {
    await storage.put("licences/u1/front.jpg", Buffer.from("img"), "image/jpeg");
    expect(await storage.exists("licences/u1/front.jpg")).toBe(true);
    const file = await storage.get("licences/u1/front.jpg");
    expect(file?.data.toString()).toBe("img");
    expect(file?.contentType).toBe("image/jpeg");

    await storage.delete("licences/u1/front.jpg");
    expect(await storage.get("licences/u1/front.jpg")).toBeNull();
  });

  it("rejects keys that escape the uploads folder", async () => {
    await expect(storage.put("../escape.txt", Buffer.from("x"), "text/plain")).rejects.toThrow();
    await expect(storage.put(path.resolve(dir, "abs.txt"), Buffer.from("x"), "text/plain")).rejects.toThrow();
  });
});
