"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Check, Download } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoneyInput } from "@/components/ui/money-input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BATCH_KIND_LABEL, CHANNEL_SHORT, money, todayIso, triggerDownload } from "./format";
import { groupByStore, selectedItems, sumAmounts } from "./batch-select";

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
  extras: number;
  deductions: number;
  net_remaining: number;
  due: number;
  has_bank_details: boolean;
  note: string | null;
  for_next_month: boolean;
  pending_prepared: number;
  pending_note: string | null;
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
  const [result, setResult] = useState<{ file_name: string | null; file_base64: string | null; total: number; count: number } | null>(null);
  // Mağaza mağaza kayıt (Ödeme 2 nakit): mağaza sırası, bu pencerede işlenenler, o an kaydedilen mağaza
  const [storeOrder, setStoreOrder] = useState<string[]>([]);
  const [done, setDone] = useState<Record<string, { count: number; total: number }>>({});
  const [savingStore, setSavingStore] = useState<string | null>(null);

  const prepare = trpc.payroll.batches.prepare.useMutation({
    onSuccess: (r) => {
      setRows(r.rows);
      setStoreOrder(Array.from(new Set(r.rows.map((x) => x.store_name))));
      const ck: Record<string, boolean> = {};
      const am: Record<string, number | undefined> = {};
      for (const row of r.rows) {
        // Hazırlanmış, gönderilmemiş talimatı olan kişi seçili gelmez (çift ödeme olmasın)
        ck[row.line_id] = choice.kind !== "advance" && !row.pending_note;
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
      if (r.file_base64 && r.file_name) {
        triggerDownload(r.file_base64, r.file_name);
        toast.success(`${r.count} kişi · ${money(r.total)} ₺ — dosya indirildi`);
      } else {
        toast.success(`${r.count} kişi · ${money(r.total)} ₺ — ödendi olarak işlendi`);
      }
      onCreated();
    },
    onError: (e) => toast.error(e.message),
  });

  // Tek mağazanın kaydı: pencere açık kalır, o mağazanın satırları listeden çıkar
  const createStore = trpc.payroll.batches.create.useMutation({ onError: (e) => toast.error(e.message) });
  const payStore = async (store: string) => {
    const storeItems = selectedItems(rows ?? [], checked, amounts, store);
    if (storeItems.length === 0 || savingStore) return;
    setSavingStore(store);
    try {
      const r = await createStore.mutateAsync({
        period_id: periodId,
        kind: choice.kind,
        channel: choice.channel,
        pay_date: payDate,
        items: storeItems,
        mark_sent: true,
      });
      const ids = new Set(storeItems.map((i) => i.line_id));
      setRows((rs) => (rs ?? []).filter((x) => !ids.has(x.line_id)));
      setDone((d) => ({ ...d, [store]: { count: (d[store]?.count ?? 0) + r.count, total: (d[store]?.total ?? 0) + r.total } }));
      toast.success(`${store}: ${r.count} kişi · ${money(r.total)} ₺ — ödendi olarak işlendi`);
      onCreated(); // sayfa yenilensin (pencere kapatılmış olsa bile kayıt yazıldı)
    } catch {
      // hata bildirimi yukarıdaki onError'da; satırlar yerinde kalır
    } finally {
      setSavingStore(null);
    }
  };

  const items = useMemo(() => selectedItems(rows ?? [], checked, amounts), [rows, checked, amounts]);
  const total = sumAmounts(items);
  const groups = useMemo(() => groupByStore(rows ?? [], storeOrder), [rows, storeOrder]);
  // Nakit dağıtımı için: seçili tutarların mağaza mağaza toplamı
  const storeChips = groups
    .map((g) => {
      const sel = selectedItems(g.rows, checked, amounts);
      return { store: g.store, count: sel.length, total: sumAmounts(sel) };
    })
    .filter((c) => c.count > 0);
  const doneStores = storeOrder.filter((s) => done[s]);
  const doneCount = doneStores.reduce((s, k) => s + done[k].count, 0);
  const doneTotal = sumAmounts(doneStores.map((k) => ({ amount: done[k].total })));
  const missingBank = (rows ?? []).filter((r) => checked[r.line_id] && !r.has_bank_details).length;
  const isGaranti = choice.channel === "garanti";
  const isPayment2 = choice.kind === "payment2";
  // Ödeme 2 nakit: mağaza mağaza kaydedilir (sahibi, 05.10.2026)
  const perStore = isPayment2 && choice.channel === "cash";
  const busy = create.isPending || createStore.isPending;
  const colCount = isPayment2 ? 6 : 7;

  const renderRow = (r: Row) => {
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
          {r.pending_note ? <div className="text-[11px] text-rose-700">{r.pending_note}</div> : null}
        </td>
        <td className="py-2 text-right tabular-nums">{money(isPayment2 ? r.extras : r.base)}</td>
        {!isPayment2 ? <td className="py-2 text-right tabular-nums text-amber-800">{r.advances ? money(r.advances) : "—"}</td> : null}
        <td className="py-2 text-right tabular-nums text-rose-700">{r.deductions ? `−${money(r.deductions)}` : "—"}</td>
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
  };

  const donePill = (store: string) => (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-200/70 tabular-nums">
      <Check className="h-3 w-3" />
      ödendi olarak işlendi: {done[store].count} kişi · {money(done[store].total)} ₺
    </span>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {BATCH_KIND_LABEL[choice.kind]} · {CHANNEL_SHORT[choice.channel]} · {periodLabel}
          </DialogTitle>
          <DialogDescription>
            {isGaranti
              ? "Garanti \"TGB Yeni Maaş Dosyası\" formatında talimat üretilir. Kişileri ve tutarları kontrol et; dosyayı bankaya e-posta ile gönder, ödeme gerçekleşince \"Gönderildi / ödendi\" işaretle."
              : perStore
                ? "Ödeme 2 herkese nakit ödenir; maaşını bankadan alanlar da bu listededir. Bir mağazayı ödeyince o mağazanın \"Bu mağaza ödendi\" düğmesine bas: yalnız o mağazanın kişileri bu tarihle nakit ödendi olarak kaydedilir, pencere açık kalır. Yanlış kayıt, sayfadaki \"Talimatlar ve listeler\" bölümünden İptal ile geri alınır."
                : "Dosya üretilmez. Seçilen kişilerin ödemesi bu tarihle kaydedilir; kalan maaşları sıfırlanır."}
            {isPayment2
              ? " Ödeme 2 = mesai + komisyon + primler − kesintiler (kasa eksiği, fiyat farkı, faturasız masraf kişi penceresinden kesinti olarak girilir)."
              : ""}
            {choice.kind === "advance" ? " Avans tutarlarını elle gir; %50 sınırını geçenler işaretlenir." : ""}
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="rounded-xl border bg-emerald-50/50 p-4 text-sm space-y-2">
            <div className="font-medium text-emerald-800">{result.file_name ? `Hazırlandı: ${result.file_name}` : "Ödendi olarak işlendi"}</div>
            <div>
              {result.count} kişi · toplam <b>{money(result.total)} ₺</b>
              {markSent
                ? " · ödendi olarak işlendi"
                : isGaranti
                  ? " · dosyayı Garanti'ye e-posta ile gönderin; ödeme gerçekleşince talimatlar listesinde \"Gönderildi / ödendi\" işaretleyin"
                  : " · ödeme yapılınca talimatlar listesinde \"Gönderildi / ödendi\" işaretleyin"}
            </div>
            {doneCount > 0 ? (
              <div className="text-muted-foreground">
                Bu pencerede daha önce mağaza mağaza işlenen: {doneCount} kişi · {money(doneTotal)} ₺
              </div>
            ) : null}
            {result.file_base64 && result.file_name ? (
              <Button variant="outline" size="sm" onClick={() => triggerDownload(result.file_base64!, result.file_name!)}>
                <Download className="h-3.5 w-3.5 mr-1.5" />
                Tekrar indir
              </Button>
            ) : null}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Ödeme tarihi</Label>
                <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className="w-44" />
              </div>
              {isGaranti ? (
                <label className="flex items-center gap-2 text-sm pb-2">
                  <input type="checkbox" className="h-4 w-4" checked={markSent} onChange={(e) => setMarkSent(e.target.checked)} />
                  Hemen &quot;ödendi&quot; say
                </label>
              ) : (
                <span className="pb-2 text-sm text-muted-foreground">Kaydedilince ödendi sayılır</span>
              )}
              <div className="ml-auto text-right text-sm">
                <div>
                  <span className="text-muted-foreground">
                    {perStore ? "ödenecek " : ""}
                    {items.length} kişi ·{" "}
                  </span>
                  <b className="tabular-nums">{money(total)} ₺</b>
                </div>
                {doneCount > 0 ? (
                  <div className="text-xs text-emerald-700 tabular-nums">
                    işlenen {doneCount} kişi · {money(doneTotal)} ₺
                  </div>
                ) : null}
              </div>
            </div>

            {choice.channel === "cash" && !perStore && storeChips.length > 1 ? (
              <div className="flex flex-wrap gap-2 text-xs">
                {storeChips.map((c) => (
                  <span key={c.store} className="rounded-full bg-muted px-2.5 py-1 tabular-nums">
                    {c.store}: {c.count} kişi · <b>{money(c.total)} ₺</b>
                  </span>
                ))}
              </div>
            ) : null}

            {missingBank > 0 && isGaranti ? (
              <div className="flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">
                <AlertTriangle className="h-4 w-4" />
                {missingBank} kişinin şube/hesap bilgisi eksik — Personel sayfasından &quot;Hesapları talimattan aktar&quot; ile doldur.
              </div>
            ) : null}

            {!rows ? (
              prepare.isError ? (
                <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{prepare.error.message}</div>
              ) : (
                <div className="text-sm text-muted-foreground">Hazırlanıyor…</div>
              )
            ) : rows.length === 0 && doneCount > 0 ? (
              <div className="rounded-xl border bg-emerald-50/50 p-4 text-sm space-y-2">
                <div className="font-medium text-emerald-800">Listedeki herkes ödendi olarak işlendi</div>
                <div>
                  {doneCount} kişi · toplam <b className="tabular-nums">{money(doneTotal)} ₺</b>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  {doneStores.map((s) => (
                    <span key={s} className="rounded-full bg-background px-2.5 py-1 tabular-nums ring-1 ring-emerald-200/70">
                      {s}: {done[s].count} kişi · {money(done[s].total)} ₺
                    </span>
                  ))}
                </div>
              </div>
            ) : rows.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                {isPayment2 ? "Ödeme 2'si bekleyen kimse yok." : "Bu kanal için ödenecek kimse yok."}
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
                    <th className="py-2 text-right font-medium">{isPayment2 ? "Ekstra" : "Baz"}</th>
                    {!isPayment2 ? <th className="py-2 text-right font-medium">Avans</th> : null}
                    <th className="py-2 text-right font-medium">Kesinti</th>
                    <th className="py-2 text-right font-medium">Net kalan</th>
                    <th className="py-2 text-right font-medium">Tutar</th>
                  </tr>
                </thead>
                <tbody>
                  {perStore
                    ? groups
                        .filter((g) => g.rows.length > 0 || done[g.store])
                        .map((g) => {
                          const sel = selectedItems(g.rows, checked, amounts);
                          return (
                            <Fragment key={g.store}>
                              <tr className="border-b bg-muted/40">
                                <td className="py-2 pr-2">
                                  {g.rows.length > 0 ? (
                                    <input
                                      type="checkbox"
                                      className="h-4 w-4"
                                      title={`${g.store}: hepsini seç / bırak`}
                                      checked={g.rows.every((r) => checked[r.line_id])}
                                      onChange={(e) =>
                                        setChecked((c) => {
                                          const n = { ...c };
                                          for (const r of g.rows) n[r.line_id] = e.target.checked;
                                          return n;
                                        })
                                      }
                                    />
                                  ) : null}
                                </td>
                                <td colSpan={colCount - 1} className="py-2">
                                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                    <span className="font-semibold">{g.store}</span>
                                    {g.rows.length > 0 ? (
                                      <span className="text-xs text-muted-foreground tabular-nums">
                                        {sel.length} kişi · <b className="text-foreground">{money(sumAmounts(sel))} ₺</b>
                                      </span>
                                    ) : null}
                                    {done[g.store] ? donePill(g.store) : null}
                                    {g.rows.length > 0 ? (
                                      <Button
                                        size="sm"
                                        variant="secondary"
                                        className="ml-auto"
                                        onClick={() => payStore(g.store)}
                                        disabled={busy || sel.length === 0}
                                      >
                                        <Check className="h-3.5 w-3.5 mr-1.5" />
                                        {savingStore === g.store ? "Kaydediliyor…" : "Bu mağaza ödendi"}
                                      </Button>
                                    ) : null}
                                  </div>
                                </td>
                              </tr>
                              {g.rows.map(renderRow)}
                            </Fragment>
                          );
                        })
                    : rows.map(renderRow)}
                </tbody>
              </table>
            )}
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {result || doneCount > 0 ? "Kapat" : "Vazgeç"}
          </Button>
          {!result && !(rows && rows.length === 0) ? (
            <Button
              onClick={() =>
                create.mutate({ period_id: periodId, kind: choice.kind, channel: choice.channel, pay_date: payDate, items, mark_sent: markSent })
              }
              disabled={busy || items.length === 0}
            >
              {isGaranti ? <Download className="h-4 w-4 mr-2" /> : <Check className="h-4 w-4 mr-2" />}
              {isGaranti ? "Dosyayı oluştur ve indir" : perStore ? "Seçili herkesi ödendi olarak işle" : "Ödendi olarak işle"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
