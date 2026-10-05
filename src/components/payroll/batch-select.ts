/**
 * Talimat / liste penceresinin saf seçim mantığı (React'siz, testlenir).
 *
 * Ödeme 2 nakit mağaza mağaza dağıtılır (sahibi, 05.10.2026: "mağaza mağaza
 * kaydedebilirsem daha rahat olur, mağazayı ödediğimde tıklayayım"): pencere
 * satırları mağazaya göre gruplar, her mağaza kendi düğmesiyle ayrı kaydedilir.
 */
export type SelectRow = { line_id: string; store_name: string };

/** Seçili ve tutarı sıfırdan büyük satırlar; `store` verilirse yalnız o mağazanınkiler. */
export function selectedItems<T extends SelectRow>(
  rows: T[],
  checked: Record<string, boolean>,
  amounts: Record<string, number | undefined>,
  store?: string
): Array<{ line_id: string; amount: number }> {
  return rows
    .filter((r) => (store === undefined || r.store_name === store) && !!checked[r.line_id] && (amounts[r.line_id] ?? 0) > 0)
    .map((r) => ({ line_id: r.line_id, amount: amounts[r.line_id] as number }));
}

/**
 * Satırları mağaza sırasını koruyarak gruplar. Satırı kalmayan mağaza da
 * listede durur (penceredeki "ödendi" bilgisi için); sırada olmayan mağaza
 * sona eklenir.
 */
export function groupByStore<T extends SelectRow>(rows: T[], order: string[]): Array<{ store: string; rows: T[] }> {
  const by = new Map<string, T[]>();
  for (const r of rows) {
    const list = by.get(r.store_name);
    if (list) list.push(r);
    else by.set(r.store_name, [r]);
  }
  const names = [...order, ...Array.from(by.keys()).filter((s) => !order.includes(s))];
  return names.map((store) => ({ store, rows: by.get(store) ?? [] }));
}

/** Kuruşa yuvarlanmış toplam. */
export function sumAmounts(items: Array<{ amount: number }>): number {
  return Math.round(items.reduce((s, i) => s + i.amount, 0) * 100) / 100;
}
