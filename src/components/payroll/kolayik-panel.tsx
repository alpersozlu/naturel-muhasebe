"use client";

import { RefreshCw } from "lucide-react";
import type { KolayikMonth } from "@/server/services/kolayik/payroll-sync";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { dmy, hoursTr, money, CHANNEL_SHORT } from "./format";

const STATUS_TR: Record<string, string> = {
  approved: "onaylı",
  waiting: "bekliyor",
  rejected: "reddedildi",
  cancelled: "iptal",
};

/**
 * Kolay İK'dan okunan ayın mesai ve izin kayıtları — yalnız bilgi. Mesai
 * saatleri satırlarda öneri olarak görünür; izinler burada listelenir.
 */
export function KolayikPanel({
  data,
  loading,
  queryError,
  onRefresh,
}: {
  data: KolayikMonth | undefined;
  loading: boolean;
  queryError?: string | null;
  onRefresh: () => void;
}) {
  if (!data) {
    if (loading) {
      return <div className="rounded-xl border bg-card px-4 py-3 text-sm text-muted-foreground shadow-xs">Kolay İK okunuyor…</div>;
    }
    return queryError ? (
      <div className="rounded-xl border bg-card px-4 py-3 text-sm text-rose-700 shadow-xs">
        Kolay İK sorgusu tamamlanamadı: {queryError}{" "}
        <button type="button" className="underline" onClick={onRefresh}>
          yeniden dene
        </button>
      </div>
    ) : null;
  }
  if (!data.configured) return null;

  const r1 = (v: number) => Math.round(v * 100) / 100;
  const otPeople = data.overtime.filter((o) => o.approved_hours > 0);
  const otApproved = r1(data.overtime.reduce((s, o) => s + o.approved_hours, 0));
  const otWaiting = r1(data.overtime.reduce((s, o) => s + o.waiting_hours, 0));
  const creditDays = data.overtime.reduce((s, o) => s + o.credit_days, 0);
  const sundayExtra = r1(data.overtime.reduce((s, o) => s + o.sunday_extra_hours, 0));
  const leaveDays = r1(data.leaves.reduce((s, l) => s + l.days_approved, 0));
  const advTotal = data.advances.reduce((s, a) => s + a.amount, 0);
  const advMissing = data.advances.filter((a) => a.match === "none").length;
  const advDiff = data.advances.filter((a) => a.match === "amount_diff").length;

  return (
    <section className="rounded-xl border bg-card px-4 py-3 text-sm shadow-xs">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-semibold tracking-tight">Kolay İK</span>
        {data.ok ? (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-200/70">
            bağlı · {data.persons} personel
          </span>
        ) : (
          <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700 ring-1 ring-rose-200/70">bağlanamadı</span>
        )}
        {data.ok ? (
          <span className="text-muted-foreground">
            ödenecek mesai {hoursTr(otApproved)} saat ({otPeople.length} kişi){sundayExtra ? ` · bunun ${hoursTr(sundayExtra)} saati pazar 8 saat üstü` : ""}
            {creditDays ? ` · ${creditDays} hak günü (pazar / tatil 8 saati, ücrete girmez)` : ""}
            {otWaiting ? ` · onay bekleyen ${hoursTr(otWaiting)} saat` : ""} · onaylı izin {hoursTr(leaveDays)} gün ({data.leaves.length} kişi) · avans talebi{" "}
            {data.advances.length} ({money(advTotal)} ₺)
          </span>
        ) : null}
        <div className="flex-1" />
        <Button size="sm" variant="ghost" onClick={onRefresh} disabled={loading}>
          <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", loading && "animate-spin")} />
          Yenile
        </Button>
      </div>

      {!data.ok && data.error ? <div className="mt-2 text-rose-700">{data.error}</div> : null}

      {data.ok ? (
        <div className="mt-2 space-y-2">
          {data.warnings.map((w) => (
            <div key={w} className="text-xs text-rose-700">
              {w}
            </div>
          ))}
          {data.unmatched_persons.length ? (
            <div className="text-xs text-muted-foreground">
              Kolay İK&apos;da olup bordroda eşleşmeyen: {data.unmatched_persons.join(", ")} — bordroya girecekse personel kartına takma ad ekle.
            </div>
          ) : null}
          {data.unmatched_employees.length ? (
            <div className="text-xs text-muted-foreground">Bordroda olup Kolay İK&apos;da bulunmayan: {data.unmatched_employees.join(", ")}</div>
          ) : null}

          <details>
            <summary className="cursor-pointer select-none text-sm font-medium">
              Bu ayın mesai kayıtları ({data.overtime.length} kişi)
            </summary>
            {data.overtime.length === 0 ? (
              <div className="mt-1 text-xs text-muted-foreground">Bu ay mesai kaydı yok.</div>
            ) : (
              <ul className="mt-1 space-y-1 text-xs">
                {data.overtime.map((o) => (
                  <li key={o.person_name}>
                    <span className="font-medium">{o.person_name}</span>
                    {!o.employee_id ? <span className="text-amber-800"> (bordroda eşleşmedi)</span> : null} — ödenecek {hoursTr(o.approved_hours)} s
                    {o.sunday_extra_hours ? ` (${hoursTr(o.sunday_extra_hours)} s pazar 8 saat üstü)` : ""}
                    {o.credit_days ? `, ${o.credit_days} hak günü` : ""}
                    {o.waiting_hours ? `, bekleyen ${hoursTr(o.waiting_hours)} s` : ""}
                    {o.review ? <span className="text-amber-800"> · hafta içi 8+ saat kayıt var, bakılmalı</span> : null}
                    <span className="text-muted-foreground">
                      {" "}
                      ·{" "}
                      {o.entries
                        .map(
                          (e) =>
                            `${dmy(e.date)} ${e.hours}s${
                              e.credit_day
                                ? ` (8s hak günü${e.paid_hours > 0 ? ` + ${e.paid_hours}s ücret` : ""})`
                                : e.rest_day
                                  ? " (pazar: yalnız ek mesai yazılmış, tamamı ücret)"
                                  : ""
                            } ${
                              STATUS_TR[e.status] ?? e.status
                            }${e.description ? ` (${e.description.replace(/\s+/g, " ")})` : ""}`
                        )
                        .join("; ")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </details>

          <details open={advMissing + advDiff > 0 || data.advances_only_in_payroll.length > 0}>
            <summary className="cursor-pointer select-none text-sm font-medium">
              Bu ayın avans talepleri ({data.advances.length} talep · {money(advTotal)} ₺)
              {advMissing ? <span className="ml-2 text-rose-700">{advMissing} talebin bordroda kaydı yok</span> : null}
              {advDiff ? <span className="ml-2 text-amber-800">{advDiff} talep farklı tutarla kayıtlı</span> : null}
            </summary>
            {data.advances.length === 0 ? (
              <div className="mt-1 text-xs text-muted-foreground">Bu ay Kolay İK&apos;da avans talebi yok.</div>
            ) : (
              <table className="mt-1 w-full text-xs">
                <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-1 text-left font-medium">Tarih</th>
                    <th className="py-1 text-left font-medium">Kişi</th>
                    <th className="py-1 text-right font-medium">Talep</th>
                    <th className="py-1 text-left font-medium">Kolay İK</th>
                    <th className="py-1 text-left font-medium">Bordro kaydı (DocuFlow)</th>
                  </tr>
                </thead>
                <tbody>
                  {data.advances.map((a) => (
                    <tr key={a.id} className={cn("border-b last:border-0", a.match === "none" && "bg-rose-50/40", a.match === "amount_diff" && "bg-amber-50/40")}>
                      <td className="py-1 tabular-nums">{dmy(a.date)}</td>
                      <td className="py-1">
                        <span className="font-medium">{a.person_name}</span>
                        {!a.employee_id ? <span className="text-amber-800"> (bordroda eşleşmedi)</span> : null}
                        {a.description ? <span className="text-muted-foreground"> · {a.description}</span> : null}
                      </td>
                      <td className="py-1 text-right tabular-nums">{money(a.amount)}</td>
                      <td className="py-1 text-muted-foreground">
                        {STATUS_TR[a.status] ?? a.status}
                        {a.paid ? " · ödendi" : " · ödenmedi işaretli"}
                        {a.affect_payroll ? " · bordroya işler" : ""}
                      </td>
                      <td className="py-1">
                        {a.match === "exact" ? (
                          <span className="text-emerald-700">
                            ✓ {money(a.payroll_amount!)} · {a.payroll_channel ? (CHANNEL_SHORT[a.payroll_channel as keyof typeof CHANNEL_SHORT] ?? a.payroll_channel) : "—"} · {dmy(a.payroll_date!)}
                          </span>
                        ) : a.match === "amount_diff" ? (
                          <span className="text-amber-800">
                            farklı tutar: bordroda {money(a.payroll_amount!)} ({a.payroll_channel ? (CHANNEL_SHORT[a.payroll_channel as keyof typeof CHANNEL_SHORT] ?? a.payroll_channel) : "—"}, {dmy(a.payroll_date!)})
                          </span>
                        ) : (
                          <span className="text-rose-700">kayıt yok — bordroda avans girilmemiş</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {data.advances_only_in_payroll.length ? (
              <div className="mt-2 text-xs">
                <span className="font-medium">Bordroda avans var, Kolay İK&apos;da talebi yok ({data.advances_only_in_payroll.length}):</span>{" "}
                <span className="text-muted-foreground">
                  {data.advances_only_in_payroll.map((p) => `${p.full_name} ${money(p.amount)} (${p.channel ? (CHANNEL_SHORT[p.channel as keyof typeof CHANNEL_SHORT] ?? p.channel) : "—"}, ${dmy(p.date)})`).join(" · ")}
                </span>
              </div>
            ) : null}
            <div className="mt-1 text-[11px] text-muted-foreground">
              Kolay İK&apos;da avans &quot;işlem&quot; olarak tutulur (tür: allowance); bu liste salt okunurdur, ödendi işareti Kolay İK&apos;da verilir.
            </div>
          </details>

          <details>
            <summary className="cursor-pointer select-none text-sm font-medium">Bu ayın izinleri ({data.leaves.length} kişi)</summary>
            {data.leaves.length === 0 ? (
              <div className="mt-1 text-xs text-muted-foreground">Bu ay izin kaydı yok.</div>
            ) : (
              <ul className="mt-1 space-y-1 text-xs">
                {data.leaves.map((l) => (
                  <li key={l.person_name}>
                    <span className="font-medium">{l.person_name}</span>
                    {!l.employee_id ? <span className="text-amber-800"> (bordroda eşleşmedi)</span> : null} — onaylı {l.days_approved} gün
                    <span className="text-muted-foreground">
                      {" "}
                      ·{" "}
                      {l.entries
                        .map(
                          (e) =>
                            `${e.type} ${dmy(e.start)}${e.end !== e.start ? `–${dmy(e.end)}` : ""} ${e.days}g${
                              e.days_in_month !== e.days ? ` (bu ayda ${e.days_in_month}g)` : ""
                            } ${STATUS_TR[e.status] ?? e.status}${
                              e.comment ? ` (${e.comment})` : ""
                            }`
                        )
                        .join("; ")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-1 text-[11px] text-muted-foreground">
              Not: Kolay İK&apos;da hak günü (pazar/tatil karşılığı) ile yıllık izin aynı türde görünür; ayrımı açıklama metninden yapılır.
            </div>
          </details>
        </div>
      ) : null}
    </section>
  );
}
