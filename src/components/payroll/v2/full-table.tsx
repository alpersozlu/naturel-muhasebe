"use client";

import { cn } from "@/lib/utils";
import type { PeriodView } from "@/server/services/payroll/period";
import { PAY_METHOD_SHORT } from "@/server/services/payroll/rules";
import { money } from "../format";
import { Chip, Dash, otherPremiums, ROW, StepHeader, StoreShell, TD, TH } from "./parts";

/**
 * TÜM TABLO — ayın bütün kalemleri kişi kişi, tek tabloda (eski master
 * çalışma kitabının karşılığı). Yalnız okunur; satıra tıklayınca kişi paneli
 * açılır. Günlük iş adımlarda yapılır, burası toplu bakış içindir.
 */
export function FullTable({ data, onOpenLine }: { data: PeriodView; onOpenLine: (id: string) => void }) {
  return (
    <div className="space-y-5">
      <StepHeader title="Tüm tablo" description="Ayın bütün kalemleri kişi kişi: hak ediş, ödenen ve kalan. Satıra tıklayınca kişinin paneli açılır." />
      {data.stores.map((s) => {
        if (s.lines.length === 0) return null;
        return (
          <StoreShell
            key={s.store_id}
            title={s.store_name}
            subtitle={`${s.lines.length} kişi`}
            right={
              <dl className="flex gap-6 text-right text-sm">
                <Tot label="Hak ediş" v={s.totals.gross} />
                <Tot label="Ödenen" v={s.totals.paid} />
                <Tot label="Kalan" v={s.totals.remaining} tone={Math.abs(s.totals.remaining) > 0.5 ? "text-amber-800" : "text-emerald-700"} />
              </dl>
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1120px] table-fixed text-sm">
                <thead>
                  <tr>
                    <th className={TH}>Çalışan</th>
                    <th className={cn(TH, "w-[9%]")}>Baz</th>
                    <th className={cn(TH, "w-[9%]")}>Mesai</th>
                    <th className={cn(TH, "w-[9%]")}>Satış primi</th>
                    <th className={cn(TH, "w-[9%]")}>Diğer prim</th>
                    <th className={cn(TH, "w-[9%]")}>Ekleme</th>
                    <th className={cn(TH, "w-[9%]")}>Kesinti</th>
                    <th className={cn(TH, "w-[9%]")}>Hak ediş</th>
                    <th className={cn(TH, "w-[9%]")}>Ödenen</th>
                    <th className={cn(TH, "w-[9%]")}>Kalan</th>
                  </tr>
                </thead>
                <tbody>
                  {s.lines.map((l) => {
                    const c = l.calc;
                    const zero = Math.abs(c.net_remaining) <= 0.5;
                    const other = otherPremiums(c);
                    return (
                      <tr key={l.id} className={cn(ROW, l.employee_status !== "active" && "text-muted-foreground")} tabIndex={0} onClick={() => onOpenLine(l.id)} onKeyDown={(e) => e.key === "Enter" && onOpenLine(l.id)}>
                        <td className={TD}>
                          <div className="font-medium">{l.full_name}</div>
                          <div className="text-sm text-muted-foreground">
                            {l.position} · {PAY_METHOD_SHORT[l.pay_method]}
                            {l.employee_status === "left" ? " · ayrıldı" : l.employee_status === "inactive" ? " · pasif" : ""}
                          </div>
                        </td>
                        <td className={TD}>{l.base_salary > 0 ? money(l.base_salary) : <Dash />}</td>
                        <td className={TD}>{c.overtime_amount > 0.005 ? money(c.overtime_amount) : <Dash />}</td>
                        <td className={TD}>{c.commission.final > 0.005 ? money(c.commission.final) : <Dash />}</td>
                        <td className={TD}>{other > 0.005 ? money(other) : <Dash />}</td>
                        <td className={cn(TD, c.additions_total > 0.005 && "text-emerald-700")}>{c.additions_total > 0.005 ? money(c.additions_total) : <Dash />}</td>
                        <td className={cn(TD, c.deductions_total > 0.005 && "text-rose-700")}>{c.deductions_total > 0.005 ? `− ${money(c.deductions_total)}` : <Dash />}</td>
                        <td className={cn(TD, "font-semibold")}>{money(c.gross)}</td>
                        <td className={TD}>{money(c.paid_total)}</td>
                        <td className={TD}>{zero ? <Chip tone="ok">0,00</Chip> : <span className={cn("font-semibold", c.net_remaining < 0 ? "text-rose-700" : "text-amber-800")}>{c.net_remaining < 0 ? "− " : ""}{money(Math.abs(c.net_remaining))}</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </StoreShell>
        );
      })}
    </div>
  );
}

function Tot({ label, v, tone }: { label: string; v: number; tone?: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={cn("font-semibold tabular-nums", tone)}>{money(v)}</dd>
    </div>
  );
}
