/**
 * One display name per bank for the analytics tables. Slips print the same
 * bank many ways and the reading keeps them as printed: "Türkiye İş
 * Bankası", "T. İş Bankası A.Ş.", "İş Bankası" and "T. İş Bankası" were four
 * rows in the commission table (owner, 28.09.2026 — they are one bank).
 *
 * "CardPlus / …" names are kept as read: CardPlus is a card programme, and
 * which bank's POS they settle through is not known.
 */
export function canonicalBankName(raw: string | null | undefined): string {
  const name = (raw ?? "").trim();
  if (!name) return "Bilinmeyen";
  const s = name.toLocaleLowerCase("tr");
  if (/cardplus|card plus/.test(s)) return name;
  if (/i[sş]\s*bank/.test(s)) return "İş Bankası";
  if (/yap[ıi]/.test(s)) return "Yapı Kredi";
  if (/koop/.test(s)) return "Koopbank";
  if (/garanti/.test(s)) return "Garanti BBVA";
  if (/ziraat/.test(s)) return "Ziraat Bankası";
  if (/albank/.test(s)) return "Albank";
  if (/nova/.test(s)) return "Nova Bank";
  return name;
}
