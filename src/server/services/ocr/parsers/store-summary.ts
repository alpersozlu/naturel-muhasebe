import "server-only";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { getAnthropic, OCR_MODEL } from "@/lib/anthropic";
import { preprocessReceipt } from "../preprocess";
import {
  storeSummaryOcrSchema,
  storeSummaryOutputSchema,
  type StoreSummaryOcr,
} from "../schemas/store-summary";
import {
  STORE_SUMMARY_SYSTEM_PROMPT,
  STORE_SUMMARY_USER_PROMPT,
} from "../prompts/store-summary";

const norm = (s: string) =>
  s
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * IT POS (Mavi) "Günlük Kasa Raporu": the TRY column is printed one row
 * above the label column, so a reading "by the label next to the number"
 * shifts every field down a row (24.08: a ₺24M closing balance became
 * "kartuş puan"; 31.08: the returns row became "satış toplam"). The model
 * is therefore asked to transcribe the two columns as separate lists and
 * the pairing is done here, by index — immune to the visual offset.
 *
 * Returns the fields only when the lists line up AND the payments equation
 * holds on the paired values; otherwise null and the caller keeps what the
 * model wrote in the direct fields (which the ingest checks reject if
 * inconsistent). Never trusts the pairing on its own.
 */
export function deriveItPosFields(
  labels: string[] | undefined,
  amounts: (number | null)[] | undefined
): Pick<
  StoreSummaryOcr,
  | "sales_total"
  | "cash_sales"
  | "credit_card_total"
  | "loyalty_points_total"
  | "shopping_voucher_total"
  | "wire_transfer_total"
  | "opening_balance"
  | "closing_balance"
> | null {
  if (!labels || !amounts || labels.length < 4 || amounts.length < 4) return null;
  const normLabels = labels.map(norm);

  // The two lists usually line up 1:1, but the model sometimes drops or
  // duplicates the first amount (the bold header-adjacent one); try the
  // neighbouring offsets too. Only a pairing whose payments add up to the
  // sales total is accepted — the equation is the arbiter, not the index.
  for (const offset of [0, -1, 1]) {
    const find = (...needles: string[]): number | null => {
      for (const n of needles) {
        const i = normLabels.findIndex((l) => l.includes(n));
        if (i < 0) continue;
        const a = amounts[i + offset];
        if (a != null) return a;
      }
      return null;
    };
    const sales = find("satis toplam");
    const cash = find("nakit toplam");
    const card = find("kredi karti toplam");
    const loyalty = find("kartus puan toplam", "kartus puan");
    const voucher = find("alisveris ceki toplam", "alisveris ceki");
    const wire = find("havale toplam", "havale", "banka transferi");
    const opening = find("devir bakiye toplam");
    const closing = find("kapanis toplam");
    if (sales == null || cash == null || card == null) continue;

    const sum = cash + card + (loyalty ?? 0) + (voucher ?? 0);
    if (Math.abs(sum - sales) > Math.max(1, sales * 0.01)) continue;
    if (cash < 0 || card < 0 || sales <= 0) continue;

    return {
      sales_total: sales,
      cash_sales: cash,
      credit_card_total: card,
      loyalty_points_total: loyalty,
      shopping_voucher_total: voucher,
      wire_transfer_total: wire,
      opening_balance: opening,
      closing_balance: closing,
    };
  }

  // Lists out of step in the middle (a skipped row): fall back to the
  // amounts alone. The report's row order is fixed — Satış Toplam, Nakit
  // Toplam, Kredi Kartı Toplam, [Alışveriş Çeki], [Kartuş Puan] — so look
  // for values in that order that add up to the kuruş.
  const byEq = solveItPosByEquation(amounts);
  if (!byEq) return null;
  const aligned = labels.length === amounts.length;
  const at = (needle: string): number | null => {
    if (!aligned) return null;
    const i = normLabels.findIndex((l) => l.includes(needle));
    return i >= 0 ? (amounts[i] ?? null) : null;
  };
  return {
    ...byEq,
    wire_transfer_total: null,
    opening_balance: at("devir bakiye toplam"),
    closing_balance: at("kapanis toplam"),
  };
}

/**
 * Find sales, cash, card and optionally voucher/loyalty among the TRY
 * amounts using only their order and the payments equation. Exact to
 * ±0.05: the model transcribes printed values, so a real match is to the
 * kuruş and a coincidence among a dozen unrelated amounts is negligible.
 * Ambiguous (two different solutions) → null.
 */
function solveItPosByEquation(amounts: (number | null)[]): {
  sales_total: number;
  cash_sales: number;
  credit_card_total: number;
  shopping_voucher_total: number | null;
  loyalty_points_total: number | null;
} | null {
  const v = amounts.map((a, i) => ({ a, i })).filter((x): x is { a: number; i: number } => x.a != null);
  const eq = (x: number, y: number) => Math.abs(x - y) <= 0.05;
  const found: Array<ReturnType<typeof solveItPosByEquation>> = [];
  for (let s = 0; s < v.length; s++) {
    const S = v[s]!.a;
    if (S <= 0) continue;
    for (let c = s + 1; c < v.length; c++) {
      const C = v[c]!.a;
      if (C < 0) continue;
      for (let k = c + 1; k < v.length; k++) {
        const K = v[k]!.a;
        if (K < 0) continue;
        if (eq(C + K, S)) found.push({ sales_total: S, cash_sales: C, credit_card_total: K, shopping_voucher_total: null, loyalty_points_total: null });
        for (let x = k + 1; x < v.length; x++) {
          const X = v[x]!.a;
          if (X < 0) continue;
          // one extra component: voucher or loyalty (which one is unknowable
          // from the sum alone; loyalty is the common case on Mavi reports)
          if (eq(C + K + X, S)) found.push({ sales_total: S, cash_sales: C, credit_card_total: K, shopping_voucher_total: null, loyalty_points_total: X });
          for (let y = x + 1; y < v.length; y++) {
            const Y = v[y]!.a;
            if (Y < 0) continue;
            if (eq(C + K + X + Y, S)) found.push({ sales_total: S, cash_sales: C, credit_card_total: K, shopping_voucher_total: X, loyalty_points_total: Y });
          }
        }
      }
    }
  }
  if (found.length === 0) return null;
  const first = found[0]!;
  const same = found.every(
    (f) =>
      f!.sales_total === first!.sales_total &&
      f!.cash_sales === first!.cash_sales &&
      f!.credit_card_total === first!.credit_card_total
  );
  return same ? first : null;
}

function equationHolds(p: StoreSummaryOcr): boolean {
  if (p.sales_total == null || p.cash_sales == null || p.credit_card_total == null) return false;
  const sum =
    p.cash_sales +
    p.credit_card_total +
    (p.loyalty_points_total ?? 0) +
    (p.shopping_voucher_total ?? 0);
  return Math.abs(sum - p.sales_total) <= Math.max(1, p.sales_total * 0.01);
}

export async function parseStoreSummary(opts: {
  buffer: Buffer;
  mimeType: string;
}): Promise<{ raw: unknown; parsed: StoreSummaryOcr; rawText: string; tiles: number }> {
  const isPdf = opts.mimeType === "application/pdf";

  // Same paper crop / quarter-turn / tiling as the slips: an A4 report on a
  // desk is a fraction of the frame, and the orientation check only fires
  // for papers wider than tall (a landscape A4 page answers "upright").
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
  content.push({ type: "text", text: STORE_SUMMARY_USER_PROMPT });

  const client = getAnthropic();
  // Structured output: the decoder is constrained to `storeSummaryOutputSchema`,
  // so the model cannot narrate its steps in prose first. Measured before this
  // change: ~30 s and ~950 output tokens per store summary, occasionally
  // overrunning max_tokens with no JSON at all. See the schema comment.
  const response = await client.messages.parse({
    model: OCR_MODEL,
    max_tokens: 2048,
    system: STORE_SUMMARY_SYSTEM_PROMPT,
    messages: [{ role: "user", content }],
    output_config: { format: zodOutputFormat(storeSummaryOutputSchema) },
  });

  const rawText = response.content
    .filter((c) => c.type === "text")
    .map((c) => (c as { type: "text"; text: string }).text)
    .join("\n");

  const raw = response.parsed_output;
  if (!raw) {
    throw new Error(`Claude returned non-JSON output: ${rawText.slice(0, 200)}`);
  }
  // Strict re-validation (date regex, currency default); `raw` keeps
  // check_notes for raw_ocr_json.
  const parsed = storeSummaryOcrSchema.parse(raw);

  // IT POS: prefer the index-paired columns whenever the model's direct
  // fields do not balance — that is exactly the row-shift symptom.
  if (parsed.report_format === "it_pos" && !equationHolds(parsed)) {
    let derived = deriveItPosFields(parsed.it_pos_labels, parsed.it_pos_amounts);
    if (!derived && !isPdf) {
      // The transcription itself dropped a row (measured 1 in 4: the two
      // Nakit values vanished from the list). A second, narrower call that
      // only copies the TRY column is ~10 s and usually complete; the
      // equation still decides.
      const amounts = await retranscribeTryColumn(
        client,
        content.filter((c) => c.type === "image"),
        parsed.it_pos_labels?.length ?? 0
      );
      const solved = amounts ? solveItPosByEquation(amounts) : null;
      if (solved) {
        derived = { ...solved, wire_transfer_total: null, opening_balance: null, closing_balance: null };
        Object.assign(raw as object, { retried_amounts: amounts });
      }
    }
    if (derived) {
      Object.assign(parsed, derived, { derived_from_rows: true });
      Object.assign(raw as object, { derived_from_rows: true });
    }
  }
  return { raw, parsed, rawText, tiles: tileCount };
}

const tryColumnSchema = z.object({ amounts: z.array(z.number().nullable()) });

/** Second pass: copy only the TRY TUTAR column, top to bottom. */
async function retranscribeTryColumn(
  client: ReturnType<typeof getAnthropic>,
  images: unknown[],
  expectedRows: number
): Promise<(number | null)[] | null> {
  try {
    const hint =
      expectedRows > 0
        ? ` Etiket sütununda ${expectedRows} satır var; tutar listesi de ${expectedRows} eleman olmalı (boş hücre → null).`
        : "";
    const response = await client.messages.parse({
      model: OCR_MODEL,
      max_tokens: 512,
      messages: [
        {
          role: "user",
          content: [
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ...(images as any[]),
            {
              type: "text",
              text:
                "Bu IT POS 'Günlük Kasa Raporu'nda SADECE en sağdaki 'TRY TUTAR' sütununu " +
                "yukarıdan aşağıya, başlık hücresi hariç, HİÇBİR SATIRI ATLAMADAN yaz. " +
                "DÖVİZ TUTAR sütununu yok say. Sonunda '-' olan tutar negatiftir " +
                "(\"21.099,84-\" → -21099.84). Türkçe biçimi sayıya çevir (1.234,56 → 1234.56)." +
                hint,
            },
          ],
        },
      ],
      output_config: { format: zodOutputFormat(tryColumnSchema) },
    });
    return response.parsed_output?.amounts ?? null;
  } catch (e) {
    console.warn("[OCR] TRY column re-transcription failed", e);
    return null;
  }
}
