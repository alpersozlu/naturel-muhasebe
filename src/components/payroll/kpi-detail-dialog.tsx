"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ComputedLine, PeriodView } from "@/server/services/payroll/period";
import { CHANNEL_SHORT, KIND_LABEL, KIND_TONE, dmy, money } from "./format";

export type KpiKind = "paid" | "salaries" | "payment2" | "remaining" | "extras";

const TITLE: Record<KpiKind, string> = {
  paid: "Ödenenler — kim, ne zaman, ne kadar",
  salaries: "Maaşlar (Ödeme 1) — kimin maaşı ödendi, kiminki bekliyor",
  payment2: "Maaşlar (Ödeme 2) — mesai, komisyon, prim: kime ne ödenecek, kime ödendi",
  remaining: "Net kalan — kime ne kadar borçluyuz",
  extras: "Mesai + komisyon + primler — kişi kişi",
};

/**
 * KPI kartlarının arkasındaki isimler. Dönem görünümündeki veriden
 * (stores[].lines[]) üretilir, sunucuya gitmez. İsme tıklayınca kişinin
 * penceresi açılır.
 */
export function KpiDetailDialog({
  kind,
  data,
  onClose,
  onOpenLine,
}: {
  kind: KpiKind;
  data: PeriodView;
  onClose: () => void;
  onOpenLine: (lineId: string) => void;
}) {
  const lines = useMemo(() => data.stores.flatMap((s) => s.lines), [data]);
  const pick = (id: string) => {
    onClose();
    onOpenLine(id);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{TITLE[kind]}</DialogTitle>
          <DialogDescription>{data.period.label} · isme tıklayınca kişinin penceresi açılır.</DialogDescription>
        </DialogHeader>
        {kind === "paid" ? <Paid lines={lines} onPick={pick} /> : null}
        {kind === "salaries" ? <Salaries lines={lines} onPick={pick} /> : null}
        {kind === "payment2" ? <Payment2 lines={lines} onPick={pick} /> : null}
        {kind === "remaining" ? <Remaining lines={lines} onPick={pick} /> : null}
        {kind === "extras" ? <Extras lines={lines} onPick={pick} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function Name({ l, onPick }: { l: ComputedLine; onPick: (id: string) => void }) {
  return (
    <button type="button" onClick={() => onPick(l.id)} className="text-left hover:underline">
      <span className="font-medium">{l.full_name}</span>
      <span className="ml-2 text-xs text-muted-foreground">{l.store_name}</span>
    </button>
  );
}

function Paid({ lines, onPick }: { lines: ComputedLine[]; onPick: (id: string) => void }) {
  const rows = lines
    .filter((l) => l.calc.paid_total > 0.005)
    .sort((a, b) => b.calc.paid_total - a.calc.paid_total);
  const total = rows.reduce((s, l) => s + l.calc.paid_total, 0);
  if (rows.length === 0) return <Empty text="Bu ay henüz kimseye ödeme yapılmadı." />;
  return (
    <div className="space-y-3">
      <div className="text-sm text-muted-foreground">
        {rows.length} kişi · toplam <b className="tabular-nums text-foreground">{money(total)} ₺</b>
      </div>
      <ul className="divide-y">
        {rows.map((l) => (
          <li key={l.id} className="py-2">
            <div className="flex items-center gap-3">
              <Name l={l} onPick={onPick} />
              <span className="ml-auto tabular-nums font-semibold">{money(l.calc.paid_total)} ₺</span>
            </div>
            <ul className="mt-1 space-y-0.5 pl-2 text-xs">
              {l.calc.entries
                .filter((e) => (e.kind === "advance" || e.kind === "payment") && e.counted)
                .map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center gap-2 text-muted-foreground">
                    <span className="tabular-nums">{dmy(String(e.entry_date))}</span>
                    <span className={cn("rounded px-1 py-0 text-[10px] font-medium ring-1", KIND_TONE[e.kind])}>{KIND_LABEL[e.kind]}</span>
                    {e.channel ? <span>{CHANNEL_SHORT[e.channel as keyof typeof CHANNEL_SHORT] ?? e.channel}</span> : null}
                    <span className="tabular-nums text-foreground">{money(e.amount)} ₺</span>
                    {e.note ? <span className="truncate">· {e.note}</span> : null}
                  </li>
                ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Salaries({ lines, onPick }: { lines: ComputedLine[]; onPick: (id: string) => void }) {
  const withBase = lines.filter((l) => l.base_salary > 0);
  const paid = withBase.filter((l) => l.calc.base_paid);
  const unpaid = withBase.filter((l) => !l.calc.base_paid).sort((a, b) => b.calc.payment1_due - a.calc.payment1_due);
  const unpaidTotal = unpaid.reduce((s, l) => s + l.calc.payment1_due, 0);
  return (
    <div className="space-y-5">
      <section>
        <div className="mb-1 text-sm font-medium text-amber-800">
          Maaşı ödenmeyenler ({unpaid.length}) · bekleyen {money(unpaidTotal)} ₺
        </div>
        {unpaid.length === 0 ? (
          <Empty text="Herkesin baz maaşı ödendi." />
        ) : (
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr className="border-b">
                <th className="py-1 text-left font-medium">Çalışan</th>
                <th className="py-1 text-right font-medium">Baz</th>
                <th className="py-1 text-right font-medium">Avans</th>
                <th className="py-1 text-right font-medium">Kalan maaş</th>
              </tr>
            </thead>
            <tbody>
              {unpaid.map((l) => (
                <tr key={l.id} className="border-b last:border-0">
                  <td className="py-1.5">
                    <Name l={l} onPick={onPick} />
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{money(l.base_salary)}</td>
                  <td className="py-1.5 text-right tabular-nums text-amber-800">{l.calc.advances_total ? money(l.calc.advances_total) : "—"}</td>
                  <td className="py-1.5 text-right tabular-nums font-medium">{money(l.calc.payment1_due)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section>
        <div className="mb-1 text-sm font-medium text-emerald-700">Maaşı ödenenler ({paid.length})</div>
        {paid.length === 0 ? (
          <Empty text="Henüz kimsenin baz maaşı tamamlanmadı." />
        ) : (
          <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2 text-sm">
            {paid.map((l) => (
              <li key={l.id} className="flex items-center gap-2">
                <Name l={l} onPick={onPick} />
                <span className="ml-auto tabular-nums text-muted-foreground">{money(l.calc.paid_total)} ₺</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * Ödeme 2 listesi: maaş rakamı YOK. Yalnız Ödeme 2'yi oluşturan kalemler
 * (mesai, komisyon, primler, eklemeler, kesintiler) ve kişiye ödenecek /
 * ödenen Ödeme 2 tutarı (sahibi, 07.10.2026: "maaşları karışmasın").
 */
function Payment2({ lines, onPick }: { lines: ComputedLine[]; onPick: (id: string) => void }) {
  const inScope = lines.filter((l) => l.calc.payment2_in_scope);
  const due = inScope.filter((l) => !l.calc.payment2_settled).sort((a, b) => b.calc.payment2_due - a.calc.payment2_due);
  const settled = inScope.filter((l) => l.calc.payment2_settled).sort((a, b) => b.calc.payment2_paid - a.calc.payment2_paid);
  const tot = (rows: ComputedLine[], f: (l: ComputedLine) => number) => rows.reduce((s, l) => s + f(l), 0);
  const prem = (l: ComputedLine) => l.calc.perfume_amount + l.calc.garment_amount + l.calc.top_seller_amount + l.calc.extra_premium;
  const cell = (v: number, cls = "") => <td className={cn("py-1.5 text-right tabular-nums", cls)}>{Math.abs(v) > 0.005 ? money(v) : "—"}</td>;
  return (
    <div className="space-y-5">
      <section>
        <div className="mb-1 text-sm font-medium text-amber-800">
          Ödeme 2 bekleyenler ({due.length}) · ödenecek {money(tot(due, (l) => l.calc.payment2_due))} ₺
        </div>
        {due.length === 0 ? (
          <Empty text="Bekleyen Ödeme 2 yok." />
        ) : (
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr className="border-b">
                <th className="py-1 text-left font-medium">Çalışan</th>
                <th className="py-1 text-right font-medium">Mesai</th>
                <th className="py-1 text-right font-medium">Komisyon</th>
                <th className="py-1 text-right font-medium">Primler</th>
                <th className="py-1 text-right font-medium">Ekleme</th>
                <th className="py-1 text-right font-medium">Kesinti</th>
                <th className="py-1 text-right font-medium">Ödenen</th>
                <th className="py-1 text-right font-medium">Ödenecek</th>
              </tr>
            </thead>
            <tbody>
              {due.map((l) => (
                <tr key={l.id} className="border-b last:border-0">
                  <td className="py-1.5">
                    <Name l={l} onPick={onPick} />
                    {!l.calc.base_paid ? <div className="text-[10px] text-amber-800">maaşı henüz ödenmedi</div> : null}
                  </td>
                  {cell(l.calc.overtime_amount)}
                  {cell(l.calc.commission.final)}
                  {cell(prem(l))}
                  {cell(l.calc.additions_total, "text-emerald-700")}
                  {cell(-l.calc.deductions_total, "text-rose-700")}
                  {cell(l.calc.payment2_paid, "text-muted-foreground")}
                  <td className="py-1.5 text-right tabular-nums font-semibold">{money(l.calc.payment2_due)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t font-semibold">
                <td className="py-1.5">Toplam</td>
                {cell(tot(due, (l) => l.calc.overtime_amount))}
                {cell(tot(due, (l) => l.calc.commission.final))}
                {cell(tot(due, prem))}
                {cell(tot(due, (l) => l.calc.additions_total), "text-emerald-700")}
                {cell(-tot(due, (l) => l.calc.deductions_total), "text-rose-700")}
                {cell(tot(due, (l) => l.calc.payment2_paid), "text-muted-foreground")}
                <td className="py-1.5 text-right tabular-nums">{money(tot(due, (l) => l.calc.payment2_due))}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </section>
      <section>
        <div className="mb-1 text-sm font-medium text-emerald-700">
          Ödeme 2 ödenenler ({settled.length}) · {money(tot(settled, (l) => l.calc.payment2_paid))} ₺
        </div>
        {settled.length === 0 ? (
          <Empty text="Henüz kimsenin Ödeme 2'si ödenmedi." />
        ) : (
          <ul className="divide-y text-sm">
            {settled.map((l) => (
              <li key={l.id} className="py-1.5">
                <div className="flex items-center gap-2">
                  <Name l={l} onPick={onPick} />
                  <span className="ml-auto tabular-nums font-semibold">{money(l.calc.payment2_paid)} ₺</span>
                </div>
                <ul className="mt-0.5 space-y-0.5 pl-2 text-xs text-muted-foreground">
                  {l.calc.entries
                    .filter((e) => e.kind === "payment" && e.category === "payment2" && e.counted)
                    .map((e) => (
                      <li key={e.id} className="flex flex-wrap items-center gap-2">
                        <span className="tabular-nums">{dmy(String(e.entry_date))}</span>
                        {e.channel ? <span>{CHANNEL_SHORT[e.channel as keyof typeof CHANNEL_SHORT] ?? e.channel}</span> : null}
                        <span className="tabular-nums text-foreground">{money(e.amount)} ₺</span>
                        {e.batch ? <span className="truncate">· {e.batch.title}</span> : null}
                      </li>
                    ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Remaining({ lines, onPick }: { lines: ComputedLine[]; onPick: (id: string) => void }) {
  const rows = lines.filter((l) => Math.abs(l.calc.net_remaining) > 0.5).sort((a, b) => b.calc.net_remaining - a.calc.net_remaining);
  const total = rows.reduce((s, l) => s + l.calc.net_remaining, 0);
  if (rows.length === 0) return <Empty text="Kimsenin net kalanı yok — ay kapatılabilir." />;
  return (
    <div className="space-y-2">
      <div className="text-sm text-muted-foreground">
        {rows.length} kişi · toplam <b className="tabular-nums text-foreground">{money(total)} ₺</b>
      </div>
      <table className="w-full text-sm">
        <thead className="text-[11px] uppercase tracking-wider text-muted-foreground">
          <tr className="border-b">
            <th className="py-1 text-left font-medium">Çalışan</th>
            <th className="py-1 text-right font-medium">Maaştan</th>
            <th className="py-1 text-right font-medium">Ekstradan</th>
            <th className="py-1 text-right font-medium">Net kalan</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((l) => (
            <tr key={l.id} className="border-b last:border-0">
              <td className="py-1.5">
                <Name l={l} onPick={onPick} />
              </td>
              <td className="py-1.5 text-right tabular-nums">{l.calc.payment1_due ? money(l.calc.payment1_due) : "—"}</td>
              <td className="py-1.5 text-right tabular-nums">{l.calc.payment2_due ? money(l.calc.payment2_due) : "—"}</td>
              <td className={cn("py-1.5 text-right tabular-nums font-medium", l.calc.net_remaining < 0 && "text-rose-700")}>{money(l.calc.net_remaining)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Extras({ lines, onPick }: { lines: ComputedLine[]; onPick: (id: string) => void }) {
  const rows = lines
    .filter((l) => l.calc.extras_total > 0.005 || l.calc.deductions_total > 0.005)
    .sort((a, b) => b.calc.extras_total - a.calc.extras_total);
  if (rows.length === 0) return <Empty text="Henüz mesai, komisyon veya prim girilmedi." />;
  const tot = (f: (l: ComputedLine) => number) => rows.reduce((s, l) => s + f(l), 0);
  return (
    <table className="w-full text-sm">
      <thead className="text-[11px] uppercase tracking-wider text-muted-foreground">
        <tr className="border-b">
          <th className="py-1 text-left font-medium">Çalışan</th>
          <th className="py-1 text-right font-medium">Mesai</th>
          <th className="py-1 text-right font-medium">Komisyon</th>
          <th className="py-1 text-right font-medium">Primler</th>
          <th className="py-1 text-right font-medium">Kesinti</th>
          <th className="py-1 text-right font-medium">Ödeme 2</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((l) => {
          const prem = l.calc.perfume_amount + l.calc.garment_amount + l.calc.top_seller_amount + l.calc.extra_premium + l.calc.additions_total;
          return (
            <tr key={l.id} className="border-b last:border-0">
              <td className="py-1.5">
                <Name l={l} onPick={onPick} />
              </td>
              <td className="py-1.5 text-right tabular-nums">{l.calc.overtime_amount ? money(l.calc.overtime_amount) : "—"}</td>
              <td className="py-1.5 text-right tabular-nums">{l.calc.commission.final ? money(l.calc.commission.final) : "—"}</td>
              <td className="py-1.5 text-right tabular-nums">{prem ? money(prem) : "—"}</td>
              <td className="py-1.5 text-right tabular-nums text-rose-700">{l.calc.deductions_total ? `−${money(l.calc.deductions_total)}` : "—"}</td>
              <td className="py-1.5 text-right tabular-nums font-medium">{money(l.calc.payment2_due)}</td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr className="border-t font-semibold">
          <td className="py-1.5">Toplam</td>
          <td className="py-1.5 text-right tabular-nums">{money(tot((l) => l.calc.overtime_amount))}</td>
          <td className="py-1.5 text-right tabular-nums">{money(tot((l) => l.calc.commission.final))}</td>
          <td className="py-1.5 text-right tabular-nums">
            {money(tot((l) => l.calc.perfume_amount + l.calc.garment_amount + l.calc.top_seller_amount + l.calc.extra_premium + l.calc.additions_total))}
          </td>
          <td className="py-1.5 text-right tabular-nums text-rose-700">−{money(tot((l) => l.calc.deductions_total))}</td>
          <td className="py-1.5 text-right tabular-nums">{money(tot((l) => l.calc.payment2_due))}</td>
        </tr>
      </tfoot>
    </table>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">{text}</div>;
}
