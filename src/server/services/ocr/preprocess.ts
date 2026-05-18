import "server-only";
import sharp from "sharp";
import convertHeic from "heic-convert";

/**
 * Prepare a captured slip/document photo for vision OCR.
 * - HEIC/HEIF → JPEG via heic-convert (pure JS, libvips here lacks heif plugin)
 * - Auto-rotate from EXIF orientation (phones often save sideways)
 * - Normalize contrast (helps faded thermal POS slips)
 * - Cap longer edge at 2000 px (Claude vision rec, smaller payload)
 * - Re-encode as quality-85 JPEG (smaller than PNG, OCR-friendly)
 *
 * PDFs aren't processed here — the parser forwards them as `document`
 * source straight to Claude.
 */
export async function preprocessImage(
  input: Buffer,
  inputMime?: string
): Promise<{
  buffer: Buffer;
  mediaType: "image/jpeg";
}> {
  let working: Buffer = input;
  if (inputMime === "image/heic" || inputMime === "image/heif") {
    const converted = await convertHeic({
      buffer: input as unknown as ArrayBufferLike,
      format: "JPEG",
      quality: 0.95,
    });
    working = Buffer.from(converted);
  }

  const out = await sharp(working)
    .rotate()
    .normalize()
    .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();
  return { buffer: out, mediaType: "image/jpeg" };
}
