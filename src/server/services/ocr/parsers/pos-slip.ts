import "server-only";
import sharp from "sharp";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { getAnthropic, OCR_MODEL } from "@/lib/anthropic";
import { preprocessReceipt } from "../preprocess";
import {
  posSlipOcrSchema,
  posSlipOutputSchema,
  type PosSlipOcr,
} from "../schemas/pos-slip";
import {
  POS_SLIP_SYSTEM_PROMPT,
  POS_SLIP_USER_PROMPT,
} from "../prompts/pos-slip";

/** Constrained decoders emit "" where the prompt says null; treat as null. */
function blankToNull<T extends Record<string, unknown>>(obj: T, keys: (keyof T)[]): T {
  for (const k of keys) {
    if (typeof obj[k] === "string" && (obj[k] as string).trim() === "") {
      (obj as Record<string, unknown>)[k as string] = null;
    }
  }
  return obj;
}

export async function parsePosSlip(opts: {
  buffer: Buffer;
  mimeType: string;
}): Promise<{ raw: unknown; parsed: PosSlipOcr; rawText: string; tiles: number }> {
  const isPdf = opts.mimeType === "application/pdf";

  // A long slip arrives as several tiles (top to bottom) in ONE request;
  // the prompt tells the model they are pieces of the same slip.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const content: any[] = [];
  let tileCount = 1;
  let tiles: Buffer[] = [];
  if (isPdf) {
    content.push({
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: opts.buffer.toString("base64"),
      },
    });
  } else {
    const r = await preprocessReceipt(opts.buffer, opts.mimeType);
    tileCount = r.tiles.length;
    tiles = r.tiles;
    for (const tile of r.tiles) {
      content.push({
        type: "image",
        source: { type: "base64", media_type: r.mediaType, data: tile.toString("base64") },
      });
    }
  }
  content.push({ type: "text", text: POS_SLIP_USER_PROMPT });

  const client = getAnthropic();
  // Structured output: the decoder cannot narrate ("ADIM 1 …") before the
  // JSON; its only scratchpad is `check_notes`, first in the schema.
  const response = await client.messages.parse({
    model: OCR_MODEL,
    max_tokens: 2048,
    system: POS_SLIP_SYSTEM_PROMPT,
    messages: [{ role: "user", content }],
    output_config: { format: zodOutputFormat(posSlipOutputSchema) },
  });

  const rawText = response.content
    .filter((c) => c.type === "text")
    .map((c) => (c as { type: "text"; text: string }).text)
    .join("\n");

  const out = response.parsed_output;
  if (!out) {
    throw new Error(`Claude returned non-JSON output: ${rawText.slice(0, 200)}`);
  }
  blankToNull(out, ["date", "date_raw", "rejection_reason"]);
  for (const s of out.sections) blankToNull(s, ["terminal_no"]);
  out.sections = out.sections.filter((s) => s.bank_name.trim() !== "");

  // Vote on each bank's total: the printed totals the model saw plus the
  // sum of the card/type breakdown. See reconcileSectionTotal.
  const notes: string[] = [];
  for (const sec of out.sections) {
    let r = reconcileSectionTotal(sec);
    if (r === TIE && tiles.length > 0) {
      r = await settleTieByZoom(client, tiles, sec);
    }
    if (r && r !== TIE) notes.push(`${sec.bank_name}: ${r}`);
  }

  // Singular fields mirror the first bank (legacy consumers, fingerprints).
  const first = out.sections[0];
  const raw = {
    ...out,
    bank_name: first?.bank_name ?? null,
    terminal_no: first?.terminal_no ?? null,
    sales_count: first?.sales_count ?? null,
    sales_amount: first?.sales_amount ?? null,
    refund_count: first?.refund_count ?? null,
    refund_amount: first?.refund_amount ?? null,
    net_amount: first?.net_amount ?? null,
    ...(notes.length ? { total_reconciliation: notes } : {}),
  };
  const parsed = posSlipOcrSchema.parse(raw);
  return { raw, parsed, rawText, tiles: tileCount };
}

const near = (a: number, b: number) => Math.abs(a - b) <= 0.05;

/** reconcileSectionTotal's "cannot decide from the numbers" result. */
const TIE = "__tie__";

const secondLookSchema = z.object({
  printed_totals: z.array(z.number()),
  breakdown_amounts: z.array(z.number()),
});

/**
 * Second look at 2× magnification when a printed total and the breakdown
 * disagree by one digit. Each tile is cut in two and enlarged to Claude's
 * edge cap, so every glyph is drawn about twice as large as in the first
 * pass, and the model is asked to re-read ONLY the disputed lines, digit by
 * digit. Whichever side the fresh reading agrees with wins; if it agrees
 * with neither, the printed total stands (the bank's own line, for a human
 * to check). This is exactly the check a person makes with a magnifier —
 * it was how the true totals of both measured slips were established.
 */
async function settleTieByZoom(
  client: ReturnType<typeof getAnthropic>,
  tiles: Buffer[],
  sec: {
    net_amount: number | null;
    sales_amount: number | null;
    breakdown?: Array<{ label: string; count: number | null; amount: number | null }>;
    total_candidates?: number[];
    evidence_tiles?: number[];
  }
): Promise<string | null> {
  const printed = (sec.total_candidates ?? []).find((c) => c > 0);
  const rows = (sec.breakdown ?? []).filter((r) => r.amount != null && !/iade|iptal/i.test(r.label));
  const bdSum = rows.reduce((a, r) => a + (r.amount ?? 0), 0);
  if (printed == null || rows.length === 0) return null;
  // Only the tiles the model said carry this bank's breakdown and totals —
  // enlarging all of them took 40 s on a five-tile slip and blew the 60 s
  // function budget. Fallback: the last tile (totals sit at the end of a
  // strip). At most two tiles, four images, and a hard 20 s cap on the
  // call: whatever the second look cannot settle in that time is left to
  // the printed total, never to the function being killed.
  const wanted = (sec.evidence_tiles ?? [])
    .map((n) => Math.round(n) - 1)
    .filter((i) => i >= 0 && i < tiles.length);
  const pick = (wanted.length > 0 ? Array.from(new Set(wanted)) : [tiles.length - 1])
    .filter((i) => i >= 0)
    .slice(-2);
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const content: any[] = [];
    for (const t of pick.map((i) => tiles[i]!)) {
      const m = await sharp(t).metadata();
      const h = m.height ?? 0;
      const w = m.width ?? 0;
      if (!h || !w) continue;
      const half = Math.ceil(h / 2);
      const ov = Math.round(h * 0.06);
      for (const top of [0, Math.max(0, half - ov)]) {
        const height = Math.min(h - top, half + ov);
        const zoomed = await sharp(t)
          .extract({ left: 0, top, width: w, height })
          .resize({ width: 1568, height: 1568, fit: "inside" })
          .jpeg({ quality: 85 })
          .toBuffer();
        content.push({
          type: "image",
          source: { type: "base64", media_type: "image/jpeg", data: zoomed.toString("base64") },
        });
      }
    }
    const rowList = rows.map((r) => `${r.label}: ${r.amount}`).join("; ");
    content.push({
      type: "text",
      text:
        `Bu büyütülmüş parçalar aynı POS gün sonu slibine ait. İlk okumada iki değer ` +
        `çelişti: basılı TOPLAM ${printed} ile kart/işlem tipi kırılımının toplamı ${bdSum} ` +
        `(satırlar: ${rowList}). Aralarında tek hane fark var; biri yanlış okunmuş. ` +
        `Yalnız şunları RAKAM RAKAM, büyüteçle bakar gibi tekrar oku: (1) slipte basılı her ` +
        `TOPLAM / GENEL TOPLAM / T.TUTAR satırı → printed_totals; (2) kırılım satırlarının ` +
        `her birinin tutarı, aynı sırayla → breakdown_amounts. 5↔6, 3↔8, 2↔3, 0↔8 ` +
        `karışmalarına özellikle dikkat et. Önceki okumaları KOPYALAMA; gördüğünü yaz.`,
    });
    const t0 = Date.now();
    const response = await client.messages.parse(
      {
        model: OCR_MODEL,
        max_tokens: 512,
        messages: [{ role: "user", content }],
        output_config: { format: zodOutputFormat(secondLookSchema) },
      },
      { timeout: 20_000 }
    );
    console.info(
      `[OCR] POS second look: ${content.length - 1} images from tiles ${pick.map((i) => i + 1).join(",")} in ${Date.now() - t0} ms`
    );
    const look = response.parsed_output;
    if (!look) return null;
    const newBd = look.breakdown_amounts.reduce((a, b) => a + b, 0);
    const newPrinted = look.printed_totals.filter((c) => c > 0);
    const supports = (v: number) =>
      (newPrinted.some((c) => near(c, v)) ? 1 : 0) + (near(newBd, v) ? 1 : 0);
    const forPrinted = supports(printed);
    const forBd = supports(bdSum);
    let winner: number;
    let why: string;
    if (forBd > forPrinted) {
      winner = bdSum;
      why = `ikinci bakış kırılımı doğruladı (basılı ${newPrinted.join("/")}, kırılım ${newBd})`;
    } else if (forPrinted > forBd) {
      winner = printed;
      why = `ikinci bakış basılı toplamı doğruladı (basılı ${newPrinted.join("/")}, kırılım ${newBd})`;
    } else {
      winner = printed;
      why = `ikinci bakış karar veremedi, basılı toplam bırakıldı (basılı ${newPrinted.join("/")}, kırılım ${newBd})`;
    }
    const before = sec.net_amount;
    if (before != null && near(before, winner)) return `net ${before} korundu — ${why}`;
    sec.net_amount = Math.round(winner * 100) / 100;
    if (sec.sales_amount == null || (before != null && near(sec.sales_amount, before))) {
      sec.sales_amount = sec.net_amount;
    }
    return `net ${before} → ${sec.net_amount} — ${why}`;
  } catch (e) {
    console.warn("[OCR] POS second look failed", e);
    return null;
  }
}

/** Same number of digits (in kuruş) and exactly one position differs. */
function oneDigitApart(a: number, b: number): boolean {
  const sa = String(Math.round(a * 100));
  const sb = String(Math.round(b * 100));
  if (sa.length !== sb.length) return false;
  let diff = 0;
  for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) diff++;
  return diff === 1;
}

/**
 * Decide a bank's net total from the evidence on the slip rather than from
 * one line. A Yapı Kredi 31.08.2026 slip printed 91.530,00 three ways —
 * PEŞİN TOPLAM, the four-row card breakdown (6.700 + 38.149 + 39.081 +
 * 7.600, counts 1+19+17+1 = 38) and the GRUP KAPAMA line — but the last
 * one sat in a fold and read as 91.610,00; the prompt's "prefer the
 * bottom-most total" picked exactly that.
 *
 * Votes: every printed candidate is one vote for its value; the breakdown
 * sum is one vote; a breakdown whose counts add up to the sales count is a
 * second vote for its sum. The value with the most votes wins when it has
 * at least two; otherwise the model's own net_amount stands. Mutates the
 * section; returns a one-line note for diagnostics, or null if untouched.
 */
function reconcileSectionTotal(sec: {
  net_amount: number | null;
  sales_amount: number | null;
  sales_count: number | null;
  breakdown?: Array<{ label: string; count: number | null; amount: number | null }>;
  total_candidates?: number[];
  transaction_amounts?: number[];
}): string | null {
  // Evidence KINDS, not raw votes: the same value must be backed by two
  // independent sources. Measured on one slip: in one run the breakdown was
  // misread with the counts still right, in another the printed total was
  // misread (91.530 → 91.630) while breakdown and transaction list both
  // said 91.530. Neither the printed line nor the breakdown alone is
  // trustworthy; agreement between two different kinds is.
  const votes = new Map<number, { kinds: Set<string>; why: string[] }>();
  const vote = (v: number, kind: string, why: string) => {
    const key = Array.from(votes.keys()).find((k) => near(k, v)) ?? v;
    const cur = votes.get(key) ?? { kinds: new Set<string>(), why: [] };
    cur.kinds.add(kind);
    cur.why.push(why);
    votes.set(key, cur);
  };
  for (const c of sec.total_candidates ?? []) if (c > 0) vote(c, "printed", "basılı toplam");

  const rows = (sec.breakdown ?? []).filter((r) => r.amount != null);
  const isRefund = (l: string) => /iade|iptal/i.test(l);
  if (rows.length > 0) {
    const sales = rows.filter((r) => !isRefund(r.label));
    const sum = sales.reduce((a, r) => a + (r.amount ?? 0), 0);
    const cnt = sales.reduce((a, r) => a + (r.count ?? 0), 0);
    if (sum > 0) {
      const countOk = sec.sales_count != null && cnt === sec.sales_count;
      vote(sum, "breakdown", `kırılım toplamı (${sales.length} satır${countOk ? `, adet ${cnt} tutuyor` : ""})`);
    }
  }
  const tx = (sec.transaction_amounts ?? []).filter((a) => a > 0);
  if (tx.length >= 3) {
    const sum = tx.reduce((a, b) => a + b, 0);
    vote(sum, "transactions", `işlem listesi toplamı (${tx.length} satır)`);
  }
  if (votes.size === 0) return null;

  let best: { v: number; n: number; why: string[] } | null = null;
  for (const [v, x] of Array.from(votes.entries())) {
    if (!best || x.kinds.size > best.n) best = { v, n: x.kinds.size, why: x.why };
  }
  if (!best) return null;
  if (best.n < 2) {
    // The one pattern seen again and again: a printed total and a complete
    // breakdown (counts add up) that differ in exactly ONE digit. Measured
    // both ways — once the bold total was misread (91.530 → 91.630), once a
    // breakdown row was (33.630 → 23.630) — so neither side can be
    // preferred from the numbers. Signal a tie; the caller takes a second,
    // zoomed look (settleTieByZoom).
    const printed = Array.from(votes.entries()).find(([, x]) => x.kinds.has("printed"));
    const broken = Array.from(votes.entries()).find(
      ([, x]) => x.kinds.has("breakdown") && x.why.some((w) => w.includes("adet"))
    );
    if (printed && broken && oneDigitApart(printed[0], broken[0])) return TIE;
    return null;
  }
  if (sec.net_amount != null && near(sec.net_amount, best.v)) return null;

  const before = sec.net_amount;
  sec.net_amount = Math.round(best.v * 100) / 100;
  if (sec.sales_amount == null || (before != null && near(sec.sales_amount, before))) {
    sec.sales_amount = sec.net_amount;
  }
  return `net ${before} → ${sec.net_amount} (${best.n} kanıt: ${best.why.join(", ")})`;
}
