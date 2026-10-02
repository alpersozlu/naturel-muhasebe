"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Download } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoneyInput } from "@/components/ui/money-input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BATCH_KIND_LABEL, CHANNEL_SHORT, money, todayIso, triggerDownload } from "./format";

export type BatchChoice = {
  kind: "advance" | "payment1" | "payment2" | "single";
  channel: "garanti" | "ziraat" | "cash";
};

type Row = {
  line_id: string;
  full_name: string;
  bank_name: string;
  store_name: string;
  base: number;
  advances: number;
  net_remaining: number;
  due: number;
  has_bank_details: boolean;
  note: string | null;
  for_next_month: boolean;
};

export function BatchDialog({
  periodId,
  periodLabel,
  choice,
  onClose,
  onCreated,
}: {
  periodId: string;
  periodLabel: string;
  choice: BatchChoice;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [amounts, setAmounts] = useState<Record<string, number | undefined>>({});
  const [payDate, setPayDate] = useState(todayIso());
  const [markSent, setMarkSent] = useState(choice.channel !== "garanti");
  const [result, setResult] = useState<{ file_name: string; file_base64: string; total: number; count: number } | null>(null);

  const prepare = trpc.payroll.batches.prepare.useMutation({
    onSuccess: (r) => {
      setRows(r.rows);
      const ck: Record<string, boolean> = {};
      const am: Record<string, number | undefined> = {};
      for (const row of r.rows) {
        ck[row.line_id] = choice.kind !== "advance";
        am[row.line_id] = choice.kind === "advance" ? undefined : row.due;
      }
      setChecked(ck);
      setAmounts(am);
    },
    onError: (e) => toast.error(e.message),
  });
  useEffect(() => {
    prepare.mutate({ period_id: periodId, kind: choice.kind, channel: choice.channel });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodId, choice.kind, choice.channel]);

  const create = trpc.payroll.batches.create.useMutation({
    onSuccess: (r) => {
      setResult(r);
      triggerDownload(r.file_base64, r.file_name);
      toast.success(`${r.count} kişi · ${money(r.total)} ₺ — dosya indirildi`);
      onCreated();
    },
    onError: (e) => toast.error(e.message),
  });

  const items = useMemo(
    () =>
      (rows ?? [])
        .filter((r) => checked[r.line_id] && (amounts[r.line_id] ?? 0) > 0)
        .map((r) => ({ line_id: r.line_id, amount: amounts[r.line_id]! })),
    [rows, checked, amounts]
  );
  const total = items.reduce((s, i) => s + i.amount, 0);
  const missingBank = (rows ?? []).filter((r) => checked[r.line_id] && !r.has_bank_details).length;
  const isGaranti = choice.channel === "garanti";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {BATCH_KIND_LABEL[choice.kind]} · {CHANNEL_SHORT[choice.channel]} · {periodLabel}
          </DialogTitle>
          <DialogDescription>
            {isGaranti
              ? "Garanti \"TGB Yeni Maaş Dosyası\" formatında talimat üretilir. Kişileri ve tutarları kontrol et; dosya inince bankaya yükle, sonra \"Gönderildi\" işaretle."
              : "İmza listesi (Excel) üretilir; ödemeler kaydedilir."}
            {choice.kind === "advance" ? " Avans tutarlarını elle gir; %50 sınırını geçenler işaretlenir." : ""}
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="rounded-xl border bg-emerald-50/50 p-4 text-sm space-y-2">
            <div className="font-medium text-emerald-800">Hazırlandı: {result.file_name}</div>
            <div>
              {result.count} kişi · toplam <b>{money(result.total)} ₺</b>
              {markSent
                ? " · ödendi olarak işlendi"
                : isGaranti
                  ? " · dosyayı Garanti'ye e-posta ile gönderin; ödeme gerçekleşince talimatlar listesinde \"Gönderildi / ödendi\" işaretleyin"
                  : " · ödeme yapılınca talimatlar listesinde \"Gönderildi / ödendi\" işaretleyin"}
            </div>
            <Button variant="outline" size="sm" onClick={() => triggerDownload(result.file_base64, result.file_name)}>
              <Download className="h-3.5 w-3.5 mr-1.5" />
              Tekrar indir
            </Button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Ödeme tarihi</Label>
                <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className="w-44" />
              </div>
              <label className="flex items-center gap-2 text-sm pb-2">
                <input type="checkbox" className="h-4 w-4" checked={markSent} onChange={(e) => setMarkSent(e.target.checked)} />
                Hemen &quot;ödendi&quot; say
              </label>
              <div className="ml-auto text-sm">
                <span className="text-muted-foreground">{items.length} kişi · </span>
                <b className="tabular-nums">{money(total)} ₺</b>
              </div>
            </div>

            {missingBank > 0 && isGaranti ? (
              <div className="flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">
                <AlertTriangle className="h-4 w-4" />
                {missingBank} kişinin şube/hesap bilgisi eksik — Personel sayfasından &quot;Hesapları talimattan aktar&quot; ile doldur.
              </div>
            ) : null}

            {!rows ? (
              <div className="text-sm text-muted-foreground">Hazırlanıyor…</div>
            ) : rows.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                Bu kanal için ödenecek kimse yok.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-2 pr-2 text-left">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={rows.every((r) => checked[r.line_id])}
                        onChange={(e) => {
                          const ck: Record<string, boolean> = {};
                          for (const r of rows) ck[r.line_id] = e.target.checked;
                          setChecked(ck);
                        }}
                      />
                    </th>
                    <th className="py-2 text-left font-medium">Çalışan</th>
                    <th className="py-2 text-right font-medium">Baz</th>
                    <th className="py-2 text-right font-medium">Avans</th>
                    <th className="py-2 text-right font-medium">Net kalan</th>
                    <th className="py-2 text-right font-medium">Tutar</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const a = amounts[r.line_id] ?? 0;
                    const high = choice.kind === "advance" && a > r.base * 0.5;
                    return (
                      <tr key={r.line_id} className={cn("border-b last:border-0", !checked[r.line_id] && "opacity-50")}>
                        <td className="py-2 pr-2">
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            checked={!!checked[r.line_id]}
                            onChange={(e) => setChecked((c) => ({ ...c, [r.line_id]: e.target.checked }))}
                          />
                        </td>
                        <td className="py-2">
                          <div className="font-medium">{r.full_name}</div>
                          <div className="text-[11px] text-muted-foreground">
                            {r.store_name}
                            {isGaranti ? ` · ${r.bank_name}` : ""}
                            {!r.has_bank_details && isGaranti ? " · hesap eksik" : ""}
                            {r.for_next_month ? " · gelecek ayın maaşı" : ""}
                          </div>
                          {r.note ? <div className="text-[11px] text-amber-800">{r.note}</div> : null}
                        </td>
                        <td className="py-2 text-right tabular-nums">{money(r.base)}</td>
                        <td className="py-2 text-right tabular-nums text-amber-800">{r.advances ? money(r.advances) : "—"}</td>
                        <td className="py-2 text-right tabular-nums">{money(r.net_remaining)}</td>
                        <td className="py-2 pl-3 text-right">
                          <MoneyInput
                            value={amounts[r.line_id]}
                            onChange={(v) => setAmounts((m) => ({ ...m, [r.line_id]: v }))}
                            className={cn("h-8 w-36 text-right", high && "border-rose-400")}
                            disabled={!checked[r.line_id]}
                          />
                          {high ? <div className="text-[10px] text-rose-700">netin %50&apos;sinden fazla</div> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {result ? "Kapat" : "Vazgeç"}
          </Button>
          {!result ? (
            <Button
              onClick={() =>
                create.mutate({ period_id: periodId, kind: choice.kind, channel: choice.channel, pay_date: payDate, items, mark_sent: markSent })
              }
              disabled={create.isPending || items.length === 0}
            >
              <Download className="h-4 w-4 mr-2" />
              Dosyayı oluştur ve indir
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
