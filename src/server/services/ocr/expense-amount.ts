import { parsePrintedAmount, parseTurkishAmountWords } from "./amount-words";

/**
 * EL YAZISI FATURADA TUTAR (sahibi, 16.11.2026 — Derimod Lefkoşa'da 2.200 ₺'lik
 * terzi faturası 7.200 ₺ okundu).
 *
 * KKTC esnaf faturasında aynı tutar 2–3 yerde geçer: kalem satırı (TUTARI),
 * ARA TOPLAM ve G. TOPLAM; bazen bir de yazıyla. Tek okumaya güvenmek yerine
 * hepsi toplanır ve ÇOĞUNLUK kazanır — bir yerdeki kalem izi ya da 2↔7
 * karışması diğer ikisiyle yakalanır.
 *
 * Karar:
 *   1. Yazıyla tutar çözülüyorsa O kazanır (bağımsız kaynak).
 *   2. Yoksa rakam adayları arasında çoğunluk (en az 2 aynı) kazanır.
 *   3. Çoğunluk yoksa modelin `amount`'u kalır ama "gözden geçir" denir.
 */
export type ExpenseAmountInput = {
  amount: number | null;
  amount_raw?: string | null;
  amount_in_words?: string | null;
  line_total?: number | null;
  subtotal?: number | null;
  grand_total?: number | null;
  amount_ambiguous?: boolean | null;
};

export type ExpenseAmountResult = {
  amount: number | null;
  source: "model" | "words" | "majority";
  /** Tutar şüpheli: okumalar çelişiyor ya da model emin değil. */
  needs_review: boolean;
  note: string | null;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) => n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const near = (a: number, b: number) => Math.abs(a - b) <= 0.5;

export function reconcileExpenseAmount(input: ExpenseAmountInput): ExpenseAmountResult {
  const words = parseTurkishAmountWords(input.amount_in_words);
  const raw = parsePrintedAmount(input.amount_raw);
  const cands: Array<{ v: number; from: string }> = [];
  const add = (v: number | null | undefined, from: string) => {
    if (v != null && Number.isFinite(v) && v > 0) cands.push({ v: r2(v), from });
  };
  add(input.amount, "okunan tutar");
  add(input.line_total, "kalem satırı");
  add(input.subtotal, "ara toplam");
  add(input.grand_total, "genel toplam");
  add(raw, "yazılı hâli");

  // 1) Yazıyla tutar bağımsız kaynaktır.
  if (words != null && words > 0) {
    if (input.amount == null || !near(words, input.amount)) {
      return {
        amount: words,
        source: "words",
        needs_review: false,
        note: `Rakam ${input.amount == null ? "okunamadı" : fmt(input.amount)} ama yazıyla tutar ${fmt(words)} diyor; yazı esas alındı.`,
      };
    }
    return { amount: input.amount, source: "model", needs_review: false, note: null };
  }

  // 2) Belgedeki YERLER arasında oylama. Modelin kendi `amount`'ı oya KATILMAZ:
  //    o zaten bu yerlerden birinden türetilmiş bir SONUÇ, bağımsız kaynak değil.
  const places: Array<{ v: number; from: string }> = [];
  const addPlace = (v: number | null | undefined, from: string) => {
    if (v != null && Number.isFinite(v) && v > 0) places.push({ v: r2(v), from });
  };
  addPlace(input.line_total, "kalem satırı");
  addPlace(input.subtotal, "ara toplam");
  addPlace(input.grand_total, "genel toplam");

  const groups: Array<{ v: number; froms: string[] }> = [];
  for (const c of places) {
    const g = groups.find((x) => near(x.v, c.v));
    if (g) g.froms.push(c.from);
    else groups.push({ v: c.v, froms: [c.from] });
  }
  groups.sort((a, b) => b.froms.length - a.froms.length);
  const ambiguous = !!input.amount_ambiguous;
  const top = groups[0];
  const tie = groups.length > 1 && groups[1] && top!.froms.length === groups[1]!.froms.length;

  if (groups.length > 1 && !tie && top) {
    // Yerler çelişiyor ama bir çoğunluk var.
    const others = groups.slice(1);
    const note =
      `Belgede tutar birkaç yerde geçiyor: ${fmt(top.v)} (${top.froms.join(", ")}) ↔ ` +
      `${others.map((o) => `${fmt(o.v)} (${o.froms.join(", ")})`).join(", ")}. Çoğunluk esas alındı.`;
    if (input.amount == null || !near(top.v, input.amount)) {
      return { amount: top.v, source: "majority", needs_review: false, note };
    }
    return { amount: input.amount, source: "model", needs_review: false, note };
  }
  if (tie) {
    return {
      amount: input.amount,
      source: "model",
      needs_review: true,
      note:
        "Tutar okumaları çelişiyor: " +
        groups.map((g) => `${fmt(g.v)} (${g.froms.join(", ")})`).join(" ↔ ") +
        ". Doğru tutarı kontrol edin.",
    };
  }

  // Tek değer (ya da hiç): rakamın biçimi bozuksa yazılı hâliyle düzelt.
  if (raw != null && raw > 0 && input.amount != null && !near(raw, input.amount) && (!top || near(raw, top.v))) {
    return {
      amount: raw,
      source: "majority",
      needs_review: false,
      note: `Rakam ${fmt(input.amount)} okunmuştu; belgedeki yazılı hâli ${fmt(raw)} diyor.`,
    };
  }
  if (top && input.amount != null && !near(top.v, input.amount)) {
    return {
      amount: top.v,
      source: "majority",
      needs_review: false,
      note: `Belgedeki ${top.froms.join(", ")} ${fmt(top.v)} diyor; okunan ${fmt(input.amount)} yerine o alındı.`,
    };
  }
  // İki ayrı yer aynı rakamı veriyorsa el yazısı olsa da güvenilir; tek okuma
  // varsa ve model emin değilse gözden geçirilsin.
  const agree = (top?.froms.length ?? 0) >= 2;
  return {
    amount: input.amount ?? top?.v ?? null,
    source: "model",
    needs_review: ambiguous && !agree,
    note:
      ambiguous && !agree
        ? "Model el yazısı rakamdan emin değil ve tutar belgede tek yerde geçiyor — kontrol edin."
        : null,
  };
}
