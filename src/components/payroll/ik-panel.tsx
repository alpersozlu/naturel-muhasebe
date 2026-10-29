"use client";

import { toast } from "sonner";
import { AlertTriangle, ArrowRightLeft, Check, Loader2, RefreshCw, Stethoscope, Wallet } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const money = (v: number) => new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);

/**
 * NATUREL İK'DAN GELENLER — sahibinin İK'da verdiği devamsızlık kesintileri
 * ve nakde çevrilen izinler. Her kalem tek tıkla bordroya kayıt olur (bir kez);
 * İK'da geri alınan ama burada duran kayıt kırmızı uyarı olur.
 * Nakde çevrilen izni sahibi kendisi öder — varsayılan yalnız bilgi.
 */
export function IkPanel({ periodId, closed, onChanged }: { periodId: string; closed: boolean; onChanged: () => void }) {
  const q = trpc.payroll.ik.items.useQuery({ period_id: periodId }, { staleTime: 60_000, retry: false, refetchOnWindowFocus: false });
  const transfer = trpc.payroll.ik.transfer.useMutation({
    onSuccess: () => (toast.success("Bordroya eklendi"), void q.refetch(), onChanged()),
    onError: (e) => toast.error(e.message),
  });
  const d = q.data;
  if (!d || !d.configured) return null;
  const pending = d.items.filter((x) => x.state === "pending" && x.type === "absence_deduction");
  const stale = d.items.filter((x) => x.state === "stale");

  return (
    <section className="rounded-xl border bg-card px-4 py-3 text-sm shadow-xs">
      <div className="flex flex-wrap items-center gap-3">
        <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
        <span className="font-semibold tracking-tight">Naturel İK&apos;dan gelenler</span>
        <span className="text-muted-foreground">devamsızlık kesintisi · nakde çevrilen izin</span>
        {pending.length > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">{pending.length} aktarılmayı bekliyor</span>}
        {stale.length > 0 && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">{stale.length} iptal edilmeli</span>}
        <div className="ml-auto flex gap-2">
          {pending.length > 1 && !closed && (
            <Button size="sm" disabled={transfer.isPending} onClick={() => pending.forEach((x) => transfer.mutate({ period_id: periodId, item_id: x.id }))}>
              <Check className="mr-1 h-4 w-4" /> Kesintilerin hepsini ekle
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => void q.refetch()} disabled={q.isFetching} aria-label="Yenile">
            <RefreshCw className={cn("h-4 w-4", q.isFetching && "animate-spin")} />
          </Button>
        </div>
      </div>

      {d.error ? (
        <p className="mt-2 text-amber-800">İK okunamadı: {d.error}</p>
      ) : d.items.length === 0 ? (
        <p className="mt-2 text-muted-foreground">Bu ay için İK&apos;da devamsızlık kesintisi ya da nakde çevrilen izin yok.</p>
      ) : (
        <ul className="mt-3 divide-y rounded-lg border">
          {d.items.map((it) => {
            const absence = it.type === "absence_deduction";
            return (
              <li key={it.id} className={cn("flex flex-wrap items-center gap-3 px-3 py-2.5", it.state === "stale" && "bg-red-50")}>
                {absence ? <Stethoscope className="h-4 w-4 shrink-0 text-rose-600" /> : <Wallet className="h-4 w-4 shrink-0 text-emerald-600" />}
                <div className="min-w-0 flex-1">
                  <div className="font-medium">
                    {it.employeeName ?? "Bordroda bulunamadı"} ·{" "}
                    <span className={absence ? "text-rose-700" : "text-emerald-700"}>
                      {absence ? "−" : ""}
                      {money(it.amount)} ₺
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">{it.entryNote}</div>
                  {it.state === "stale" && (
                    <div className="mt-0.5 flex items-center gap-1 text-xs font-medium text-red-700">
                      <AlertTriangle className="h-3 w-3" /> İK&apos;da geri alındı — bordrodaki kaydı satırın kayıtlarından iptal edin.
                    </div>
                  )}
                  {!absence && it.state === "pending" && (
                    <div className="mt-0.5 text-xs text-emerald-800">Bilgi: bu tutarı siz ödüyorsunuz. Maaşla ödenecekse ek hak ediş olarak ekleyin.</div>
                  )}
                </div>
                {it.state === "transferred" ? (
                  <span className="flex items-center gap-1 text-xs font-medium text-emerald-700">
                    <Check className="h-4 w-4" /> bordroda
                  </span>
                ) : it.state === "pending" && !closed && it.lineId ? (
                  <Button
                    size="sm"
                    variant={absence ? "default" : "outline"}
                    disabled={transfer.isPending}
                    onClick={() => transfer.mutate({ period_id: periodId, item_id: it.id })}
                  >
                    {transfer.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : absence ? "Kesinti olarak ekle" : "Maaşla öde (ek)"}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
