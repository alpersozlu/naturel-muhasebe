import {
  Lock,
  CheckCircle2,
  AlertTriangle,
  Clock,
  CircleDashed,
  CalendarClock,
  type LucideIcon,
} from "lucide-react";
import { checkThirdStage, docCountOf, type DayRecord } from "./types";

/**
 * Doğrulama Sistemi durum modeli — tek yerde. Renk hiçbir zaman tek başına
 * anlam taşımaz: her durumun ikonu ve metni var (erişilebilirlik).
 *
 *   locked   → gün doğrulandı ve kilitlendi (yeşil, kilit)
 *   match    → belgeler özetle tutuyor, kilit bekliyor (yeşil, onay)
 *   mismatch → belge toplamı özetten farklı (kırmızı, uyarı)
 *   pending  → belge var ama özet/mutabakat yok (amber, saat)
 *   empty    → geçmiş gün, hiç belge yok (gri, kesik daire)
 *   future   → bugünden sonraki gün (gri, takvim)
 */
export type DayStatusKey = "locked" | "match" | "mismatch" | "pending" | "empty" | "future";

export const STATUS_META: Record<
  DayStatusKey,
  { label: string; short: string; Icon: LucideIcon; dot: string; chip: string; explain: string }
> = {
  locked: {
    label: "Kilitli",
    short: "Kilitli",
    Icon: Lock,
    dot: "bg-emerald-500",
    chip: "border-emerald-200 bg-emerald-50 text-emerald-800",
    explain: "Gün doğrulandı ve kilitlendi. Belge eklenemez; kilidi yalnız yönetici açar.",
  },
  match: {
    label: "Eşleşiyor",
    short: "Eşleşiyor",
    Icon: CheckCircle2,
    dot: "bg-emerald-500",
    chip: "border-emerald-200 bg-white text-emerald-800",
    explain: "Belgeler mağaza özetiyle tutuyor. Kilitlenmeyi bekliyor.",
  },
  mismatch: {
    label: "Fark var",
    short: "Fark",
    Icon: AlertTriangle,
    dot: "bg-rose-500",
    chip: "border-rose-200 bg-rose-50 text-rose-800",
    explain: "Belge toplamı mağaza özetinden farklı. Dökümü ve mutabakat notunu kontrol edin.",
  },
  pending: {
    label: "Beklemede",
    short: "Bekliyor",
    Icon: Clock,
    dot: "bg-amber-500",
    chip: "border-amber-200 bg-amber-50 text-amber-900",
    explain: "Belge yüklenmiş ama mağaza özeti ya da mutabakat eksik.",
  },
  empty: {
    label: "Belge yok",
    short: "Boş",
    Icon: CircleDashed,
    dot: "bg-slate-300",
    chip: "border-slate-200 bg-slate-50 text-slate-600",
    explain: "Bu güne hiçbir belge yüklenmedi.",
  },
  future: {
    label: "Gelecek",
    short: "Gelecek",
    Icon: CalendarClock,
    dot: "bg-slate-200",
    chip: "border-slate-200 bg-white text-slate-400",
    explain: "Bu gün henüz gelmedi.",
  },
};

/** Sıralama: liste süzgeçleri ve ay özeti karoları bu sırayla. */
export const STATUS_ORDER: DayStatusKey[] = ["mismatch", "pending", "match", "locked", "empty"];

export function deriveStatus(days: DayRecord[]): DayStatusKey {
  if (days.length === 0) return "empty";
  // Birleşik grup tek kilitlenir; hepsi kilitliyse kilitli.
  if (days.every((d) => d.status === "locked")) return "locked";
  const lead = days.find((d) => !!d.store_summary) ?? days[days.length - 1]!;
  const v = lead.verification;
  if (lead.store_summary && v) {
    if (v.status === "match" || v.status === "manual_override") return "match";
    return "mismatch";
  }
  return docCountOf(days) > 0 ? "pending" : "empty";
}

export type DayFlags = {
  optimumLow: boolean;
  /** Mavi: SAP eksik ya da özetle uyumsuz (yalnız özet varken anlamlı). */
  sapIssue: string | null;
};

export function deriveFlags(lead: DayRecord, status: DayStatusKey): DayFlags {
  const optimumLow = lead.optimum?.status === "low";
  const third = lead.store_summary && status !== "locked" ? checkThirdStage(lead) : { ok: true, reason: null };
  return { optimumLow, sapIssue: third.ok ? null : third.reason };
}
