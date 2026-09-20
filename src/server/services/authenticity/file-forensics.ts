import "server-only";
import sharp from "sharp";

/**
 * Deterministic traces in the uploaded bytes. None of them needs a model and
 * none can be argued with: a provenance manifest written by an image
 * generator is evidence, not an opinion. Absence proves nothing (WhatsApp and
 * screenshots strip metadata), so everything here only ever ADDS suspicion.
 */
export type FileForensics = {
  width: number;
  height: number;
  format: string | null;
  /** C2PA / JUMBF manifest or IPTC "trainedAlgorithmicMedia": written by
   *  OpenAI, Google, Adobe and others into images their models produce. */
  ai_provenance_markers: string[];
  /** Pixel size that image generators emit and phone cameras do not. */
  generator_dimensions: boolean;
  /** Camera make found in EXIF (weak positive sign of a real photo). */
  camera_make: string | null;
  has_exif: boolean;
};

// Output sizes of the common generators (OpenAI, Google, Stability, Midjourney
// upscales are larger and vary). Phone photos are 4:3 / 16:9 at other sizes;
// WhatsApp resizes to a 1600 long side (e.g. 1200×1600).
const GENERATOR_SIZES = new Set([
  "1024x1024", "1024x1536", "1536x1024", "1024x1792", "1792x1024", "2048x2048", "1536x1536",
  "896x1152", "1152x896", "832x1216", "1216x832", "768x1344", "1344x768", "1536x2048", "2048x1536",
  "512x512", "768x768",
]);

const PROVENANCE_PATTERNS: Array<[RegExp, string]> = [
  [/c2pa/i, "C2PA içerik kimliği"],
  [/jumb/i, "JUMBF manifest kutusu"],
  [/contentauth/i, "Content Authenticity manifesti"],
  [/trainedAlgorithmicMedia/i, "IPTC: yapay zekâ ile üretilmiş medya"],
  [/compositeWithTrainedAlgorithmicMedia/i, "IPTC: yapay zekâ ile birleştirilmiş medya"],
  [/openai|chatgpt|dall[-·.]?e|gpt-image/i, "OpenAI üretim izi"],
  [/midjourney|stable ?diffusion|firefly|imagen|made with google ai|gemini/i, "görsel üretici izi"],
];

const CAMERA_MAKES = /\b(Apple|samsung|HUAWEI|Xiaomi|OPPO|vivo|realme|Google|OnePlus|HONOR|TECNO|Infinix|motorola|Nokia|Sony|Canon|Nikon)\b/i;

/** Metadata-only bytes of a JPEG / PNG / WebP; first 64 KB of anything else. */
function metadataBytes(buf: Buffer): Buffer {
  const parts: Buffer[] = [];
  try {
    if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
      // JPEG: walk the marker segments up to start-of-scan.
      let i = 2;
      while (i + 4 <= buf.length && buf[i] === 0xff) {
        const marker = buf[i + 1]!;
        if (marker === 0xda || marker === 0xd9) break; // SOS / EOI
        const len = buf.readUInt16BE(i + 2);
        if (len < 2) break;
        // APPn (E0–EF) and COM (FE) carry EXIF, XMP, IPTC, JUMBF/C2PA.
        if ((marker >= 0xe0 && marker <= 0xef) || marker === 0xfe) parts.push(buf.subarray(i + 4, i + 2 + len));
        i += 2 + len;
      }
      return Buffer.concat(parts);
    }
    if (buf.length > 8 && buf.subarray(1, 4).toString("latin1") === "PNG") {
      let i = 8;
      while (i + 12 <= buf.length) {
        const len = buf.readUInt32BE(i);
        const type = buf.subarray(i + 4, i + 8).toString("latin1");
        if (type !== "IDAT" && type !== "IEND") parts.push(Buffer.from(type, "latin1"), buf.subarray(i + 8, i + 8 + Math.min(len, 2_000_000)));
        i += 12 + len;
      }
      return Buffer.concat(parts);
    }
    if (buf.length > 12 && buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") {
      let i = 12;
      while (i + 8 <= buf.length) {
        const type = buf.subarray(i, i + 4).toString("latin1");
        const len = buf.readUInt32LE(i + 4);
        if (!type.startsWith("VP8") && type !== "ALPH" && type !== "ANMF") parts.push(Buffer.from(type, "latin1"), buf.subarray(i + 8, i + 8 + Math.min(len, 2_000_000)));
        i += 8 + len + (len % 2);
      }
      return Buffer.concat(parts);
    }
  } catch {
    // fall through
  }
  return buf.subarray(0, 64 * 1024);
}

export async function inspectFile(buffer: Buffer): Promise<FileForensics> {
  let width = 0;
  let height = 0;
  let format: string | null = null;
  let exif: Buffer | undefined;
  try {
    const meta = await sharp(buffer).metadata();
    width = meta.width ?? 0;
    height = meta.height ?? 0;
    format = meta.format ?? null;
    exif = meta.exif;
  } catch {
    // Not decodable here (e.g. HEIC without the codec): byte scan still runs.
  }

  // Only metadata segments are searched. Compressed pixel data is random
  // bytes: over a megabyte of it a four-letter marker turns up by chance a
  // few times in a thousand, and a chance hit here would reject an honest
  // photo as machine-made.
  const haystack = metadataBytes(buffer).toString("latin1");
  const markers = new Set<string>();
  for (const [re, label] of PROVENANCE_PATTERNS) if (re.test(haystack)) markers.add(label);

  const exifText = exif ? exif.toString("latin1") : "";
  const make = exifText.match(CAMERA_MAKES)?.[1] ?? null;

  return {
    width,
    height,
    format,
    ai_provenance_markers: Array.from(markers),
    generator_dimensions: GENERATOR_SIZES.has(`${width}x${height}`),
    camera_make: make,
    has_exif: !!exif && exif.length > 64,
  };
}
