import "server-only";
import { randomUUID } from "node:crypto";
import { getFileStorage } from "@/server/storage";

// Private uploads (driving licences, damage photos). Keys encode who may read them:
//   licences/<userId>/<uuid>.<ext>       owner + admins
//   damage/<reservationId>/<uuid>.<ext>  admins only
// Files are served only by src/app/files/[...key]/route.ts.

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const SIGNATURES: Array<{ type: string; ext: string; test: (b: Uint8Array) => boolean }> = [
  { type: "image/jpeg", ext: "jpg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    type: "image/png",
    ext: "png",
    test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  {
    type: "image/webp",
    ext: "webp",
    test: (b) =>
      String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP",
  },
  { type: "application/pdf", ext: "pdf", test: (b) => String.fromCharCode(...b.slice(0, 5)) === "%PDF-" },
];

export type UploadResult = { ok: true; key: string; contentType: string } | { ok: false; error: string };

/** Detects the real file type from its first bytes (never trusts the browser's type). */
export function sniffType(bytes: Uint8Array, allowPdf: boolean) {
  const hit = SIGNATURES.find((s) => s.test(bytes));
  if (!hit || (hit.type === "application/pdf" && !allowPdf)) return null;
  return hit;
}

async function store(prefix: string, file: File, allowPdf: boolean): Promise<UploadResult> {
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose a file to upload." };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: "The file must be 5 MB or smaller." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniffType(bytes, allowPdf);
  if (!kind) {
    return { ok: false, error: allowPdf ? "Upload a JPG, PNG, WebP or PDF file." : "Upload a JPG, PNG or WebP image." };
  }
  const key = `${prefix}/${randomUUID()}.${kind.ext}`;
  await getFileStorage().put(key, bytes, kind.type);
  return { ok: true, key, contentType: kind.type };
}

export function saveLicenceFile(userId: string, file: File) {
  return store(`licences/${safeSegment(userId)}`, file, true);
}

export function saveDamagePhoto(reservationId: string, file: File) {
  return store(`damage/${safeSegment(reservationId)}`, file, false);
}

/** Public URL path of the authorised file route for a storage key. */
export function fileUrl(key: string) {
  return `/files/${key.split("/").map(encodeURIComponent).join("/")}`;
}

export type FileScope = { kind: "licence"; userId: string } | { kind: "damage"; reservationId: string };

/** Parses a key into its access scope, or null if it isn't a private upload key. */
export function parseFileKey(key: string): FileScope | null {
  const m = /^(licences|damage)\/([A-Za-z0-9_-]+)\/[A-Za-z0-9-]+\.(jpg|png|webp|pdf)$/.exec(key);
  if (!m) return null;
  return m[1] === "licences" ? { kind: "licence", userId: m[2] } : { kind: "damage", reservationId: m[2] };
}

function safeSegment(s: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) throw new Error("Invalid id for storage key");
  return s;
}
