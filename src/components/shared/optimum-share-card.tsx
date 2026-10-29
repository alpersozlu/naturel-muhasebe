"use client";

import { CreditCard, AlertTriangle, CheckCircle2 } from "lucide-react";
import { fmtShare, type OptimumShare } from "@/lib/optimum-share";

const TRY = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Optimum payı kartı (sahibi, 29.10.2026): günün POS gün sonlarını iki kümeye
 * böler — Optimum cihazı (Yapı Kredi + Koopbank) ↔ diğer bankalar — ve oranı
 * tek çubukta gösterir. Optimum diğerlerini geçmiyorsa amber uyarı; kilidi
 * engellemez. Hem mağazanın mutabakat panelinde hem yöneticinin gün kartında.
 */
export function OptimumShareCard({ share, compact = false }: { share: OptimumShare; compact?: boolean }) {
  if (share.status === "no_pos") return null;
  const low = share.status === "low";
  const pct = Math.round(share.share * 100);
  const tone = low
    ? { ring: "border-amber-300 bg-gradient-to-r from-amber-50 to-amber-50/30", title: "text-amber-900", sub: "text-amber-800/80", pill: "bg-amber-200/70 text-amber-900" }
    : { ring: "border-emerald-200 bg-gradient-to-r from-emerald-50/70 to-white", title: "text-emerald-900", sub: "text-emerald-800/70", pill: "bg-emerald-100 text-emerald-800" };
  return (
    <div className={`rounded-2xl border-2 ${tone.ring} ${compact ? "p-3" : "p-4"} shadow-sm`}>
      <div className="flex items-start gap-3">
        {low ? (
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
        ) : (
          <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`font-semibold text-sm ${tone.title}`}>
              {low ? "Optimum payı düşük" : "Optimum önde"}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${tone.pill}`}>
              Optimum {fmtShare(share.share)} · diğer {fmtShare(1 - share.share)}
            </span>
          </div>

          {/* Oran çubuğu: sol Optimum, sağ diğer bankalar */}
          <div
            className="mt-2.5 h-3 w-full overflow-hidden rounded-full bg-slate-200 flex"
            role="img"
            aria-label={`Optimum ${pct}%, diğer bankalar ${100 - pct}%`}
          >
            <div className={`${low ? "bg-amber-500" : "bg-indigo-600"} h-full transition-all`} style={{ width: `${pct}%` }} />
            <div className="bg-slate-400 h-full flex-1" />
          </div>

          <div className={`mt-2 grid ${compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-2"} gap-2 text-xs`}>
            <div className="rounded-lg bg-white/80 border border-slate-200 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-slate-500 flex items-center gap-1">
                <CreditCard className="h-3 w-3" /> Optimum cihazı
              </div>
              <div className={`tabular-nums font-semibold ${tone.title}`}>{TRY.format(share.optimum)} ₺</div>
              <div className="text-[10px] text-slate-500">Yapı Kredi + Koopbank</div>
            </div>
            <div className="rounded-lg bg-white/80 border border-slate-200 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-slate-500">Diğer bankalar</div>
              <div className="tabular-nums font-semibold text-slate-800">{TRY.format(share.other)} ₺</div>
              <div className="text-[10px] text-slate-500">{share.banks.filter((b) => !b.optimum).map((b) => b.name).join(", ") || "—"}</div>
            </div>
          </div>

          {!compact ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {share.banks.map((b) => (
                <span
                  key={b.name}
                  className={`rounded-md px-2 py-0.5 text-[11px] tabular-nums border ${
                    b.optimum ? "border-indigo-200 bg-indigo-50 text-indigo-800" : "border-slate-200 bg-slate-50 text-slate-700"
                  }`}
                >
                  {b.name} {TRY.format(b.total)} ₺
                </span>
              ))}
            </div>
          ) : null}

          <div className={`mt-2 text-[11px] leading-relaxed ${tone.sub}`}>
            {low
              ? "Kural: Optimum cihazının (Yapı Kredi + Koopbank) gün sonu toplamı diğer bankaların toplamını geçmeli. Kartla ödemelerde önce Optimum cihazını kullanın. Gün yine de kapatılabilir; yönetici bu günü işaretli görür."
              : "Kural sağlandı: Optimum cihazının gün sonu toplamı diğer bankaların toplamını geçiyor."}
          </div>
        </div>
      </div>
    </div>
  );
}
