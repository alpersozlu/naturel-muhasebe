/**
 * One display name per bank for the analytics tables. Slips print the same
 * bank many ways and the reading keeps them as printed: "Türkiye İş
 * Bankası", "T. İş Bankası A.Ş.", "İş Bankası" and "T. İş Bankası" were four
 * rows in the commission table (owner, 28.09.2026 — they are one bank).
 *
 * CardPlus is a card network shared by several banks, not a bank: slips read
 * as "CardPlus", "Cardplus", "CardPlus / Nova Bank", "Cardplus Nova Bank" are
 * one row (owner, 30.10.2026 — Gelir Analizi showed three). The bank it
 * settled through, when printed, is kept by `cardplusVia` for the detail line.
 */
export const CARDPLUS = "CardPlus";

const isCardplus = (s: string) => /card\s*plus/.test(s);

export function canonicalBankName(raw: string | null | undefined): string {
  const name = (raw ?? "").trim();
  if (!name) return "Bilinmeyen";
  // Büyük harfle basılan fiş: "ZIRAAT" Türkçe küçültmede "zıraat" olur — ı'yı i'ye katla.
  const s = name.toLocaleLowerCase("tr").replace(/ı/g, "i");
  if (isCardplus(s)) return CARDPLUS;
  if (/i[sş]\s*bank/.test(s)) return "İş Bankası";
  if (/yap[ıi]/.test(s)) return "Yapı Kredi";
  if (/koop/.test(s)) return "Koopbank";
  if (/garanti/.test(s)) return "Garanti BBVA";
  if (/ziraat/.test(s)) return "Ziraat Bankası";
  if (/albank/.test(s)) return "Albank";
  if (/nova/.test(s)) return "Nova Bank";
  return name;
}

/** "CardPlus / Nova Bank" → "Nova Bank"; plain "CardPlus" or another bank → null. */
export function cardplusVia(raw: string | null | undefined): string | null {
  const name = (raw ?? "").trim();
  if (!isCardplus(name.toLocaleLowerCase("tr"))) return null;
  const rest = name.replace(/card\s*plus/i, "").replace(/^[\s/\-–·,]+/, "").trim();
  return rest ? canonicalBankName(rest) : null;
}
