"use client";

import { useState } from "react";
import { AlertTriangle, CalendarCheck, Check, Clock, RefreshCw, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { SundayAuditView } from "@/server/services/kolayik/payroll-sync";
import { periodLabel } from "@/server/services/payroll/rules";

const dm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
const num = (v: number) => new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 }).format(v);

type Row = SundayAuditView["rows"][number];
type Sunday = Row["sundays"][number];

/**
 * PAZAR ÇALIŞMASI ↔ HAK GÜNÜ (Kolay İK) — sahibi, 05.10.2026: "her pazar
 * çalışana izin kullandırmamız gerekiyor, izin günleri birikmemeli."
 *
 * Ayın her pazarı için: kim çalıştı (8 saat mesai girdi mi), karşılığındaki
 * günü kullandı mı, izin onaylandı mı. Okuma isteğe bağlıdır (düğme) — her
 * açılışta Kolay İK'ya ~60 sorgu gitmesin. Kurallar: kolayik/sunday-audit.ts.
 */
export function SundayAuditPanel({ year, month }: { year: number; month: number }) {
  const [open, setOpen] = useState(false);
  const [onlyIssues, setOnlyIssues] = useState(false);
  const q = trpc.payroll.kolayik.sundayAudit.useQuery(
    { year, month },
    { enabled: open, staleTime: 5 * 60_000, retry: false, refetchOnWindowFocus: false }
  );
  const data = q.data;
  const label = periodLabel(year, month);

  return (
    <section className="rounded-xl border bg-card px-4 py-3 text-sm shadow-xs">
      <div className="flex flex-wrap items-center gap-3">
        <CalendarCheck className="h-4 w-4 text-muted-foreground" />
        <span className="font-semibold tracking-tight">Pazar çalışması ↔ hak günü</span>
        <span className="text-muted-foreground">
          {label} — pazar çalışan 8 saat mesai girdi mi, karşılığındaki günü kullandı mı?
        </span>
        <div className="flex-1" />
        {!open ? (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            Kontrol et
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => void q.refetch()} disabled={q.isFetching}>
            <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", q.isFetching && "animate-spin")} />
            Yenile
          </Button>
        )}
      </div>

      {open && q.isLoading ? <div className="mt-2 text-muted-foreground">Kolay İK kayıtları okunuyor…</div> : null}
      {open && q.error ? <div className="mt-2 text-rose-700">Okunamadı: {q.error.message}</div> : null}
      {data && !data.ok ? <div className="mt-2 text-rose-700">{data.error}</div> : null}
      {data?.ok
        ? data.warnings.map((w) => (
            <div key={w} className="mt-2 text-xs text-rose-700">
              {w}
            </div>
          ))
        : null}

      {data?.ok ? (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>
              <b>{data.totals.people}</b> kişi toplam <b>{data.totals.worked}</b> pazar çalıştı
            </span>
            <span className="text-emerald-700">
              <b>{data.totals.used}</b> karşılığı kullanıldı
            </span>
            {data.totals.waiting ? (
              <span className="text-amber-800">
                <b>{data.totals.waiting}</b> izin onay bekliyor
              </span>
            ) : null}
            {data.totals.pending ? <span className="text-muted-foreground">{data.totals.pending} pazarın süresi dolmadı</span> : null}
            <span className={cn(data.totals.unused ? "text-rose-700" : "text-muted-foreground")}>
              <b>{data.totals.unused}</b> kullanılmadı
            </span>
            {data.totals.worked - data.totals.with_8h > 0 ? (
              <span className="text-amber-800">
                <b>{data.totals.worked - data.totals.with_8h}</b> pazarda 8 saat kaydı yok
              </span>
            ) : null}
            <div className="flex-1" />
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input type="checkbox" className="h-3.5 w-3.5" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} />
              yalnız sorunlu olanlar
            </label>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr className="border-b">
                  <th className="py-1.5 pr-2 text-left font-medium">Çalışan</th>
                  {data.sundays.map((s) => (
                    <th key={s} className="px-2 py-1.5 text-left font-medium">
                      {dm(s)} pazar
                    </th>
                  ))}
                  <th className="px-2 py-1.5 text-right font-medium">Kullanılan</th>
                  <th className="px-2 py-1.5 text-right font-medium" title="Kolay İK Yıllık İzin bakiyesi: hak edilen + eklenen hak günleri − kullanılan">
                    Kolay İK kalan
                  </th>
                  <th className="py-1.5 pl-2 text-left font-medium">Durum</th>
                </tr>
              </thead>
              <tbody>
                {data.rows
                  .filter((r) => !onlyIssues || r.issues.length > 0)
                  .map((r) => (
                    <tr key={r.person_id} className={cn("border-b align-top last:border-0", r.issues.length > 0 && "bg-rose-50/40")}>
                      <td className="py-1.5 pr-2">
                        <div className="font-medium">{r.name}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {r.store_name ?? "bordroda eşleşmedi"}
                          {r.employee_status === "left" ? ` · ayrıldı${r.end_date ? ` ${dm(r.end_date)}` : ""}` : ""}
                        </div>
                      </td>
                      {data.sundays.map((s) => (
                        <td key={s} className="px-2 py-1.5">
                          <SundayCell row={r.sundays.find((x) => x.date === s)} />
                        </td>
                      ))}
                      <td className={cn("px-2 py-1.5 text-right tabular-nums", r.counts.unused ? "font-semibold text-rose-700" : "text-emerald-700")}>
                        {r.counts.used + r.counts.waiting} / {r.counts.worked}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {r.balance ? (
                          <span
                            className={cn(r.balance.unused > r.balance.earned ? "font-semibold text-amber-800" : r.balance.unused < 0 ? "text-rose-700" : "")}
                            title={`hak edilen ${num(r.balance.earned)} + eklenen hak günü ${num(r.balance.bonus)} − kullanılan ${num(r.balance.used)}`}
                          >
                            {num(r.balance.unused)} gün
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-1.5 pl-2">
                        {r.issues.length === 0 ? (
                          <span className="text-emerald-700">tamam</span>
                        ) : (
                          <ul className="space-y-0.5 text-rose-800">
                            {r.issues.map((t) => (
                              <li key={t} className="flex items-start gap-1">
                                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                                {t}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-1 text-[11px] leading-snug text-muted-foreground">
            <div>
              Okuma: pazar günü girilen mesai kaydı çalışmayı, ardından alınan tek günlük izin karşılık gününü gösterir. Açıklamasında tarih ya da “pazar / haftalık”
              yazan izin en yakın önceki pazara bağlanır; açıklaması “yıllık izin” diyen gün karşılık sayılmaz. 8 saatin üstü (molasız çalışma) ücrettir, hak gününe
              girmez. Pazar ek saati Kolay İK&apos;ya iki katı yazılır (pazar yasal olarak iki kat sayılır: 1 saat fazla çalışan 2 saat yazar); burada yazılan
              saat aynen ödenir, ayrıca çarpılmaz. Pazar günü 8 saat yerine yalnız ek saatini yazan kişi de çalışmış sayılır; yazdığı saat ücrettir, kaydı 8 + ek saat
              olarak düzeltilmelidir.
            </div>
            <div>
              “Kolay İK kalan” yıllık izin bakiyesidir (hak edilen + eklenen hak günleri − kullanılan). Bir yıllık haktan fazlası birikmiş hak günü demektir. Kolay İK
              hak günü eklemelerinin tarihini vermediği için eklemeler ay ay doğrulanamaz.
            </div>
            {data.not_worked.length ? <div>Bu ay pazar çalışması görünmeyenler: {data.not_worked.join(", ")}.</div> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function SundayCell({ row }: { row: Sunday | undefined }) {
  if (!row) return <span className="text-muted-foreground">—</span>;
  const extra = row.has_8h && row.minutes != null && row.minutes > 480 ? row.minutes - 480 : 0;
  return (
    <div className="space-y-0.5" title={row.notes.join("\n") || undefined}>
      {row.state === "used" && row.rest ? (
        <div className="flex items-center gap-1 text-emerald-700" title={row.rest.comment ?? undefined}>
          <Check className="h-3 w-3" />
          {dm(row.rest.date)}
          {row.rest.confidence === "probable" ? <span className="text-muted-foreground">?</span> : null}
        </div>
      ) : row.state === "waiting" && row.rest ? (
        <div className="flex items-center gap-1 text-amber-800" title={row.rest.comment ?? undefined}>
          <Clock className="h-3 w-3" />
          {dm(row.rest.date)} onay bekliyor
        </div>
      ) : row.state === "pending" ? (
        <div className="text-muted-foreground">süresi dolmadı</div>
      ) : (
        <div className="flex items-center gap-1 font-medium text-rose-700">
          <X className="h-3 w-3" />
          kullanılmadı
        </div>
      )}
      {row.source === "misfiled_leave" ? (
        <div className="text-[10px] text-rose-700">çalışma izin olarak girilmiş</div>
      ) : row.source === "leave_comment" ? (
        <div className="text-[10px] text-amber-800">mesai kaydı yok</div>
      ) : !row.has_8h ? (
        <div className="text-[10px] text-amber-800">yalnız ek mesai · {num((row.minutes ?? 0) / 60)} s ücret</div>
      ) : extra ? (
        <div className="text-[10px] text-muted-foreground">+{num(extra / 60)} s ücret</div>
      ) : null}
      {row.overtime_status === "waiting" ? <div className="text-[10px] text-amber-800">mesai onay bekliyor</div> : null}
    </div>
  );
}
