import "server-only";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { getAnthropic, OCR_MODEL } from "@/lib/anthropic";
import { preprocessReceipt } from "../preprocess";
import {
  zReportOcrSchema,
  zReportOutputSchema,
  type ZReportOcr,
} from "../schemas/z-report";
import {
  Z_REPORT_SYSTEM_PROMPT,
  Z_REPORT_USER_PROMPT,
} from "../prompts/z-report";

/** Constrained decoders emit "" where the prompt says null; treat as null. */
function blankToNull<T extends Record<string, unknown>>(obj: T, keys: (keyof T)[]): T {
  for (const k of keys) {
    if (typeof obj[k] === "string" && (obj[k] as string).trim() === "") {
      (obj as Record<string, unknown>)[k as string] = null;
    }
  }
  return obj;
}

/**
 * "*77.000,00", "*34,320,00" (this till uses commas for thousands too),
 * "77.000,00 TL" → 77000. The last separator followed by exactly two
 * digits is the decimal mark; every other separator is a thousands mark.
 */
function parsePrintedAmount(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const m = raw.replace(/^[^0-9]+/, "").match(/^[\d.,]+/);
  if (!m) return null;
  const t = m[0].replace(/[.,]+$/, "");
  const dec = t.match(/^(.*)[.,](\d{2})$/);
  const whole = (dec ? dec[1] : t).replace(/[.,]/g, "");
  const n = Number(dec ? `${whole}.${dec[2]}` : whole);
  return Number.isFinite(n) ? n : null;
}

const VAT_RATES = [1, 8, 10, 18, 20];
/** Total VAT equals net × r/(100+r) for one of the rates (½ % or 1 TL). */
function vatConsistent(net: number | null, vat: number | null): boolean {
  if (net == null || vat == null || net <= 0) return false;
  return VAT_RATES.some((r) => Math.abs(vat - (net * r) / (100 + r)) <= Math.max(1, net * 0.005));
}

/**
 * The till prints "*" right before every amount; read as a digit it becomes
 * a leading 4 (Mavi Güzelyurt 29.09.2026: 477.000,00 for 77.000,00, KDV
 * 47.000,01 for 7.000,01). Two independent repairs, both checked by the
 * VAT arithmetic (66 of 67 stored Z reports satisfy it): the printed
 * strings the model copied, then dropping a leading 4 from the amounts.
 */
export function settleStarMisread(parsed: ZReportOcr): string | null {
  const g = parsed.gross_sales, n = parsed.net_sales, v = parsed.vat_total;
  if (vatConsistent(n ?? g, v)) return null;
  const tryApply = (gg: number | null, nn: number | null, vv: number | null, how: string): string | null => {
    if (!vatConsistent(nn ?? gg, vv)) return null;
    if (gg != null && nn != null && gg + 0.5 < nn) return null;
    // No refund on the strip → gross and net are the same figure; the one
    // the VAT arithmetic vouched for (net) wins.
    if (gg != null && nn != null && !(parsed.refund_amount ?? 0) && Math.abs(gg - nn) > 0.5) gg = nn;
    parsed.gross_sales = gg; parsed.net_sales = nn; parsed.vat_total = vv;
    return how;
  };
  // 1) printed strings
  const rg = parsePrintedAmount(parsed.gross_sales_raw), rn = parsePrintedAmount(parsed.net_sales_raw), rv = parsePrintedAmount(parsed.vat_total_raw);
  if (rg != null || rn != null || rv != null) {
    const fixed = tryApply(rg ?? g, rn ?? n ?? rg ?? g, rv ?? v, `basılı metinden: brüt ${g}→${rg ?? g}, net ${n}→${rn ?? n}, KDV ${v}→${rv ?? v}`);
    if (fixed) return fixed;
  }
  // 2) drop a leading 4 (the star) wherever it appears
  const drop4 = (x: number | null): number | null => {
    if (x == null) return null;
    const s = x.toFixed(2);
    return s.startsWith("4") && s.length > 4 ? Number(s.slice(1)) : x;
  };
  const cands: Array<[number | null, number | null, number | null]> = [
    [drop4(g), drop4(n), drop4(v)],
    [drop4(g), drop4(n), v],
    [g, n, drop4(v)],
  ];
  for (const [gg, nn, vv] of cands) {
    if (gg === g && nn === n && vv === v) continue;
    const fixed = tryApply(gg, nn, vv, `baştaki 4 = yıldız: brüt ${g}→${gg}, net ${n}→${nn}, KDV ${v}→${vv}`);
    if (fixed) return fixed;
  }
  return null;
}

export async function parseZReport(opts: {
  buffer: Buffer;
  mimeType: string;
}): Promise<{ raw: unknown; parsed: ZReportOcr; rawText: string; tiles: number }> {
  const isPdf = opts.mimeType === "application/pdf";

  // A Z report is a long till strip: same paper crop + tiling as POS slips.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const content: any[] = [];
  let tileCount = 1;
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
    for (const tile of r.tiles) {
      content.push({
        type: "image",
        source: { type: "base64", media_type: r.mediaType, data: tile.toString("base64") },
      });
    }
  }
  content.push({ type: "text", text: Z_REPORT_USER_PROMPT });

  const client = getAnthropic();
  const response = await client.messages.parse({
    model: OCR_MODEL,
    max_tokens: 2048,
    system: Z_REPORT_SYSTEM_PROMPT,
    messages: [{ role: "user", content }],
    output_config: { format: zodOutputFormat(zReportOutputSchema) },
  });

  const rawText = response.content
    .filter((c) => c.type === "text")
    .map((c) => (c as { type: "text"; text: string }).text)
    .join("\n");

  const raw = response.parsed_output;
  if (!raw) {
    throw new Error(`Claude returned non-JSON output: ${rawText.slice(0, 200)}`);
  }
  blankToNull(raw, ["report_no", "report_date", "report_date_raw", "rejection_reason", "gross_sales_raw", "net_sales_raw", "vat_total_raw"]);

  const parsed = zReportOcrSchema.parse(raw);
  const starFix = settleStarMisread(parsed);
  if (starFix) {
    Object.assign(raw as object, { star_fix: starFix });
    console.info(`[OCR] Z star fix — ${starFix}`);
  }
  return { raw, parsed, rawText, tiles: tileCount };
}
