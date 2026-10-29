import { canonicalBankName } from "./bank-names";

/**
 * OPTIMUM PAYI KURALI (sahibi, 29.10.2026): "Optimum cihazı, yani Yapı Kredi ve
 * Optimum gün sonlarının toplamı diğer bankalardan fazla olmalı."
 *
 * Optimum cihazı = ortak PAX terminali; Yapı Kredi ve Koopbank (Optimum) gün
 * sonlarını aynı slipte basar (bkz. PosSlip modeli). Günün yüklenen POS gün
 * sonları iki kümeye ayrılır: Optimum (Yapı Kredi + Koopbank) ↔ diğer bankalar
 * (İş Bankası, Cardplus/Nova, Garanti, Ziraat…). Optimum toplamı diğerlerinin
 * toplamını GEÇMİYORSA gün "Optimum düşük" diye işaretlenir ve kapatmadan önce
 * uyarı verilir. Kilidi ENGELLEMEZ — yalnız uyarıdır.
 */
export const OPTIMUM_BANKS = ["Yapı Kredi", "Koopbank"] as const;

export function isOptimumBank(bankNameRaw: string | null | undefined): boolean {
  return (OPTIMUM_BANKS as readonly string[]).includes(canonicalBankName(bankNameRaw));
}

export type OptimumShare = {
  /** Optimum cihazı (Yapı Kredi + Koopbank) toplamı, TRY */
  optimum: number;
  /** Diğer bankaların toplamı, TRY */
  other: number;
  total: number;
  /** optimum / total, 0–1 (POS yoksa 0) */
  share: number;
  /** ok = Optimum diğerlerinden fazla · low = Optimum diğerlerine eşit ya da altında · no_pos = fiş yok */
  status: "ok" | "low" | "no_pos";
  banks: Array<{ name: string; total: number; optimum: boolean }>;
};

export type SlipLike = { bank_name: string | null; net_amount_try: number | string | { toNumber: () => number } | null };

function amountOf(v: SlipLike["net_amount_try"]): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "object") return v.toNumber();
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function optimumShareOf(slips: SlipLike[]): OptimumShare {
  const byBank = new Map<string, number>();
  for (const s of slips) {
    const name = canonicalBankName(s.bank_name);
    byBank.set(name, (byBank.get(name) ?? 0) + amountOf(s.net_amount_try));
  }
  const banks = Array.from(byBank.entries())
    .map(([name, total]) => ({ name, total: r2(total), optimum: isOptimumBank(name) }))
    .sort((a, b) => b.total - a.total);
  const optimum = r2(banks.filter((b) => b.optimum).reduce((s, b) => s + b.total, 0));
  const other = r2(banks.filter((b) => !b.optimum).reduce((s, b) => s + b.total, 0));
  const total = r2(optimum + other);
  const share = total > 0 ? optimum / total : 0;
  const status: OptimumShare["status"] = total <= 0 ? "no_pos" : optimum > other ? "ok" : "low";
  return { optimum, other, total, share, status, banks };
}

export function fmtShare(share: number): string {
  return `%${Math.round(share * 100)}`;
}
