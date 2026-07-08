"use client";

import { useState } from "react";
import {
  Loader2,
  Target,
  TrendingUp,
  CheckCircle2,
  AlertTriangle,
  Pencil,
  Check,
  X,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { NebimSalesSelection } from "./nebim-filters";

const TRY0 = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 });
const TRY2 = new Intl.NumberFormat("tr-TR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const fmt0 = (n: number) => `₺${TRY0.format(Math.round(n))}`;
const fmt2 = (n: number) => `₺${TRY2.format(n)}`;
const num2 = (n: number) => n.toFixed(2).replace(".", ",");

// Mağaza kimlik şeridi — sistem genelindeki renklerle aynı (Outlet/Filtre).
function storeStripe(name: string): string {
  const n = name.toLocaleLowerCase("tr").replace(/ı/g, "i");
  if (n.includes("lefkosa")) return "bg-blue-500";
  if (n.includes("girne")) return "bg-emerald-500";
  if (n.includes("magusa")) return "bg-amber-500";
  return "bg-slate-400";
}

/** HGO durumu — renk + ikon + etiket birlikte (renk tek başına asla). */
function hgoTone(pct: number): {
  cls: string;
  bar: string;
  icon: typeof TrendingUp;
} {
  if (pct >= 100)
    return { cls: "bg-emerald-50 text-emerald-700 border-emerald-200", bar: "bg-emerald-500", icon: CheckCircle2 };
  if (pct >= 85)
    return { cls: "bg-amber-50 text-amber-700 border-amber-200", bar: "bg-amber-500", icon: TrendingUp };
  return { cls: "bg-rose-50 text-rose-700 border-rose-200", bar: "bg-rose-500", icon: AlertTriangle };
}

export function NebimScorecard({ filters }: { filters: NebimSalesSelection }) {
  const input = {
    date_from: filters.dateFrom || undefined,
    date_to: filters.dateTo || undefined,
  };
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.nebimSales.storeScorecard.useQuery(input);
  const setTarget = trpc.nebimSales.setStoreTarget.useMutation({
    onSuccess: () => {
      utils.nebimSales.storeScorecard.invalidate();
      toast.success("Hedef kaydedildi");
    },
    onError: (e) => toast.error(e.message),
  });
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  if (isLoading || !data) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 mx-auto mb-2 animate-spin" />
          Mağaza karnesi hazırlanıyor…
        </CardContent>
      </Card>
    );
  }
  if (data.cards.length === 0) return null;

  const p = data.period;
  const saveTarget = (storeId: string) => {
    const v = Number(draft.replace(/[.\s]/g, "").replace(",", "."));
    if (!Number.isFinite(v) || v < 0) {
      toast.error("Geçerli bir tutar gir");
      return;
    }
    setTarget.mutate({
      store_id: storeId,
      year: p.year,
      month: p.month,
      target_try: v,
    });
    setEditing(null);
  };

  return (
    <div>
      <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-bold tracking-tight">Mağaza Karnesi</h2>
          <p className="text-[12px] text-muted-foreground">
            {p.is_full_month
              ? `${p.label} · net gelir, hedef gerçekleşme ve ay-sonu tahmini${
                  !p.month_done && p.elapsed_days > 0
                    ? ` (${p.elapsed_days}/${p.days_in_month}. gün)`
                    : ""
                }`
              : "Seçili dönem özeti — hedef takibi için Dönem'den “Ay” seç"}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {data.cards.map((c) => {
          const isEditing = editing === c.store_id;
          const pct = c.realized_pct;
          const fPct = c.forecast_pct;
          const tone = fPct != null ? hgoTone(fPct) : pct != null ? hgoTone(pct) : null;
          const ToneIcon = tone?.icon ?? TrendingUp;
          return (
            <Card key={c.store_id} className="overflow-hidden">
              <div className={`h-1.5 ${storeStripe(c.store)}`} />
              <CardContent className="p-5 space-y-4">
                {/* Başlık */}
                <div className="flex items-center justify-between">
                  <span className="font-bold text-base">{c.store}</span>
                  {c.code ? (
                    <span className="rounded-full border border-border px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                      {c.code}
                    </span>
                  ) : null}
                </div>

                {/* Net gelir + birimler */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Net Gelir
                    </div>
                    <div className="text-2xl font-bold tabular-nums mt-0.5">
                      {fmt2(c.net)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Satılan Birim (net)
                    </div>
                    <div className="text-2xl font-bold tabular-nums mt-0.5">
                      {c.net_units}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      Brüt {c.gross_units} · İade {c.return_units} ·{" "}
                      <span className="font-semibold text-foreground/80">
                        UPT {num2(c.upt)}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="text-[11px] text-muted-foreground -mt-2">
                  {c.invoices} fiş · ort. sepet {fmt0(c.avg_basket)}
                </div>

                {/* Hedef bloğu — sadece tam ay dönemde */}
                {p.is_full_month ? (
                  <div className="rounded-xl border border-border/60 bg-muted/30 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                        <Target className="h-3.5 w-3.5" />
                        Aylık Hedef
                      </span>
                      {pct != null ? (
                        <span className="text-sm font-bold tabular-nums">
                          %{pct.toFixed(1).replace(".", ",")}
                        </span>
                      ) : null}
                    </div>

                    {isEditing ? (
                      <div className="flex items-center gap-1.5">
                        <Input
                          autoFocus
                          className="h-8 text-sm"
                          placeholder="örn 3.200.000"
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveTarget(c.store_id);
                            if (e.key === "Escape") setEditing(null);
                          }}
                        />
                        <Button size="sm" className="h-8 w-8 p-0" onClick={() => saveTarget(c.store_id)}>
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => setEditing(null)}>
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : c.target != null ? (
                      <>
                        <div className="h-2 rounded-full bg-border/60 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${tone?.bar ?? "bg-primary"}`}
                            style={{ width: `${Math.min(pct ?? 0, 100)}%` }}
                          />
                        </div>
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="tabular-nums text-muted-foreground">
                            {fmt2(c.target)}
                          </span>
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                            onClick={() => {
                              setDraft(String(Math.round(c.target ?? 0)));
                              setEditing(c.store_id);
                            }}
                          >
                            <Pencil className="h-3 w-3" /> düzenle
                          </button>
                        </div>
                        {c.forecast != null && tone ? (
                          <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/50">
                            <span className="text-[11px] text-muted-foreground">
                              {p.month_done ? "Ay kapandı" : "Ay-sonu tahmini:"}{" "}
                              <span className="font-semibold text-foreground tabular-nums">
                                {fmt0(c.forecast)}
                              </span>
                            </span>
                            {fPct != null ? (
                              <span
                                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${tone.cls}`}
                              >
                                <ToneIcon className="h-3.5 w-3.5" />
                                {p.month_done ? "HGO" : "Tahmini HGO"} %
                                {fPct.toFixed(1).replace(".", ",")}
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 w-full text-xs"
                        onClick={() => {
                          setDraft("");
                          setEditing(c.store_id);
                        }}
                      >
                        <Target className="h-3.5 w-3.5 mr-1.5" /> Hedef belirle
                      </Button>
                    )}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
