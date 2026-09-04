import { createHash } from "node:crypto";
import { registerStoredFile } from "./db";
import { storagePut } from "./storage";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "image/jpeg",
  "image/png",
  "image/webp",
  "audio/mpeg",
  "audio/wav",
  "audio/mp4",
  "video/mp4",
  "video/webm",
]);

export type UserUploadInput = {
  userId: number;
  originalName: string;
  mimeType: string;
  contentBase64: string;
};

function safeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180) || "upload.bin";
}

export async function uploadUserFile(input: UserUploadInput) {
  if (!ALLOWED_MIME_TYPES.has(input.mimeType))
    throw new Error("This file type is not supported");
  const content = input.contentBase64.replace(/^data:[^;]+;base64,/, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(content) || content.length % 4 !== 0)
    throw new Error("File content is not valid base64");
  const bytes = Buffer.from(content, "base64");
  if (bytes.length === 0 || bytes.length > MAX_UPLOAD_BYTES)
    throw new Error("File size must be between 1 byte and 25 MB");

  const digest = createHash("sha256").update(bytes).digest("hex");
  const requestedKey = `${input.userId}/files/${crypto.randomUUID()}-${safeFileName(input.originalName)}`;
  const stored = await storagePut(requestedKey, bytes, input.mimeType);
  return registerStoredFile({
    userId: input.userId,
    storageKey: stored.key,
    storageUrl: stored.url,
    originalName: safeFileName(input.originalName),
    mimeType: input.mimeType,
    sizeBytes: bytes.length,
    sha256: digest,
  });
}
