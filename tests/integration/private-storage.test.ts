// Q9 (static part): private uploads live outside /public and storage keys
// cannot escape the uploads folder.
import path from "node:path";
import { describe, expect, it } from "vitest";
import { repoRoot } from "../support/env";

describe("private file storage", () => {
  it("LOCAL_UPLOADS_DIR is outside public/", async () => {
    const { getEnv } = await import("@/server/env");
    const dir = path.resolve(repoRoot, getEnv().LOCAL_UPLOADS_DIR);
    const pub = path.resolve(repoRoot, "public");
    expect(path.relative(pub, dir).startsWith("..")).toBe(true);
  });

  it("rejects path traversal in storage keys", async () => {
    const { LocalFileStorage } = await import("@/server/storage/local");
    const s = new LocalFileStorage(path.join(repoRoot, "storage", "qa-tmp"));
    await expect(s.put("../../public/evil.txt", Buffer.from("x"), "text/plain")).rejects.toThrow();
    await expect(s.get("../../package.json")).rejects.toThrow();
  });
});
