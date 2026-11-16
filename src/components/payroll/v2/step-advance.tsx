"use client";

import { toast } from "sonner";
import { FileSpreadsheet } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { PeriodView } from "@/server/services/payroll/period";
import { ADVANCE_WARN_SHARE } from "@/server/services/payroll/rules";
import type { BatchChoice } from "../batch-dialog";
import { dmy, money, pct } from "../format";
import { BatchList } from "./batch-list";
import { Chip, Dash, ROW, StepHeader, TD, TH } from "./parts";

/**
 * 1. ADIM — AVANS. Ay ortasında verilen avans; ay başındaki maaştan düşer.
 * Üstte üç liste düğmesi, altında bu ay avans alanlar (kimin, ne kadar,
 * maaşının yüzde kaçı) ve hazırlanan talimatlar.
 */
export function StepAdvance({
  data,
  closed,
  onBatch,
  onOpenLine,
  onChanged,
}: {
  data: PeriodView;
  closed: boolean;
  onBatch: (c: BatchChoice) => void;
  onOpenLine: (id: string) => void;
  onChanged: () => void;
}) {
  const rows = data.stores.flatMap((s) => s.lines).filter((l) => l.calc.advances_total > 0.005);
  const total = rows.reduce((s, l) => s + l.calc.advances_total, 0);
  const without = data.totals.people - rows.length;

  return (
    <div className="space-y-5">
      <StepHeader title="Avans" description="Ay ortasında verilen avans, ay başında ödenen maaştan düşülür. Naturel İK’da onayladığınız talepler listeye dolu gelir.">
        <Button variant="outline" onClick={() => onBatch({ kind: "advance", channel: "garanti" })} disabled={closed}>
          <FileSpreadsheet className="mr-2 h-4 w-4" />
          Garanti talimatı
        </Button>
        <Button variant="outline" onClick={() => onBatch({ kind: "advance", channel: "ziraat" })} disabled={closed}>
          Ziraat listesi
        </Button>
        <Button variant="outline" onClick={() => onBatch({ kind: "advance", channel: "cash" })} disabled={closed}>
          Nakit listesi
        </Button>
      </StepHeader>

      <PendingRequests periodId={data.period.id} closed={closed} onBatch={onBatch} />

      <CashAdvanceSuggestions periodId={data.period.id} onDone={onChanged} />

      <section className="overflow-hidden rounded-2xl border bg-card shadow-xs">
        <header className="flex flex-wrap items-baseline gap-3 border-b px-5 py-3.5">
          <h3 className="font-semibold tracking-tight">Bu ay avans alanlar</h3>
          <span className="text-sm text-muted-foreground">
            {rows.length} kişi{without > 0 ? ` · ${without} kişi almadı` : ""}
          </span>
          <span className="ml-auto text-sm text-muted-foreground">
            toplam <b className="text-base font-semibold tabular-nums text-foreground">{money(total)} ₺</b>
          </span>
        </header>
        {rows.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">Bu ay henüz avans verilmedi. Yukarıdaki listelerden biriyle başlayın.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] table-fixed text-sm">
              <thead>
                <tr>
                  <th className={TH}>Çalışan</th>
                  <th className={cn(TH, "w-[20%] text-left")}>Mağaza</th>
                  <th className={cn(TH, "w-[14%]")}>Baz maaş</th>
                  <th className={cn(TH, "w-[14%]")}>Avans</th>
                  <th className={cn(TH, "w-[22%]")}>Maaşa oranı</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => {
                  const share = l.base_salary > 0 ? l.calc.advances_total / l.base_salary : null;
                  const high = share != null && share > ADVANCE_WARN_SHARE;
                  return (
                    <tr key={l.id} className={ROW} tabIndex={0} onClick={() => onOpenLine(l.id)} onKeyDown={(e) => e.key === "Enter" && onOpenLine(l.id)}>
                      <td className={TD}>
                        <div className="font-medium">{l.full_name}</div>
                        <div className="text-sm text-muted-foreground">{l.position}</div>
                      </td>
                      <td className={cn(TD, "text-left text-muted-foreground")}>{l.store_name}</td>
                      <td className={TD}>{l.base_salary > 0 ? money(l.base_salary) : <Dash />}</td>
                      <td className={cn(TD, "font-semibold")}>{money(l.calc.advances_total)}</td>
                      <td className={TD}>{share == null ? <Dash /> : high ? <Chip tone="wait">{pct(share)} · sınırın üstünde</Chip> : pct(share)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <BatchList data={data} kinds={["advance"]} title="Avans talimatları ve listeleri" onChanged={onChanged} />
    </div>
  );
}

const CHANNEL_LABEL: Record<string, { ad: string; buton: string }> = {
  garanti: { ad: "Garanti", buton: "Garanti talimatı" },
  ziraat: { ad: "Ziraat", buton: "Ziraat listesi" },
  cash: { ad: "Nakit", buton: "Nakit listesi" },
};

/**
 * ONAYLI AMA ÖDENMEMİŞ TALEPLER (sahibi, 16.11.2026: "İK'da onaylandı ama
 * talimat verilip para hesaplara yatmadı"). Onay ödeme değildir; bu liste
 * aradaki boşluğu ana ekranda gösterir, talimat düğmeleri hemen yanında.
 */
function PendingRequests({
  periodId,
  closed,
  onBatch,
}: {
  periodId: string;
  closed: boolean;
  onBatch: (c: BatchChoice) => void;
}) {
  const q = trpc.payroll.advanceRequests.pending.useQuery({ period_id: periodId });
  if (q.isLoading || !q.data?.ok || q.data.rows.length === 0) return null;
  const rows = q.data.rows;
  const byChannel = new Map<string, typeof rows>();
  for (const r of rows) byChannel.set(r.channel, [...(byChannel.get(r.channel) ?? []), r]);
  const eksikBanka = rows.filter((r) => r.channel !== "cash" && !r.has_bank_details);
  return (
    <section className="overflow-hidden rounded-2xl border border-amber-200 bg-amber-50/50">
      <header className="flex flex-wrap items-baseline gap-3 px-5 py-3.5">
        <h3 className="font-semibold tracking-tight text-amber-950">
          Onaylandı, henüz ödenmedi ({rows.length} kişi)
        </h3>
        <span className="ml-auto text-sm text-amber-900/80">
          toplam <b className="text-base font-semibold tabular-nums text-amber-950">{money(q.data.total)} ₺</b>
        </span>
        <p className="w-full text-sm text-amber-900/80">
          {q.data.source === "naturel_ik" ? "Naturel İK" : "Kolay İK"}&apos;da onayladığınız talepler. Para ancak talimat
          gönderilince yatar; avans o zaman maaştan düşer.
        </p>
      </header>
      <div className="divide-y divide-amber-200/70 border-t border-amber-200/70 bg-card">
        {Array.from(byChannel.entries()).map(([ch, list]) => {
          const meta = CHANNEL_LABEL[ch];
          const toplam = list.reduce((s, r) => s + r.amount, 0);
          return (
            <div key={ch} className="px-5 py-3">
              <div className="mb-1.5 flex flex-wrap items-center gap-3">
                <span className="font-medium">{meta?.ad ?? ch}</span>
                <span className="text-sm text-muted-foreground">
                  {list.length} kişi · <b className="tabular-nums text-foreground">{money(toplam)} ₺</b>
                </span>
                {meta && ch !== "other" ? (
                  <Button
                    size="sm"
                    className="ml-auto"
                    disabled={closed}
                    onClick={() => onBatch({ kind: "advance", channel: ch as "garanti" | "ziraat" | "cash" })}
                  >
                    <FileSpreadsheet className="mr-2 h-4 w-4" />
                    {meta.buton}
                  </Button>
                ) : null}
              </div>
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                {list.map((r) => (
                  <li key={r.line_id}>
                    <span className="font-medium text-foreground">{r.full_name}</span>{" "}
                    <span className="tabular-nums">{money(r.amount)}</span>
                    {r.recorded ? <span className="text-amber-700"> · {money(r.recorded)} ödendi</span> : null}
                    {r.channel !== "cash" && !r.has_bank_details ? (
                      <span className="text-rose-700"> · banka bilgisi yok</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      {eksikBanka.length > 0 ? (
        <p className="border-t border-amber-200/70 bg-card px-5 py-2.5 text-sm text-rose-700">
          {eksikBanka.length} kişinin şube/hesap bilgisi eksik; talimata giremez: {eksikBanka.map((r) => r.full_name).join(", ")}
        </p>
      ) : null}
    </section>
  );
}

/** Mağazaların günlük kayıtlarında "avans" olarak girilen nakitler — bordroya tek tıkla işlenir. */
function CashAdvanceSuggestions({ periodId, onDone }: { periodId: string; onDone: () => void }) {
  const q = trpc.payroll.cashAdvances.suggest.useQuery({ period_id: periodId });
  const link = trpc.payroll.cashAdvances.link.useMutation({
    onSuccess: () => {
      toast.success("Kasadan yapılan ödeme bordroya işlendi");
      void q.refetch();
      onDone();
    },
    onError: (e) => toast.error(e.message),
  });
  const rows = q.data ?? [];
  if (rows.length === 0) return null;
  return (
    <section className="overflow-hidden rounded-2xl border border-amber-200 bg-amber-50/50">
      <header className="px-5 py-3.5">
        <h3 className="font-semibold tracking-tight text-amber-950">Kasadan yapılan ödemeler bordroya işlenmedi ({rows.length})</h3>
        <p className="mt-0.5 text-sm text-amber-900/80">
          Mağazaların günlük kayıtlarında maaş ya da avans olarak girilen nakitler — kişi listeden seçilmediği için
          kendiliğinden işlenemedi. Aktarınca kişinin maaşından düşer.
        </p>
      </header>
      <ul className="divide-y divide-amber-200/70 border-t border-amber-200/70 bg-card text-sm">
        {rows.map((r) => (
          <li key={r.cash_advance_id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5">
            <span className="w-24 tabular-nums text-muted-foreground">{dmy(r.date)}</span>
            <span className="font-medium">{r.staff_name}</span>
            <span className="rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-900">
              {r.category === "salary" ? "Maaş" : "Avans"}
            </span>
            <span className="text-muted-foreground">{r.store_name}</span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{r.description}</span>
            <span className="font-semibold tabular-nums">{money(r.amount)} ₺</span>
            {r.line_id ? (
              <Button size="sm" variant="outline" onClick={() => link.mutate({ line_id: r.line_id!, cash_advance_id: r.cash_advance_id })} disabled={link.isPending}>
                {r.matched_name && r.matched_name !== r.staff_name ? `${r.matched_name} olarak aktar` : "Bordroya aktar"}
              </Button>
            ) : (
              <span className="text-rose-700">Personelde eşleşme yok; Personel sayfasından takma ad ekleyin</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
