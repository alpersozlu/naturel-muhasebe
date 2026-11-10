"use client";

import { toast } from "sonner";
import { Download } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import type { PeriodView } from "@/server/services/payroll/period";
import { BATCH_STATUS_LABEL, CHANNEL_SHORT, dmy, money, triggerDownload } from "../format";
import { Chip } from "./parts";

type Batch = PeriodView["batches"][number];

/** Kısa tür adları — adımların adlarıyla aynı. */
const KIND: Record<Batch["kind"], string> = { advance: "Avans", payment1: "Maaş (Ödeme 1)", payment2: "Prim (Ödeme 2)", single: "Tekil ödeme" };

/**
 * Talimatlar ve listeler. Her adım yalnız kendi türünü gösterir (avans /
 * maaş / prim); Kapanış adımı hepsini. İptal edilmiş talimatlar varsayılan
 * olarak gizlidir — tarihçe "iptal edilenler" altında durur.
 */
export function BatchList({
  data,
  kinds,
  title = "Talimatlar ve listeler",
  onChanged,
}: {
  data: PeriodView;
  kinds?: Array<Batch["kind"]>;
  title?: string;
  onChanged: () => void;
}) {
  const confirm = useConfirm();
  const download = trpc.payroll.batches.download.useMutation({
    onSuccess: (r) => triggerDownload(r.file_base64, r.file_name),
    onError: (e) => toast.error(e.message),
  });
  const setStatus = trpc.payroll.batches.setStatus.useMutation({
    onSuccess: () => {
      toast.success("Talimat güncellendi");
      onChanged();
    },
    onError: (e) => toast.error(e.message),
  });
  const all = data.batches.filter((b) => !kinds || kinds.includes(b.kind));
  const live = all.filter((b) => b.status !== "void");
  const voided = all.filter((b) => b.status === "void");
  if (all.length === 0) return null;
  const closed = data.period.status === "closed";

  const row = (b: Batch) => (
    <li key={b.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 text-sm">
      <Chip tone={b.status === "sent" ? "ok" : b.status === "void" ? "muted" : "wait"}>
        {b.status === "sent" && b.channel !== "garanti" ? "Ödendi" : BATCH_STATUS_LABEL[b.status]}
      </Chip>
      <div className="min-w-0">
        <div className="font-medium">
          {KIND[b.kind]} · {CHANNEL_SHORT[b.channel]}
          {b.stores.length === 1 ? ` · ${b.stores[0]}` : ""}
        </div>
        <div className="text-sm text-muted-foreground">
          {dmy(b.pay_date)} · {b.count} kişi{b.file_name ? ` · ${b.file_name}` : ""}
        </div>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <span className="mr-2 font-semibold tabular-nums">{money(b.total)} ₺</span>
        {b.file_name ? (
          <Button size="sm" variant="outline" onClick={() => download.mutate({ id: b.id })} disabled={download.isPending}>
            <Download className="mr-1.5 h-3.5 w-3.5" />
            İndir
          </Button>
        ) : null}
        {b.status === "prepared" && !closed ? (
          <Button size="sm" onClick={() => setStatus.mutate({ id: b.id, status: "sent" })} disabled={setStatus.isPending}>
            Gönderildi / ödendi
          </Button>
        ) : null}
        {b.status !== "void" && !closed ? (
          <Button
            size="sm"
            variant="ghost"
            className="text-rose-700 hover:text-rose-800"
            onClick={async () => {
              const ok = await confirm({
                title: "Talimat iptal edilsin mi?",
                description: `${KIND[b.kind]} · ${CHANNEL_SHORT[b.channel]} · ${b.count} kişi · ${money(b.total)} ₺\nBu talimatın bütün ödeme kayıtları iptal edilir (silinmez, tarihçede kalır).`,
                confirmLabel: "İptal et",
                destructive: true,
              });
              if (ok) setStatus.mutate({ id: b.id, status: "void", note: "Talimat iptal edildi" });
            }}
          >
            İptal
          </Button>
        ) : null}
      </div>
      {b.kind === "payment2" && b.status === "prepared" && b.channel !== "cash" ? (
        <div className="basis-full text-sm text-amber-900">
          Ödeme 2 nakit ödenir. Bu talimat bankaya gönderilmediyse iptal edin; kişi nakit listesinde çıkar.
        </div>
      ) : null}
    </li>
  );

  return (
    <section className="overflow-hidden rounded-2xl border bg-card shadow-xs">
      <header className="flex items-center gap-3 border-b px-5 py-3.5">
        <h3 className="font-semibold tracking-tight">{title}</h3>
        <span className="text-sm text-muted-foreground">{live.length} kayıt</span>
      </header>
      {live.length ? <ul className="divide-y">{live.map(row)}</ul> : <div className="px-5 py-4 text-sm text-muted-foreground">Geçerli talimat yok.</div>}
      {voided.length ? (
        <details className="border-t">
          <summary className="cursor-pointer px-5 py-2.5 text-sm text-muted-foreground hover:text-foreground">İptal edilenler ({voided.length})</summary>
          <ul className="divide-y border-t opacity-70">{voided.map(row)}</ul>
        </details>
      ) : null}
    </section>
  );
}
