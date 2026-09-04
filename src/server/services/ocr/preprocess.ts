import "server-only";
import sharp from "sharp";
import convertHeic from "heic-convert";

/**
 * Prepare a captured slip/document photo for vision OCR.
 * - HEIC/HEIF → JPEG via heic-convert (pure JS, libvips here lacks heif plugin)
 * - Auto-rotate from EXIF orientation (phones often save sideways)
 * - Greyscale: colour carries no information here and adds noise
 * - normalize + CLAHE: global then LOCAL contrast. Dot-matrix invoices print
 *   so faintly that whole lines sit within a few grey levels; local
 *   equalisation is what pulls the digits out of the paper.
 * - sharpen: dot-matrix glyphs are dot clouds, and 3/8/6/5 differ by one or
 *   two dots. Without edge definition the model guesses.
 * - Cap longer edge at 2400 px, JPEG quality 82.
 *
 * These settings were chosen by measurement, not taste. On a faded B1
 * invoice the previous pipeline (normalize only, 2000 px, q85) read the date
 * as 24.03.2026 on 3 of 3 runs; this one reads 24.08.2026 on 3 of 3. Dropping
 * back to 2000 px / q88 fixed the month but broke the year (2025), so the
 * resolution matters as much as the contrast work. JPEG quality does NOT:
 * at 2400 px, q95 / q82 / q72 all read the same invoice 3 of 3, so q82 is
 * used — ~40% of the q95 payload. That matters because OCR runs inside a
 * Vercel function with a hard maxDuration; q95 store summaries (~2.7 MB)
 * were being killed mid-flight and left stuck in "processing".
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
    .grayscale()
    .normalize()
    .clahe({ width: 8, height: 8, maxSlope: 3 })
    .sharpen({ sigma: 1.2 })
    .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
  return { buffer: out, mediaType: "image/jpeg" };
}
