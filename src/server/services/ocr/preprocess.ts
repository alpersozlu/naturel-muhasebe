import "server-only";
import sharp from "sharp";
import convertHeic from "heic-convert";
import { detectOrientation, type QuarterTurn } from "./orientation";

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

/**
 * Above this height/width ratio a receipt is cut into vertical tiles.
 * 1.5 keeps an A4 portrait page (1.41) in one piece and tiles every till
 * strip; a 2.13 market receipt left whole came back "124,69" for a printed
 * 124,99 — two tiles double the pixels per line.
 */
const TILE_RATIO = 1.5;
/** Target height/width of one tile. */
const TARGET_TILE_RATIO = 1.6;
/**
 * Claude scales any image whose long edge exceeds this; larger is wasted.
 * Tiles SMALLER than this are enlarged up to it: upscaling adds no
 * information, but a 589 px strip tile left at native size read "33.630"
 * as "23.630" — glyphs a few pixels high are what the model misreads, and
 * the same pixels drawn larger are read reliably.
 */
const CLAUDE_MAX_EDGE = 1568;

export type ReceiptCrop = { left: number; top: number; width: number; height: number };

/**
 * Receipt-aware variant for long, narrow slips (POS day-end, Z reports).
 *
 * Why: a shared-terminal day-end slip is ~15 cm wide and ~1 m long. Photographed
 * on a desk it is a thin strip of the frame; capped at 2400 px the strip's
 * text is ~350 px wide and unreadable, and Claude's own downscale (long edge
 * ≤ 1568 px) makes it worse. Measured on the 31.08.2026 Mağusa slip: the model
 * could not read it and copied the prompt's worked example (24/08/26,
 * 8.200 / 8.295) verbatim.
 *
 * Steps: EXIF-upright → find the paper (bright, unsaturated pixels; longest
 * contiguous run per axis) → crop → enhance → if taller than TILE_RATIO cut
 * into overlapping tiles, each ≤ CLAUDE_MAX_EDGE so nothing is downscaled.
 * The tiles are sent as several image blocks in one request, top to bottom.
 */
export type ReceiptKind =
  /** Till strip (POS day-end slip, Z report): upright means tall. */
  | "strip"
  /** A page (store summary, invoice): may be landscape, may be sideways. */
  | "document";

export async function preprocessReceipt(
  input: Buffer,
  inputMime?: string,
  opts: { kind?: ReceiptKind } = {}
): Promise<{
  tiles: Buffer[];
  mediaType: "image/jpeg";
  crop: ReceiptCrop | null;
  rotation: QuarterTurn;
  /** "model" when the crop came from locateDocument, "heuristic" otherwise. */
  cropBy: "model" | "heuristic" | "none";
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

  // Apply EXIF rotation once so every coordinate below is in upright space.
  const upright = await sharp(working).rotate().jpeg({ quality: 92 }).toBuffer();
  const meta = await sharp(upright).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  if (!W || !H) {
    const single = await preprocessImage(input, inputMime);
    return { tiles: [single.buffer], mediaType: "image/jpeg", crop: null, rotation: 0, cropBy: "none" };
  }

  // Coarse crop by colour. A vision-model bounding box was measured as the
  // alternative and rejected: on thin strips it came back 2× wider than the
  // heuristic (1632 px vs 737 px), the tiles lost resolution and dates read
  // 08 → 03.
  const crop: ReceiptCrop | null = await detectPaper(upright, W, H);
  const cropBy: "model" | "heuristic" | "none" = crop ? "heuristic" : "none";
  let region = crop
    ? await sharp(upright).extract(crop).jpeg({ quality: 92 }).toBuffer()
    : upright;
  let cw = crop?.width ?? W;
  let ch = crop?.height ?? H;

  // A slip photographed sideways (held in a hand, phone in landscape) has
  // its text running vertically; the model then misreads digits — a Girne
  // İş Bankası slip came back as 2023 instead of 2026, a Garanti slip as
  // 21/06 instead of 25/08. Only a paper that is WIDER than tall can be a
  // sideways slip (a till strip is always tall when upright), and only then
  // do we ask a small vision model which way is up (orientation.ts says how
  // and why). Asked about every image, the model also called four upright
  // strips "90°" — a 737×4032 strip's thumbnail has no readable text — so
  // the question is limited to the ambiguous case.
  // For a PAGE the shape says nothing — a landscape A4 report photographed
  // in portrait is a tall crop with sideways text (Mavi 26.08: the table
  // was read sideways and the header with the date fell outside the tiles)
  // — so pages are always asked.
  const kind = opts.kind ?? "strip";
  let rotation: QuarterTurn = 0;
  if (kind === "document" || cw > ch) {
    const thumb = await sharp(region)
      .resize({ width: 1000, height: 1000, fit: "inside", withoutEnlargement: true })
      .grayscale()
      .normalize()
      .jpeg({ quality: 80 })
      .toBuffer();
    rotation = await detectOrientation(thumb);
    if (rotation !== 0) {
      region = await sharp(region).rotate(rotation).jpeg({ quality: 92 }).toBuffer();
      if (rotation !== 180) [cw, ch] = [ch, cw];
    }
  }

  // Narrow the (now upright) region to the columns that carry printed text
  // (see refineByInk) — after the turn, so that a sideways slip's length is
  // never mistaken for its width.
  const ink = await refineByInk(region, cw, ch);
  if (ink) {
    region = await sharp(region)
      .extract({ left: ink.left, top: 0, width: ink.width, height: ch })
      .jpeg({ quality: 92 })
      .toBuffer();
    cw = ink.width;
  }

  const enhanced = await sharp(region)
    .grayscale()
    .normalize()
    .clahe({ width: 8, height: 8, maxSlope: 3 })
    .sharpen({ sigma: 1.2 })
    .jpeg({ quality: 92 })
    .toBuffer();

  // A wide page (landscape A4 report) shrinks to ~1568×780 at Claude's
  // cap, and the table digits become ~10 px — the Mavi 31.08 report's
  // "29.159,74" row went missing or sign-flipped in half the runs. Two
  // overlapping left/right halves double the pixels per digit; the row
  // order is preserved inside each half, which is what the column
  // pairing relies on.
  if (cw / ch > 1.3) {
    const half = Math.ceil(cw / 2);
    const ov = Math.round(cw * 0.06);
    const parts = [
      { left: 0, top: 0, width: Math.min(cw, half + ov), height: ch },
      { left: Math.max(0, half - ov), top: 0, width: cw - Math.max(0, half - ov), height: ch },
      // The header (store code, date) sits centred at the top and would be
      // split between the halves — a 26.08 report lost its date that way.
      { left: 0, top: 0, width: cw, height: Math.max(1, Math.round(ch * 0.3)) },
    ];
    const tiles: Buffer[] = [];
    for (const p of parts) {
      tiles.push(
        await sharp(enhanced)
          .extract(p)
          .resize({ width: CLAUDE_MAX_EDGE, height: CLAUDE_MAX_EDGE, fit: "inside" })
          .jpeg({ quality: 82, mozjpeg: true })
          .toBuffer()
      );
    }
    return { tiles, mediaType: "image/jpeg", crop, rotation, cropBy };
  }

  // Documents get a native-resolution look at their header as the LAST tile.
  // The date and the document number sit there, and at page scale they are
  // tiny: a 4032 px photo shrinks to 1568, a dot-matrix "TARİH 03.09.2026"
  // stamp on a Done "Alacak Fişi" becomes 12 px and read as 02.09.2025 in
  // one run and 06.09.2025 in the next. The header is the top 30% at up to
  // full resolution, taken from the UN-enhanced crop: CLAHE + sharpening
  // turn a faint dot-matrix stamp into paper-grain noise (the enhanced
  // header still read 05.09.2025), plain grey + normalize keeps the dots.
  // The model is told this tile repeats the top of the page.
  const headerTile = async (): Promise<Buffer> =>
    sharp(region)
      .extract({ left: 0, top: 0, width: cw, height: Math.max(1, Math.round(ch * 0.3)) })
      .grayscale()
      .normalize()
      .resize({ width: CLAUDE_MAX_EDGE, height: CLAUDE_MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer();

  if (ch / cw <= TILE_RATIO) {
    const single = await sharp(enhanced)
      .resize({ width: 2400, height: 2400, fit: "inside" })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    const tiles = kind === "document" ? [single, await headerTile()] : [single];
    return { tiles, mediaType: "image/jpeg", crop, rotation, cropBy };
  }

  const n = Math.ceil(ch / cw / TARGET_TILE_RATIO);
  const tileH = Math.ceil(ch / n);
  // Overlap so a line cut by the tile edge is whole in the neighbour.
  const overlap = Math.round(tileH * 0.06);
  const tiles: Buffer[] = [];
  for (let i = 0; i < n; i++) {
    const top = Math.max(0, i * tileH - overlap);
    const bottom = Math.min(ch, (i + 1) * tileH + overlap);
    tiles.push(
      await sharp(enhanced)
        .extract({ left: 0, top, width: cw, height: bottom - top })
        .resize({
          width: CLAUDE_MAX_EDGE,
          height: CLAUDE_MAX_EDGE,
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: 82, mozjpeg: true })
        .toBuffer()
    );
  }
  if (kind === "document") tiles.push(await headerTile());
  return { tiles, mediaType: "image/jpeg", crop, rotation, cropBy };
}

/**
 * Bounding box of the paper in an upright photo, or null when there is
 * nothing to gain (paper fills the frame, or nothing paper-like was found).
 *
 * Paper = bright AND unsaturated; a wooden desk is bright but coloured, a
 * keyboard is dark. Two passes, deliberately asymmetric:
 *  - columns: the longest run (small gaps bridged) of columns with a high
 *    share of paper pixels — this is where the gain is, a thin strip is
 *    ~20% of the frame's width;
 *  - rows: measured INSIDE that column range, and only leading/trailing
 *    empty rows are trimmed — never an interior dip. A first version kept
 *    the densest row run and cut the shadowed bottom quarter off three
 *    slips (the Yapı Kredi summary block went missing).
 * Then pad 3%.
 */
async function detectPaper(upright: Buffer, W: number, H: number): Promise<ReceiptCrop | null> {
  const tw = 240;
  const th = Math.max(1, Math.round((H / W) * tw));
  const { data } = await sharp(upright)
    .resize(tw, th, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const lum = new Float32Array(tw * th);
  const sat = new Float32Array(tw * th);
  for (let p = 0; p < tw * th; p++) {
    const r = data[p * 3]!;
    const g = data[p * 3 + 1]!;
    const b = data[p * 3 + 2]!;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    lum[p] = 0.299 * r + 0.587 * g + 0.114 * b;
    sat[p] = max === 0 ? 0 : (max - min) / max;
  }

  // Paper is the LEAST saturated bright thing in the frame. Try a tight
  // saturation cut first (pale wooden desks sit around 0.2) and loosen only
  // if nothing paper-like shows up (paper tinted by warm light).
  for (const satMax of [0.12, 0.18, 0.25]) {
    const paper = new Uint8Array(tw * th);
    // 135 not 150: paper in a desk-lamp shadow still reads ~140.
    for (let p = 0; p < tw * th; p++) if (lum[p]! > 135 && sat[p]! < satMax) paper[p] = 1;

    // Pass 1 — columns over all rows; pick the run holding the most paper.
    // Several papers in one frame (a Z report beside the slip) give several
    // runs; when the runner-up is comparable we cannot know which one the
    // user meant, so give up on cropping and let the model see everything.
    const cols = new Float32Array(tw);
    for (let y = 0; y < th; y++)
      for (let x = 0; x < tw; x++) if (paper[y * tw + x]) cols[x]! += 1 / th;
    const runs = denseRuns(cols, Math.round(tw * 0.05));
    if (runs.length === 0) continue;
    const areaOf = (r: [number, number]) => {
      let a = 0;
      for (let x = r[0]; x <= r[1]; x++) a += cols[x]!;
      return a;
    };
    runs.sort((a, b) => areaOf(b) - areaOf(a));
    const xr = runs[0]!;
    if (runs.length > 1 && areaOf(runs[1]!) > 0.5 * areaOf(xr)) return null;

    // Pass 2 — rows inside the paper columns; trim only the empty ends.
    const rows = new Float32Array(th);
    const span = xr[1] - xr[0] + 1;
    for (let y = 0; y < th; y++)
      for (let x = xr[0]; x <= xr[1]; x++) if (paper[y * tw + x]) rows[y]! += 1 / span;
    let y0 = 0;
    while (y0 < th && rows[y0]! < 0.05) y0++;
    let y1 = th - 1;
    while (y1 > y0 && rows[y1]! < 0.05) y1--;
    if (y1 - y0 < 2) continue;

    const padX = Math.round(W * 0.03);
    const padY = Math.round(H * 0.03);
    const left = Math.max(0, Math.floor((xr[0] / tw) * W) - padX);
    const top = Math.max(0, Math.floor((y0 / th) * H) - padY);
    const right = Math.min(W, Math.ceil(((xr[1] + 1) / tw) * W) + padX);
    const bottom = Math.min(H, Math.ceil(((y1 + 1) / th) * H) + padY);
    const width = right - left;
    const height = bottom - top;
    if (width * height < 0.04 * W * H) continue; // implausibly small
    // Paper spans the whole frame: either the page fills the photo (nothing
    // to gain) or a long strip runs the length of the frame with other
    // papers BESIDE it, close enough to merge into one wide run at this
    // threshold and to keep the rows from trimming. The Derimod Mağusa
    // 07.09.2026 Optimum + Yapı Kredi strip (a fifth of the frame's width,
    // beside a Z report and a note) went to the model as ONE 1568 px tile:
    // 20.688 for 20.668, no date. Cropped to the strip it read both banks.
    if (width >= 0.97 * W && height >= 0.97 * H) {
      return spanningStrip(paper, tw, th, W, H) ?? (await spanningByTexture(upright, W, H));
    }
    return { left, top, width, height };
  }
  return null;
}

/**
 * Last resort for a frame the paper mask fills because the DESK is as
 * bright and grey as paper (pale travertine, Derimod Mağusa): colour cannot
 * separate the strip, print texture can. The frame is cut into 40 blocks
 * along the height; a column "carries text" in a block when it has a few
 * strong horizontal gradients there. A till strip has text along most of
 * its length (coverage 0.4–0.8 in its columns), a note or a Z report beside
 * it only along a quarter, the desk's veins are sparse (≤0.25). Measured
 * on the 07.09.2026 photo: the strip's core clears 0.35 alone, everything
 * else stays under it. The core is then widened while coverage stays above
 * 0.15 (the strip's blank margins), and the rows inside the band are
 * trimmed at their textless ends only. Columns first, then rows for a
 * strip lying across a landscape photo.
 */
async function spanningByTexture(upright: Buffer, W: number, H: number): Promise<ReceiptCrop | null> {
  const tw = 480;
  const th = Math.max(1, Math.min(2400, Math.round((H / W) * tw * 2)));
  const { data } = await sharp(upright)
    .resize(tw, th, { fit: "fill" })
    .grayscale()
    .normalize()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const NB = 40;
  const T = 30;
  const MIN = 3;
  const edge = (x: number, y: number) => Math.abs(data[y * tw + x + 1]! - data[y * tw + x]!) > T;

  // Coverage along one axis: fraction of the NB blocks of the other axis in
  // which this line carries text.
  const coverage = (axis: "cols" | "rows"): Float32Array => {
    const n = axis === "cols" ? tw : th;
    const other = axis === "cols" ? th : tw;
    const cnt = new Uint16Array(n * NB);
    for (let y = 0; y < th; y++)
      for (let x = 0; x + 1 < tw; x++)
        if (edge(x, y)) {
          const i = axis === "cols" ? x : y;
          const j = axis === "cols" ? y : x;
          cnt[i * NB + Math.min(NB - 1, Math.floor((j / other) * NB))]!++;
        }
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let k = 0;
      for (let b = 0; b < NB; b++) if (cnt[i * NB + b]! >= MIN) k++;
      out[i] = k / NB;
    }
    return out;
  };
  const band = (cov: Float32Array): [number, number] | null => {
    const runs = runsAbove(cov, 0.35, Math.round(cov.length * 0.05));
    if (runs.length === 0) return null;
    const areaOf = (r: [number, number]) => {
      let a = 0;
      for (let i = r[0]; i <= r[1]; i++) a += cov[i]!;
      return a;
    };
    runs.sort((a, b) => areaOf(b) - areaOf(a));
    const core = runs[0]!;
    if (runs.length > 1 && areaOf(runs[1]!) > 0.5 * areaOf(core)) return null;
    if (core[1] - core[0] + 1 < cov.length * 0.04) return null;
    let a = core[0];
    let b = core[1];
    while (a > 0 && cov[a - 1]! > 0.15) a--;
    while (b + 1 < cov.length && cov[b + 1]! > 0.15) b++;
    if (b - a + 1 > cov.length * 0.6) return null;
    return [a, b];
  };
  // Extent along the other axis inside the band: trim textless ends only.
  const extent = (axis: "cols" | "rows", r: [number, number]): [number, number] | null => {
    const n = axis === "cols" ? th : tw;
    const dens = new Float32Array(n);
    const span = r[1] - r[0] + 1;
    for (let y = 0; y < th; y++)
      for (let x = 0; x + 1 < tw; x++) {
        const inBand = axis === "cols" ? x >= r[0] && x <= r[1] : y >= r[0] && y <= r[1];
        if (inBand && edge(x, y)) dens[axis === "cols" ? y : x]! += 1 / span;
      }
    let a = 0;
    while (a < n && dens[a]! < 0.02) a++;
    let b = n - 1;
    while (b > a && dens[b]! < 0.02) b--;
    if (b - a + 1 < n * 0.2) return null; // too short to be a strip
    return [a, b];
  };
  const build = (xr: [number, number], yr: [number, number]): ReceiptCrop | null => {
    const padX = Math.round(W * 0.03);
    const padY = Math.round(H * 0.03);
    const left = Math.max(0, Math.floor((xr[0] / tw) * W) - padX);
    const top = Math.max(0, Math.floor((yr[0] / th) * H) - padY);
    const right = Math.min(W, Math.ceil(((xr[1] + 1) / tw) * W) + padX);
    const bottom = Math.min(H, Math.ceil(((yr[1] + 1) / th) * H) + padY);
    const width = right - left;
    const height = bottom - top;
    if (width * height < 0.04 * W * H) return null;
    if (width >= 0.97 * W && height >= 0.97 * H) return null;
    return { left, top, width, height };
  };

  const xr = band(coverage("cols"));
  if (xr) {
    const yr = extent("cols", xr);
    if (yr) return build(xr, yr);
  }
  const yr = band(coverage("rows"));
  if (yr) {
    const xr2 = extent("rows", yr);
    if (xr2) return build(xr2, yr);
  }
  return null;
}

/**
 * Fallback for a frame the paper mask fills: a strip that runs the LENGTH
 * of the frame has paper in ≥60% of the rows of each of its columns, while
 * a note or a Z report beside it — a quarter of the height — drops out at
 * that threshold. Same ambiguity rule as the main pass (a comparable
 * runner-up means we cannot tell which paper was meant); the band must be
 * a plausible strip (6–60% of the axis). Tried on the columns first, then
 * on the rows (a strip lying across a landscape photo), and the other axis
 * is trimmed at its empty ends only, never at an interior dip.
 */
function spanningStrip(paper: Uint8Array, tw: number, th: number, W: number, H: number): ReceiptCrop | null {
  const cols = new Float32Array(tw);
  const rows = new Float32Array(th);
  for (let y = 0; y < th; y++)
    for (let x = 0; x < tw; x++)
      if (paper[y * tw + x]) {
        cols[x]! += 1 / th;
        rows[y]! += 1 / tw;
      }
  const pick = (d: Float32Array, gap: number): [number, number] | null => {
    const runs = runsAbove(d, 0.6, gap);
    if (runs.length === 0) return null;
    const areaOf = (r: [number, number]) => {
      let a = 0;
      for (let i = r[0]; i <= r[1]; i++) a += d[i]!;
      return a;
    };
    runs.sort((a, b) => areaOf(b) - areaOf(a));
    const best = runs[0]!;
    if (runs.length > 1 && areaOf(runs[1]!) > 0.5 * areaOf(best)) return null;
    const w = best[1] - best[0] + 1;
    if (w < d.length * 0.06 || w > d.length * 0.6) return null;
    return best;
  };
  const trimmed = (d: Float32Array): [number, number] | null => {
    let a = 0;
    while (a < d.length && d[a]! < 0.05) a++;
    let b = d.length - 1;
    while (b > a && d[b]! < 0.05) b--;
    return b - a < 2 ? null : [a, b];
  };
  const build = (xr: [number, number], yr: [number, number]): ReceiptCrop | null => {
    const padX = Math.round(W * 0.03);
    const padY = Math.round(H * 0.03);
    const left = Math.max(0, Math.floor((xr[0] / tw) * W) - padX);
    const top = Math.max(0, Math.floor((yr[0] / th) * H) - padY);
    const right = Math.min(W, Math.ceil(((xr[1] + 1) / tw) * W) + padX);
    const bottom = Math.min(H, Math.ceil(((yr[1] + 1) / th) * H) + padY);
    const width = right - left;
    const height = bottom - top;
    if (width * height < 0.04 * W * H) return null;
    if (width >= 0.97 * W && height >= 0.97 * H) return null;
    return { left, top, width, height };
  };

  const xr = pick(cols, Math.round(tw * 0.05));
  if (xr) {
    const inside = new Float32Array(th);
    const span = xr[1] - xr[0] + 1;
    for (let y = 0; y < th; y++)
      for (let x = xr[0]; x <= xr[1]; x++) if (paper[y * tw + x]) inside[y]! += 1 / span;
    const yr = trimmed(inside);
    if (yr) return build(xr, yr);
  }
  const yr = pick(rows, Math.round(th * 0.05));
  if (yr) {
    const inside = new Float32Array(tw);
    const span = yr[1] - yr[0] + 1;
    for (let y = yr[0]; y <= yr[1]; y++)
      for (let x = 0; x < tw; x++) if (paper[y * tw + x]) inside[x]! += 1 / span;
    const xr2 = trimmed(inside);
    if (xr2) return build(xr2, yr);
  }
  return null;
}

/**
 * Narrow a coarse paper crop to the paper's own columns.
 *
 * The colour heuristic takes anything bright and grey for paper: a silver
 * laptop lid beside a slip gave a crop 3× the slip's width, the tiles kept
 * the text small and the digits went wrong (6.700 → 5.700). Measured
 * column profiles on seven photos: brightness alone cannot tell a shaded
 * hand-held slip from a laptop lid (both sit 25–45 levels under the peak),
 * and an ink test finds nothing on faint thermal print. What separates
 * them is TEXTURE: printed paper has strong horizontal gradients in every
 * column, a lid has none, a desk has texture but is dark. So: take the
 * widest bright band, then trim its two ends while they carry no text
 * texture — the lid falls off the end, the shaded interior of a slip stays.
 * Width only; the height stays. Runs after the quarter turn, so a sideways
 * slip's length is never mistaken for its width.
 *
 * Column brightness is the 70th percentile of the column, not its mean: a
 * thumb or a flyer covering one END of the slip drags the mean of those
 * columns under the paper threshold and the band then starts inside the
 * text — an İş Bankası 30.08.2026 slip lost the first three characters of
 * every line ("30/08/2026" → "…2026") and the date came back as 1 January.
 * The percentile ignores a third of the column being covered.
 */
async function refineByInk(
  region: Buffer,
  width: number,
  height: number
): Promise<{ left: number; width: number } | null> {
  const tw = 400;
  // Twice the proportional height: text texture needs vertical detail.
  const th = Math.max(1, Math.min(2400, Math.round((height / width) * tw * 2)));
  const { data } = await sharp(region)
    .resize(tw, th, { fit: "fill" })
    .grayscale()
    .normalize()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const lum = new Float32Array(tw);
  const grad = new Float32Array(tw);
  const hist = new Uint32Array(tw * 256);
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const v = data[y * tw + x]!;
      hist[x * 256 + v]!++;
      if (x + 1 < tw) grad[x]! += Math.abs(data[y * tw + x + 1]! - v) / th;
    }
  }
  for (let x = 0; x < tw; x++) {
    let acc = 0;
    const target = th * 0.7;
    for (let v = 0; v < 256; v++) {
      acc += hist[x * 256 + v]!;
      if (acc >= target) {
        lum[x] = v;
        break;
      }
    }
  }
  let peak = 0;
  let gmax = 0;
  for (let x = 0; x < tw; x++) {
    if (lum[x]! > peak) peak = lum[x]!;
    if (grad[x]! > gmax) gmax = grad[x]!;
  }
  if (peak < 120 || gmax <= 0) return null;
  const bright = new Float32Array(tw);
  for (let x = 0; x < tw; x++) bright[x] = lum[x]! >= peak - 45 ? 1 : 0;
  const runs = denseRuns(bright, Math.round(tw * 0.05));
  if (runs.length === 0) return null;
  let best = runs[0]!;
  for (const r of runs) if (r[1] - r[0] > best[1] - best[0]) best = r;
  const textured = (x: number) => grad[x]! >= gmax * 0.35;
  let a = best[0];
  let b = best[1];
  while (a < b && !textured(a)) a++;
  while (b > a && !textured(b)) b--;
  const runW = b - a + 1;
  if (runW < tw * 0.25) return null; // nothing that looks like a printed sheet
  const pad = Math.round(runW * 0.08);
  const x0 = Math.max(0, a - pad);
  const x1 = Math.min(tw - 1, b + pad);
  const left = Math.floor((x0 / tw) * width);
  const right = Math.min(width, Math.ceil(((x1 + 1) / tw) * width));
  if (right - left >= width * 0.97) return null; // already the region
  return { left, width: right - left };
}

/**
 * Runs of indices whose density clears a threshold relative to the peak;
 * runs separated by at most `gap` weak entries are merged (a fold, a logo,
 * a shadow band).
 */
function denseRuns(density: Float32Array, gap: number): Array<[number, number]> {
  let max = 0;
  for (let i = 0; i < density.length; i++) if (density[i]! > max) max = density[i]!;
  if (max < 0.15) return [];
  return runsAbove(density, Math.max(0.05, max * 0.3), gap);
}

/** Runs of indices whose density exceeds an absolute threshold; gaps of at most `gap` merged. */
function runsAbove(density: Float32Array, thr: number, gap: number): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  let start = -1;
  for (let i = 0; i <= density.length; i++) {
    const on = i < density.length && density[i]! > thr;
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      const last = runs[runs.length - 1];
      if (last && start - last[1] - 1 <= gap) last[1] = i - 1;
      else runs.push([start, i - 1]);
      start = -1;
    }
  }
  return runs;
}
