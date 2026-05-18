import "server-only";
import { randomUUID } from "node:crypto";
import { UPLOAD_BUCKET } from "@/lib/constants";
import { createAdminClient } from "@/lib/supabase/admin";
import type { UploadType } from "@prisma/client";

const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "application/pdf": "pdf",
};

/**
 * Build upload path. Convention: <storeId>/<dailyRecordId>/<type>/<uuid>.<ext>
 * The first segment (storeId) is what storage RLS checks.
 */
export function buildUploadPath(opts: {
  storeId: string;
  dailyRecordId: string;
  type: UploadType;
  mimeType: string;
}): string {
  const ext = MIME_EXT[opts.mimeType] ?? "bin";
  return `${opts.storeId}/${opts.dailyRecordId}/${opts.type}/${randomUUID()}.${ext}`;
}

/**
 * Upload a buffer to the `uploads` bucket and return the storage path.
 * Throws on failure.
 */
export async function uploadBufferToStorage(opts: {
  path: string;
  buffer: Buffer;
  mimeType: string;
}): Promise<{ path: string }> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.storage
    .from(UPLOAD_BUCKET)
    .upload(opts.path, opts.buffer, {
      contentType: opts.mimeType,
      upsert: false,
    });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  return { path: data.path };
}

/**
 * Generate a short-lived signed URL for downloading a stored object.
 * Default expiry: 1 hour.
 */
export async function createSignedReadUrl(
  path: string,
  expiresInSeconds = 3600
): Promise<string> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.storage
    .from(UPLOAD_BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error) throw new Error(`Signed URL failed: ${error.message}`);
  return data.signedUrl;
}

/**
 * Hard-delete an object from storage. Use carefully — DB row should be removed too.
 */
export async function deleteFromStorage(path: string): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.storage.from(UPLOAD_BUCKET).remove([path]);
  if (error) throw new Error(`Storage delete failed: ${error.message}`);
}
