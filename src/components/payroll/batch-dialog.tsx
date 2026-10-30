"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BATCH_KIND_LABEL, CHANNEL_SHORT, money, todayIso, triggerDownload } from "./format";
import { selectedItems } from "./batch-select";
import { BatchDialogView } from "./batch-dialog-view";

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
  kolayik_request?: number | null;
  kolayik_date?: string | null;
  kolayik_recorded?: number | null;
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
        // Hazırlanmış, gönderilmemiş talimatı olan kişi seçili gelmez (çift ödeme olmasın).
        // Avans: Kolay İK'da onaylı talebi olanlar seçili ve tutarı dolu gelir; tutar değiştirilebilir.
        const req = choice.kind === "advance" ? (row.kolayik_request ?? null) : null;
        ck[row.line_id] = !row.pending_note && (choice.kind !== "advance" || req != null);
        am[row.line_id] = choice.kind === "advance" ? (req ?? undefined) : row.due;
      }
      setChecked(ck);
      setAmounts(am);
      if ("kolayik_error" in r && r.kolayik_error) toast.warning(`Kolay İK talepleri okunamadı: ${r.kolayik_error}`);
      else if (choice.kind === "advance") {
        const n = r.rows.filter((x) => x.kolayik_request != null).length;
        if (n) toast.success(`Kolay İK'dan ${n} onaylı avans talebi dolu geldi`);
      }
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
  const isGaranti = choice.channel === "garanti";
  const isPayment2 = choice.kind === "payment2";
  // Ödeme 2 nakit: mağaza mağaza kaydedilir (sahibi, 05.10.2026)
  const perStore = isPayment2 && choice.channel === "cash";
  const busy = create.isPending || createStore.isPending;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[92vh] max-w-5xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="px-6 pb-3 pt-6">
          <DialogTitle>
            {BATCH_KIND_LABEL[choice.kind]} · {CHANNEL_SHORT[choice.channel]} · {periodLabel}
          </DialogTitle>
          <DialogDescription>
            {isGaranti
              ? "Garanti \"TGB Yeni Maaş Dosyası\" formatında talimat üretilir. Kişileri ve tutarları kontrol et; dosyayı bankaya e-posta ile gönder, ödeme gerçekleşince \"Gönderildi / ödendi\" işaretle."
              : perStore
                ? "Ödeme 2 herkese nakit ödenir; maaşını bankadan alanlar da bu listededir. Bir mağazayı ödeyince o mağazanın \"Bu mağaza ödendi\" düğmesine bas: yalnız o mağazanın kişileri bu tarihle nakit ödendi olarak kaydedilir, pencere açık kalır. Yanlış kayıt, sayfadaki \"Talimatlar ve listeler\" bölümünden İptal ile geri alınır."
                : "Dosya üretilmez. Seçilen kişilerin ödemesi bu tarihle kaydedilir; kalan maaşları sıfırlanır."}
          </DialogDescription>
        </DialogHeader>
        <BatchDialogView
          choice={choice}
          rows={rows}
          prepareError={prepare.isError ? prepare.error.message : null}
          checked={checked}
          amounts={amounts}
          payDate={payDate}
          markSent={markSent}
          storeOrder={storeOrder}
          done={done}
          savingStore={savingStore}
          busy={busy}
          result={result}
          onPayDate={setPayDate}
          onMarkSent={setMarkSent}
          onToggle={(id, v) => setChecked((c) => ({ ...c, [id]: v }))}
          onToggleMany={(ids, v) =>
            setChecked((c) => {
              const n = { ...c };
              for (const id of ids) n[id] = v;
              return n;
            })
          }
          onAmount={(id, v) => setAmounts((m) => ({ ...m, [id]: v }))}
          onPayStore={payStore}
          onCreate={() => create.mutate({ period_id: periodId, kind: choice.kind, channel: choice.channel, pay_date: payDate, items, mark_sent: markSent })}
          onClose={onClose}
          onDownloadAgain={() => result?.file_base64 && result.file_name && triggerDownload(result.file_base64, result.file_name)}
        />
      </DialogContent>
    </Dialog>
  );
}
