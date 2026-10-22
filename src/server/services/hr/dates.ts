/** Takvim günü yardımcıları — hepsi "YYYY-MM-DD" metni, saat dilimi yok (UTC). */

const DAY_MS = 86_400_000;
const ms = (iso: string) => Date.parse(`${iso}T00:00:00.000Z`);

export const addDays = (iso: string, days: number) => new Date(ms(iso) + days * DAY_MS).toISOString().slice(0, 10);
/** b − a, gün olarak */
export const daysBetween = (a: string, b: string) => Math.round((ms(b) - ms(a)) / DAY_MS);
/** 0 = pazar … 6 = cumartesi */
export const weekday = (iso: string) => new Date(ms(iso)).getUTCDay();
export const isSunday = (iso: string) => weekday(iso) === 0;
export const monthOf = (iso: string) => iso.slice(0, 7);
export const monthEnd = (iso: string) => {
  const [y, m] = iso.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
export const isIsoDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(ms(s)) && new Date(ms(s)).toISOString().startsWith(s);
