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
  // Bound the search by the label order: everything before "Satış Toplam"
  // is opening balance (and Devir Bakiye Toplam = Devir Bakiye TRY + Devir
  // Bakiye EUR also "adds up" — it was picked once as the sales equation),
  // everything from "Kapanış Toplam" on is closing balance. ±1 for the
  // usual one-row drift between the lists.
  const iSales = normLabels.findIndex((l) => l.includes("satis toplam"));
  const iClose = normLabels.findIndex((l) => l.includes("kapanis toplam"));
  const lo = iSales >= 0 ? Math.max(0, iSales - 2) : 0;
  const hi = iClose >= 0 ? Math.min(amounts.length, iClose + 1) : amounts.length;
  const byEq = solveItPosByEquation(
    amounts.map((a, i) => (i >= lo && i < hi ? a : null)),
    iSales >= 0 ? iSales : null
  );
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
function solveItPosByEquation(
  amounts: (number | null)[],
  /** Index of the "Satış Toplam" label; the sales value must sit within two
   *  rows of it. Without this the closing block (Kapanış Toplam = Kapanış
   *  TRY + Kapanış EUR) satisfies the equation and was picked once. */
  salesLabelIndex: number | null
): {
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
    if (salesLabelIndex != null && Math.abs(v[s]!.i - salesLabelIndex) > 2) continue;
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

/**
 * Nebim (Derimod) "Mağaza Hareket Özeti" Ödemeler table, paired by index from
 * the column-by-column transcription. Derimod Lefkoşa 18.09.2026: a photo
 * taken at an angle lifted the Toplam column, the model read T.İş Bankası's
 * 46.895,14 as "Kredi Çeki", and cash + card + voucher still equalled the
 * sales total, so nothing caught it (card 56.091,59 instead of 102.986,73).
 * Summing here also removes the model's own arithmetic (19.09.2026: three
 * card rows added up to 84.640,00 instead of 84.641,00).
 *
 * A row is card when its type says "Kredi Kartı" or it names a bank; cash when
 * it says "Nakit"; voucher when it says "Kredi Çeki" with no bank. Any other
 * type → null (not guessed). The Toplam values must all be present and add up
 * to `salesTotal` within 1 TL — the report prints them exactly — and the
 * result must be plausible: no negative cash or card, and a Kredi Çeki net
 * no larger than max(5.000, 10 % of sales) (Jun–Aug 2026: at most 3.920). A
 * sum check alone does not see values moved between rows; measured once,
 * Derimod Girne 22.09.2026 came back as cash −20 / voucher 0 and once as
 * cash 0. So cash is also anchored to the balance lines when they were read:
 * "Yarına Devir" − "Önceki Günden Devir" is the day's cash (equal to the
 * cent on 18 of 19 stored Derimod summaries, 0,80 off on the other).
 * Otherwise null and the caller keeps the direct fields.
 *
 * Only the Toplam column is used: a Peşinat/İade transcription alongside it
 * was measured and was the sloppy part (the Kredi Çeki row's 7.486,50 moved
 * between rows in 3 of 6 reads, while Toplam was right in all 6).
 */
export function deriveNebimPayments(
  types: string[] | undefined,
  totals: (number | null)[] | undefined,
  salesTotal: number | null,
  balances?: { opening: number | null; closing: number | null }
): { cash_sales: number; credit_card_total: number; credit_voucher_total: number } | null {
  if (!types || !totals || salesTotal == null || types.length === 0) return null;
  if (totals.length !== types.length || totals.some((v) => v == null)) return null;
  const values = totals as number[];
  const kinds: Array<"cash" | "card" | "voucher"> = [];
  for (const t of types) {
    const [typePart, ...rest] = t.split("|");
    const type = norm(typePart ?? "");
    const bank = norm(rest.join(" "));
    if (bank.length > 1 || /kredi kart/.test(type)) kinds.push("card");
    else if (/nakit/.test(type)) kinds.push("cash");
    else if (/kredi cek/.test(type)) kinds.push("voucher");
    else return null;
  }
  const sum = (v: number[]) => v.reduce((a, b) => a + b, 0);
  if (Math.abs(sum(values) - salesTotal) > 1) return null;
  const pick = (k: (typeof kinds)[number]) =>
    Math.round(sum(values.filter((_, i) => kinds[i] === k)) * 100) / 100;
  const out = { cash_sales: pick("cash"), credit_card_total: pick("card"), credit_voucher_total: pick("voucher") };
  const plausible =
    out.cash_sales >= 0 &&
    out.credit_card_total >= 0 &&
    Math.abs(out.credit_voucher_total) <= Math.max(5000, Math.abs(salesTotal) * 0.1);
  if (!plausible) return null;
  if (balances?.opening != null && balances.closing != null) {
    if (Math.abs(balances.closing - balances.opening - out.cash_sales) > 1) return null;
  }
  return out;
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
    const r = await preprocessReceipt(opts.buffer, opts.mimeType, { kind: "document" });
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
  // Constrained decoders emit "" where the prompt says null; "" fails the
  // date regex and the upload would fail with a Zod issue list.
  for (const k of ["summary_date", "period_start", "period_end", "store_name_on_report", "store_code_on_report", "rejection_reason"] as const) {
    const v = (raw as Record<string, unknown>)[k];
    if (typeof v === "string" && v.trim() === "") (raw as Record<string, unknown>)[k] = null;
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
      const iSalesLabel =
        parsed.it_pos_labels?.map(norm).findIndex((l) => l.includes("satis toplam")) ?? -1;
      const solved = amounts
        ? solveItPosByEquation(amounts, iSalesLabel >= 0 ? iSalesLabel : null)
        : null;
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

  // Nebim: the index-paired Ödemeler columns decide whenever they add up —
  // the direct fields can balance and still be wrong (a card row read as
  // "Kredi Çeki").
  if (parsed.report_format === "nebim") {
    const rows = deriveNebimPayments(
      parsed.nebim_pay_types,
      parsed.nebim_pay_totals,
      parsed.sales_total,
      { opening: parsed.opening_balance, closing: parsed.closing_balance }
    );
    if (rows) {
      const differs =
        Math.abs((parsed.cash_sales ?? 0) - rows.cash_sales) > 0.005 ||
        Math.abs((parsed.credit_card_total ?? 0) - rows.credit_card_total) > 0.005 ||
        Math.abs((parsed.credit_voucher_total ?? 0) - rows.credit_voucher_total) > 0.005;
      if (differs) {
        Object.assign(raw as object, {
          nebim_rows_fix: {
            read: { cash: parsed.cash_sales, card: parsed.credit_card_total, voucher: parsed.credit_voucher_total },
            rows,
          },
        });
      }
      Object.assign(parsed, rows, { derived_from_rows: true });
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
    }, { timeout: 15_000 });
    return response.parsed_output?.amounts ?? null;
  } catch (e) {
    console.warn("[OCR] TRY column re-transcription failed", e);
    return null;
  }
}
