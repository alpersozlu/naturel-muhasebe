/**
 * Kişi satırının ekrandaki taslağı — kişi paneli ve "Ciro ve hedefler"
 * penceresi aynı taslağı kullanır. Hesap, sunucudaki motorun aynısıyla
 * (compute.ts) yazarken yapılır; "Kaydet" yalnız DEĞİŞEN alanları gönderir
 * (gönderilmeyen alan sunucuda olduğu gibi kalır — zod-schemas/payroll.ts).
 */
import type { ComputedLine } from "@/server/services/payroll/period";
import type { LineInput } from "@/server/services/payroll/compute";
import { dayPaidBase } from "@/server/services/payroll/rules";

export type LineDraft = {
  base_salary: number | undefined;
  overtime_hours: string;
  /** Kısmi ayda çalışılan gün; günle ödenen personelde ayın gün sayısı */
  worked_days: string;
  overtime_note: string;
  own_revenue_nd: number | undefined;
  own_revenue_denim: number | undefined;
  own_revenue: number | undefined;
  own_target: number | undefined;
  /** Yüzde metni: "100" */
  achievement_accepted: string;
  commission_override: number | undefined;
  commission_note: string;
  perfume_units: string;
  garment_units: string;
  top_seller: boolean;
  extra_premium: number | undefined;
  extra_premium_note: string;
  note: string;
};

export const numOf = (s: string): number => (s.trim() === "" ? 0 : Number(s.replace(",", ".")) || 0);

export function draftFromLine(l: ComputedLine): LineDraft {
  return {
    base_salary: l.base_salary,
    overtime_hours: l.overtime_hours ? String(l.overtime_hours) : "",
    worked_days: l.worked_days != null ? String(l.worked_days) : "",
    overtime_note: l.overtime_note ?? "",
    own_revenue_nd: l.own_revenue_nd ?? undefined,
    own_revenue_denim: l.own_revenue_denim ?? undefined,
    own_revenue: l.own_revenue ?? undefined,
    own_target: l.own_target ?? undefined,
    achievement_accepted: l.achievement_accepted != null ? String(Math.round(l.achievement_accepted * 10000) / 100) : "",
    commission_override: l.commission_override ?? undefined,
    commission_note: l.commission_note ?? "",
    perfume_units: l.perfume_units ? String(l.perfume_units) : "",
    garment_units: l.garment_units ? String(l.garment_units) : "",
    top_seller: l.top_seller,
    extra_premium: l.extra_premium || undefined,
    extra_premium_note: l.extra_premium_note ?? "",
    note: l.note ?? "",
  };
}

export const sameDraft = (a: LineDraft, b: LineDraft): boolean => JSON.stringify(a) === JSON.stringify(b);

const daysChanged = (l: ComputedLine, d: LineDraft) => d.worked_days.trim() !== draftFromLine(l).worked_days.trim();

/** Günle ödenenin gün ücreti (sunucudaki hesapla aynı) — maaş değil, Ödeme 2'de mesai gibi. */
export function dayPayOf(l: ComputedLine, d: LineDraft): number {
  return l.paid_by_day && d.worked_days.trim() !== "" ? dayPaidBase(l.card_base_salary, numOf(d.worked_days)) : 0;
}

/**
 * O ayki baz maaş. Gün değiştiyse sunucunun yapacağı hesabın aynısı (gün ×
 * kart bazı ÷ 26; gün silinince tam kart bazı; günle ödenende 0). Gün
 * değişmediyse taslaktaki baz (elle düzeltilebilir).
 */
export function draftBase(l: ComputedLine, d: LineDraft): number {
  if (daysChanged(l, d)) {
    const filled = d.worked_days.trim() !== "";
    if (l.paid_by_day) return filled ? 0 : l.base_salary;
    return filled ? dayPaidBase(l.card_base_salary, numOf(d.worked_days)) : l.card_base_salary;
  }
  return d.base_salary ?? 0;
}

const acceptedOf = (d: LineDraft): number | null => {
  const t = d.achievement_accepted.trim();
  return t === "" ? null : numOf(t) / 100;
};

export function draftToInput(l: ComputedLine, d: LineDraft): LineInput {
  return {
    base_salary: draftBase(l, d),
    day_pay: dayPayOf(l, d),
    commission_profile: l.commission_profile,
    overtime_hours: numOf(d.overtime_hours),
    own_revenue_nd: d.own_revenue_nd ?? null,
    own_revenue_denim: d.own_revenue_denim ?? null,
    own_revenue: d.own_revenue ?? null,
    own_target: d.own_target ?? null,
    achievement_accepted: acceptedOf(d),
    commission_override: d.commission_override ?? null,
    commission_note: d.commission_note || null,
    perfume_units: Math.round(numOf(d.perfume_units)),
    garment_units: Math.round(numOf(d.garment_units)),
    top_seller: d.top_seller,
    extra_premium: d.extra_premium ?? 0,
    extra_premium_note: d.extra_premium_note || null,
    paid_month_early: l.paid_month_early,
    status: l.employee_status,
  };
}

/** Sunucuya gidecek istek: yalnız değişen alanlar (kimlik hep var). */
export function draftPayload(l: ComputedLine, d: LineDraft) {
  const o = draftFromLine(l);
  const p = l.commission_profile;
  const asistan = p === "mavi_asistan" || p === "deri_asistan";
  const days = daysChanged(l, d);
  return {
    id: l.id,
    // Gün değiştiyse bazı sunucu kurar; ikisi birden gönderilmez.
    worked_days: days ? (d.worked_days.trim() === "" ? null : numOf(d.worked_days)) : undefined,
    base_salary: !days && (d.base_salary ?? 0) !== (o.base_salary ?? 0) ? (d.base_salary ?? 0) : undefined,
    overtime_hours: d.overtime_hours !== o.overtime_hours ? numOf(d.overtime_hours) : undefined,
    overtime_note: d.overtime_note !== o.overtime_note ? d.overtime_note : undefined,
    own_revenue_nd: p === "mavi_asistan" && d.own_revenue_nd !== o.own_revenue_nd ? (d.own_revenue_nd ?? null) : undefined,
    own_revenue_denim: p === "mavi_asistan" && d.own_revenue_denim !== o.own_revenue_denim ? (d.own_revenue_denim ?? null) : undefined,
    own_revenue: p === "deri_asistan" && d.own_revenue !== o.own_revenue ? (d.own_revenue ?? null) : undefined,
    own_target: asistan && d.own_target !== o.own_target ? (d.own_target ?? null) : undefined,
    achievement_accepted: d.achievement_accepted !== o.achievement_accepted ? acceptedOf(d) : undefined,
    commission_override: d.commission_override !== o.commission_override ? (d.commission_override ?? null) : undefined,
    commission_note: d.commission_note !== o.commission_note ? d.commission_note : undefined,
    perfume_units: d.perfume_units !== o.perfume_units ? Math.round(numOf(d.perfume_units)) : undefined,
    garment_units: d.garment_units !== o.garment_units ? Math.round(numOf(d.garment_units)) : undefined,
    top_seller: d.top_seller !== o.top_seller ? d.top_seller : undefined,
    extra_premium: d.extra_premium !== o.extra_premium ? (d.extra_premium ?? 0) : undefined,
    extra_premium_note: d.extra_premium_note !== o.extra_premium_note ? d.extra_premium_note : undefined,
    note: d.note !== o.note ? d.note : undefined,
  };
}
