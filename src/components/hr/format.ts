/** Naturel İK ekranları — tarih / sayı yazımı (personel için sade Türkçe). */

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("tr-TR", { timeZone: "UTC", ...opts });
const at = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** "18 Ekim Pazar" */
export const dayLong = (iso: string) => fmt({ day: "numeric", month: "long", weekday: "long" }).format(at(iso));
/** "18 Eki" */
export const dayShort = (iso: string) => fmt({ day: "numeric", month: "short" }).format(at(iso));
/** "15.03.2026" */
export const dateNum = (iso: string) => fmt({ day: "2-digit", month: "2-digit", year: "numeric" }).format(at(iso));
/** "18 Ekim" */
export const dayMonth = (iso: string) => fmt({ day: "numeric", month: "long" }).format(at(iso));

export function range(start: string, end: string): string {
  return start === end ? dayLong(start) : `${dayMonth(start)} – ${dayMonth(end)}`;
}

/** 1,5 · 7 · 0,5 — gün ve saat sayıları */
export const num = (n: number) => n.toLocaleString("tr-TR", { maximumFractionDigits: 2 });

export const hours = (minutes: number) => `${num(minutes / 60)} saat`;

export const addDays = (iso: string, d: number) => new Date(at(iso).getTime() + d * 86_400_000).toISOString().slice(0, 10);
export const isSunday = (iso: string) => at(iso).getUTCDay() === 0;

/** Kalan gün yazısı: "bugün son gün", "3 gün kaldı", "2 gün geçti" */
export function daysLeftText(daysLeft: number): string {
  if (daysLeft === 0) return "bugün son gün";
  if (daysLeft > 0) return `${daysLeft} gün kaldı`;
  return `${-daysLeft} gün geçti`;
}

export const STATUS_TEXT = {
  waiting: { label: "Onay bekliyor", cls: "bg-amber-100 text-amber-800" },
  approved: { label: "Onaylandı", cls: "bg-emerald-100 text-emerald-800" },
  rejected: { label: "Reddedildi", cls: "bg-red-100 text-red-700" },
  cancelled: { label: "Geri çekildi", cls: "bg-slate-100 text-slate-600" },
} as const;

/** Hak günü rengi (credits.ts `tone`) */
export const TONE_CLS = {
  green: "bg-emerald-50 border-emerald-200 text-emerald-900",
  neutral: "bg-white border-slate-200 text-slate-900",
  yellow: "bg-amber-50 border-amber-300 text-amber-900",
  amber: "bg-orange-50 border-orange-300 text-orange-900",
  red: "bg-red-50 border-red-300 text-red-900",
} as const;
