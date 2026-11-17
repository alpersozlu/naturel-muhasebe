"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, FileQuestion, Info } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { money, dmy } from "./voucher-scan";

/**
 * MAĞAZA ÖZETİ MUTABAKATI — GÜNLER ARASI (sahibi, 17.11.2026).
 *
 * Nebim özeti o gün kasadan geçen hediye çekini yazar ve bunu YALNIZ barkodlu
 * çekler için yapabilir. Gün gün karta bakmak yerine, tutmayan günler burada
 * tek listede durur. Tutan günler listelenmez — liste boşsa her şey yerindedir.
 */

const RANGES = [
  { days: 30, label: "Son 30 gün" },
  { days: 60, label: "Son 60 gün" },
  { days: 90, label: "Son 90 gün" },
] as const;

const STATE = {
  missing: {
    Icon: AlertTriangle,
    dot: "text-amber-600",
    label: "Okutulmamış çek",
    hint: "Özette görünen çek sisteme girilmemiş.",
  },
  extra: {
    Icon: AlertTriangle,
    dot: "text-rose-600",
    label: "Fazla okutulmuş",
    hint: "Okutulan çek özetten fazla — başka güne ya da mağazaya ait olabilir.",
  },
  no_summary: {
    Icon: FileQuestion,
    dot: "text-muted-foreground",
    label: "Özet yok",
    hint: "Çek okutulmuş ama o günün mağaza özeti yüklenmemiş.",
  },
} as const;

export function GiftVoucherSummaryAudit() {
  const [days, setDays] = useState<number>(60);
  const audit = trpc.giftVoucher.summaryAudit.useQuery({ days });
  const d = audit.data;

  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">Mağaza özeti mutabakatı</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              Nebim özetindeki Hediye Çeki ile okutulan çekler karşılaştırılır. Tutan günler listelenmez.
            </div>
          </div>
          <div className="flex items-center gap-1">
            {RANGES.map((r) => (
              <button
                key={r.days}
                type="button"
                onClick={() => setDays(r.days)}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                  days === r.days
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card hover:bg-muted/50"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {audit.isLoading ? (
          <div className="px-5 py-6 text-sm text-muted-foreground">Yükleniyor…</div>
        ) : !d ? (
          <div className="px-5 py-6 text-sm text-muted-foreground">Denetim okunamadı.</div>
        ) : (
          <>
            {d.rows.length === 0 ? (
              <div className="flex items-start gap-2 px-5 py-6 text-sm">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                <span>
                  {d.checked > 0
                    ? `Karşılaştırılan ${d.checked} günün hepsinde özetteki hediye çeki okutulan çeklerle tutuyor.`
                    : "Karşılaştırılacak gün yok."}
                </span>
              </div>
            ) : (
              <ul className="divide-y text-sm">
                {d.rows.map((r) => {
                  const m = STATE[r.state as keyof typeof STATE] ?? STATE.no_summary;
                  return (
                    <li key={`${r.store_id}|${r.from}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
                      <m.Icon className={`h-4 w-4 shrink-0 ${m.dot}`} />
                      <span className="w-40 tabular-nums">
                        {r.merged ? `${dmy(r.from)} – ${dmy(r.to)}` : dmy(r.from)}
                      </span>
                      <span className="w-40 truncate font-medium">{r.store_name}</span>
                      <span className="min-w-0 flex-1 text-muted-foreground">
                        Özet{" "}
                        <b className="tabular-nums text-foreground">
                          {r.summary_total == null ? "—" : `${money(r.summary_total)} ₺`}
                        </b>{" "}
                        · okutulan{" "}
                        <b className="tabular-nums text-foreground">
                          {money(r.scanned_total)} ₺ ({r.scanned_count})
                        </b>
                        {r.state === "no_summary" ? null : (
                          <>
                            {" "}
                            · fark{" "}
                            <b className="tabular-nums text-foreground">{money(Math.abs(r.diff))} ₺</b>
                          </>
                        )}
                      </span>
                      <span className={`shrink-0 text-xs font-medium ${m.dot}`} title={m.hint}>
                        {m.label}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-5 py-3 text-xs text-muted-foreground">
              <span>
                {dmy(d.from)} – {dmy(d.to)} · karşılaştırılan {d.checked} gün, tutan {d.matched}
              </span>
              {d.unread > 0 ? (
                <span className="flex items-center gap-1.5">
                  <Info className="h-3.5 w-3.5" />
                  {d.unread} özet bu karşılaştırma eklenmeden önce okunmuş — yeniden analiz edilirse listeye girer.
                </span>
              ) : null}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
