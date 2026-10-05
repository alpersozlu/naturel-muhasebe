/** Bordro ekranlarının ortak biçimleri ve etiketleri (istemci tarafı). */

const TRY2 = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Kuruş her yerde yazılır (sahibi, 02.10.2026) — "cents: false" artık yalnız geriye uyumluluk.
const TRY0 = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const PCT1 = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function money(v: number | null | undefined, opts?: { zero?: string; cents?: boolean }): string {
  if (v == null) return "—";
  if (Math.abs(v) < 0.005 && opts?.zero !== undefined) return opts.zero;
  return opts?.cents === false ? TRY0.format(v) : TRY2.format(v);
}

export function moneyTL(v: number | null | undefined): string {
  return v == null ? "—" : `${TRY2.format(v)} ₺`;
}

/** Saat: 2 → "2", 21.5 → "21,5" */
export function hoursTr(v: number | null | undefined): string {
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(v ?? 0);
}

export function pct(ratio: number | null | undefined): string {
  return ratio == null ? "—" : `%${PCT1.format(ratio * 100)}`;
}

export function rate(r: number | null | undefined): string {
  if (r == null) return "—";
  return `%${new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(r * 100)}`;
}

/** "2026-09-16" → "16.09.2026" */
export function dmy(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
}

export function todayIso(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export const KIND_LABEL: Record<"advance" | "payment" | "deduction" | "addition", string> = {
  advance: "Avans",
  payment: "Ödeme",
  deduction: "Kesinti",
  addition: "Ek hak ediş",
};

/** "Eylül 2026" ayının ardından gelen ay — "Sonraki aya devret" metinleri için. */
export function nextMonthOf(year: number, month: number): { year: number; month: number } {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

export const KIND_TONE: Record<"advance" | "payment" | "deduction" | "addition", string> = {
  advance: "bg-amber-50 text-amber-800 ring-amber-200/70",
  payment: "bg-emerald-50 text-emerald-800 ring-emerald-200/70",
  deduction: "bg-rose-50 text-rose-800 ring-rose-200/70",
  addition: "bg-sky-50 text-sky-800 ring-sky-200/70",
};

export const BATCH_KIND_LABEL: Record<"advance" | "payment1" | "payment2" | "single", string> = {
  advance: "Avans talimatı",
  payment1: "Ödeme 1 — baz maaş",
  payment2: "Ödeme 2 — mesai + komisyon + prim",
  single: "Tekil ödeme",
};

export const BATCH_STATUS_LABEL: Record<"prepared" | "sent" | "void", string> = {
  prepared: "Hazırlandı",
  sent: "Gönderildi",
  void: "İptal",
};

export const CHANNEL_SHORT: Record<"garanti" | "ziraat" | "cash" | "other", string> = {
  garanti: "Garanti",
  ziraat: "Ziraat",
  cash: "Nakit",
  other: "Diğer",
};

export const STATUS_LABEL: Record<"active" | "inactive" | "left", string> = {
  active: "Aktif",
  inactive: "Pasif",
  left: "Ayrıldı",
};

export function triggerDownload(base64: string, filename: string): void {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
