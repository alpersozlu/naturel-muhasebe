import { annualLeaveEarned } from "./accrual";
import { addDays, daysBetween } from "./dates";
import { LEAVE_DAY_DIVISOR } from "@/server/services/payroll/rules";

/**
 * KİŞİ BİLGİLERİ — alan tanımları, kim neyi görür / düzeltir, eksik bilgi,
 * uyarılar ve çıkış ön hesabı. Saf; ağ ve veritabanı yok.
 *
 * Kolay İK'da (sahibinin videosu, 22.10.2026) bilgiler 7 sekmeye dağılmış,
 * boş alanlar "—" ile duruyor, kimin neyi gördüğü ayrımı yok. Burada:
 *   • tek kart, bölüm bölüm; eksik bilgi yüzdesi ve listesi,
 *   • görünürlük: kimlik / adres / banka / belge YALNIZ sahibine (ve kişinin
 *     kendisine); müdür iş + iletişim + acil durum görür,
 *   • personel kendi iletişim / adres / acil durum bilgisini kendisi düzeltir,
 *   • çalışma izni / pasaport / sözleşme bitişi ve doğum günü uyarıları.
 */

export type Viewer = "admin" | "manager" | "self";
export type FieldType = "text" | "date" | "email" | "phone";

export type ProfileField = {
  key: ProfileKey;
  label: string;
  type: FieldType;
  /** "store" = müdür de görür; "admin" = yalnız sahibi (ve kişinin kendisi) */
  vis: "store" | "admin";
  /** Kişi kendi bilgisini düzeltebilir mi */
  selfEdit: boolean;
};

export type ProfileKey =
  | "national_id"
  | "birth_date"
  | "nationality"
  | "gender"
  | "education_status"
  | "education_level"
  | "school"
  | "disability"
  | "work_email"
  | "personal_email"
  | "work_phone"
  | "personal_phone"
  | "address"
  | "city"
  | "country"
  | "postal_code"
  | "emergency_name"
  | "emergency_relation"
  | "emergency_phone"
  | "contract_type"
  | "contract_end"
  | "workweek_plan"
  | "work_permit_no"
  | "work_permit_expiry"
  | "passport_no"
  | "passport_expiry";

const f = (key: ProfileKey, label: string, type: FieldType, vis: "store" | "admin", selfEdit = false): ProfileField => ({ key, label, type, vis, selfEdit });

export const PROFILE_SECTIONS: ReadonlyArray<{ key: string; title: string; fields: ProfileField[] }> = [
  {
    key: "work",
    title: "İş",
    fields: [f("workweek_plan", "Çalışma düzeni", "text", "store"), f("contract_type", "Sözleşme türü", "text", "admin"), f("contract_end", "Sözleşme bitişi", "date", "admin")],
  },
  {
    key: "contact",
    title: "İletişim",
    fields: [
      f("personal_phone", "Cep telefonu", "phone", "store", true),
      f("work_phone", "İş telefonu", "phone", "store"),
      f("personal_email", "Kişisel e-posta", "email", "store", true),
      f("work_email", "İş e-postası", "email", "store"),
    ],
  },
  {
    key: "emergency",
    title: "Acil durumda aranacak kişi",
    fields: [f("emergency_name", "Adı soyadı", "text", "store", true), f("emergency_relation", "Yakınlığı", "text", "store", true), f("emergency_phone", "Telefonu", "phone", "store", true)],
  },
  {
    key: "personal",
    title: "Kişisel",
    fields: [
      f("national_id", "Kimlik no", "text", "admin"),
      f("birth_date", "Doğum tarihi", "date", "admin"),
      f("nationality", "Uyruk", "text", "admin"),
      f("gender", "Cinsiyet", "text", "admin"),
      f("education_status", "Eğitim durumu", "text", "admin"),
      f("education_level", "En son bitirdiği okul türü", "text", "admin"),
      f("school", "Okul", "text", "admin"),
      f("disability", "Engel durumu", "text", "admin"),
    ],
  },
  {
    key: "address",
    title: "Adres",
    fields: [f("address", "Adres", "text", "admin", true), f("city", "Şehir", "text", "admin", true), f("country", "Ülke", "text", "admin", true), f("postal_code", "Posta kodu", "text", "admin", true)],
  },
  {
    key: "documents",
    title: "Çalışma izni ve pasaport",
    fields: [
      f("work_permit_no", "Çalışma izni no", "text", "admin"),
      f("work_permit_expiry", "Çalışma izni bitişi", "date", "admin"),
      f("passport_no", "Pasaport no", "text", "admin"),
      f("passport_expiry", "Pasaport bitişi", "date", "admin"),
    ],
  },
];

export const PROFILE_FIELDS: ReadonlyArray<ProfileField> = PROFILE_SECTIONS.flatMap((s) => s.fields);
export const DATE_KEYS = new Set<ProfileKey>(PROFILE_FIELDS.filter((x) => x.type === "date").map((x) => x.key));

export function canSee(field: ProfileField, viewer: Viewer): boolean {
  return viewer !== "manager" || field.vis === "store";
}
export function canEdit(field: ProfileField, viewer: Viewer): boolean {
  return viewer === "admin" || (viewer === "self" && field.selfEdit);
}

export type ProfileValues = Partial<Record<ProfileKey, string | null>>;

/** Gelen düzeltmeden yalnız bu kişinin düzeltebileceği alanlar kalır; boş metin = sil. */
export function allowedUpdate(values: ProfileValues, viewer: Viewer): ProfileValues {
  const out: ProfileValues = {};
  for (const field of PROFILE_FIELDS) {
    if (!(field.key in values) || !canEdit(field, viewer)) continue;
    const v = values[field.key]?.trim() ?? "";
    out[field.key] = v === "" ? null : v;
  }
  return out;
}

/** Bordro ve acil durum için gerekli olanlar — eksik yüzdesi bunlardan. */
const REQUIRED: Array<{ key: ProfileKey | "iban" | "hire_date"; label: string }> = [
  { key: "hire_date", label: "İşe giriş tarihi" },
  { key: "national_id", label: "Kimlik no" },
  { key: "birth_date", label: "Doğum tarihi" },
  { key: "personal_phone", label: "Cep telefonu" },
  { key: "address", label: "Adres" },
  { key: "emergency_name", label: "Acil durum kişisi" },
  { key: "emergency_phone", label: "Acil durum telefonu" },
  { key: "iban", label: "Banka hesabı" },
];

export function completeness(values: ProfileValues, extra: { hireDate: string | null; hasBank: boolean }) {
  const has = (k: (typeof REQUIRED)[number]["key"]) => (k === "iban" ? extra.hasBank : k === "hire_date" ? !!extra.hireDate : !!values[k]);
  const missing = REQUIRED.filter((r) => !has(r.key)).map((r) => r.label);
  return { percent: Math.round(((REQUIRED.length - missing.length) / REQUIRED.length) * 100), missing };
}

export type ProfileAlert = { tone: "red" | "yellow" | "info"; text: string };

/** Belge bitişi, sözleşme bitişi, doğum günü. */
export function profileAlerts(values: ProfileValues, today: string): ProfileAlert[] {
  const out: ProfileAlert[] = [];
  const doc = (key: ProfileKey, label: string, warnDays: number) => {
    const d = values[key];
    if (!d) return;
    const left = daysBetween(today, d);
    if (left < 0) out.push({ tone: "red", text: `${label} ${-left} gün önce bitti` });
    else if (left <= warnDays) out.push({ tone: left <= 15 ? "red" : "yellow", text: `${label} ${left} gün sonra bitiyor` });
  };
  doc("work_permit_expiry", "Çalışma izni", 60);
  doc("passport_expiry", "Pasaport", 90);
  doc("contract_end", "Sözleşme", 30);
  const b = values.birth_date;
  if (b) {
    for (const y of [Number(today.slice(0, 4)), Number(today.slice(0, 4)) + 1]) {
      const next = `${y}${b.slice(4)}`;
      const left = daysBetween(today, next);
      if (left >= 0 && left <= 7) {
        out.push({ tone: "info", text: left === 0 ? "Bugün doğum günü 🎂" : `${left} gün sonra doğum günü 🎂` });
        break;
      }
    }
  }
  return out;
}

/** "1 yıl 2 ay", "5 ay", "12 gün" */
export function tenure(start: string | null, today: string): string | null {
  if (!start || start > today) return null;
  const [y1, m1, d1] = start.split("-").map(Number) as [number, number, number];
  const [y2, m2, d2] = today.split("-").map(Number) as [number, number, number];
  let months = (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
  if (months <= 0) return `${daysBetween(start, today)} gün`;
  const years = Math.floor(months / 12);
  months %= 12;
  return [years ? `${years} yıl` : "", months ? `${months} ay` : ""].filter(Boolean).join(" ");
}

/**
 * ÇIKIŞ ÖN HESABI (sahibine): ayrılış gününe göre kalan yıllık izin + açık
 * hak günleri × günlük ücret (net ÷ 26). Ay ortasında ayrılan o ayın payını
 * almaz (sahibi, 22.10.2026). Yıllık izin tam gün sayılır (ekranla aynı);
 * kesin tutar Maaşlar'daki çıkış mutabakatında.
 */
export function exitPreview(i: {
  hireDate: string | null;
  endDate: string;
  opening: number;
  annualUsed: number;
  lieuOpen: number;
  netSalary: number;
}) {
  const year = Number(i.endDate.slice(0, 4));
  const earned = i.hireDate ? annualLeaveEarned({ hireDate: i.hireDate, endDate: i.endDate, year, asOf: addDays(i.endDate, 1) }).days : 0;
  const annualExact = Math.round((i.opening + earned - i.annualUsed) * 100) / 100;
  const annualWhole = Math.floor(annualExact + 1e-9);
  const dayRate = Math.round((i.netSalary / LEAVE_DAY_DIVISOR) * 100) / 100;
  const payDays = Math.max(0, annualWhole) + i.lieuOpen;
  return {
    annualExact,
    annualWhole,
    lieuOpen: i.lieuOpen,
    dayRate,
    payDays,
    amount: Math.round(payDays * dayRate * 100) / 100,
    /** Eksi yıllık izin — kesinti kararı vaka vaka sahibinin */
    negativeAnnual: annualWhole < 0 ? annualWhole : 0,
  };
}
