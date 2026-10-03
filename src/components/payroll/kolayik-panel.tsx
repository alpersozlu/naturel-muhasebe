"use client";

import { RefreshCw } from "lucide-react";
import type { KolayikMonth } from "@/server/services/kolayik/payroll-sync";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { dmy } from "./format";

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

  const otPeople = data.overtime.filter((o) => o.approved_hours > 0);
  const otApproved = data.overtime.reduce((s, o) => s + o.approved_hours, 0);
  const otWaiting = data.overtime.reduce((s, o) => s + o.waiting_hours, 0);
  const leaveDays = data.leaves.reduce((s, l) => s + l.days_approved, 0);

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
            onaylı mesai {otApproved} saat ({otPeople.length} kişi){otWaiting ? ` · onay bekleyen ${otWaiting} saat` : ""} · onaylı izin {leaveDays} gün (
            {data.leaves.length} kişi)
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
            <div className="text-xs text-amber-800">
              Kolay İK&apos;da olup bordroda eşleşmeyen: {data.unmatched_persons.join(", ")} — personel kartına takma ad ekle.
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
                    {!o.employee_id ? <span className="text-amber-800"> (bordroda eşleşmedi)</span> : null} — onaylı {o.approved_hours} s
                    {o.waiting_hours ? `, bekleyen ${o.waiting_hours} s` : ""}
                    <span className="text-muted-foreground">
                      {" "}
                      · {o.entries.map((e) => `${dmy(e.date)} ${e.hours}s ${STATUS_TR[e.status] ?? e.status}${e.description ? ` (${e.description})` : ""}`).join("; ")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
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
                            `${e.type} ${dmy(e.start)}${e.end !== e.start ? `–${dmy(e.end)}` : ""} ${e.days}g ${STATUS_TR[e.status] ?? e.status}${
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
