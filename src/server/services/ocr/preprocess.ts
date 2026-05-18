import "server-only";
import sharp from "sharp";

/**
 * Prepare a captured slip/document photo for vision OCR.
 * - Auto-rotate from EXIF orientation (phones often save sideways)
 * - Normalize contrast (helps faded thermal POS slips)
 * - Cap longer edge at 2000 px (Claude vision rec, smaller payload)
 * - Re-encode as quality-85 JPEG (smaller than PNG, OCR-friendly)
 *
 * HEIC/HEIF inputs are decoded via libvips and re-encoded as JPEG.
 * PDFs aren't processed here — the parser forwards them as `document`
 * source straight to Claude.
 */
export async function preprocessImage(input: Buffer): Promise<{
  buffer: Buffer;
  mediaType: "image/jpeg";
}> {
  const out = await sharp(input)
    .rotate()
    .normalize()
    .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();
  return { buffer: out, mediaType: "image/jpeg" };
}
