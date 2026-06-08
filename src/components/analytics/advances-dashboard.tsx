"use client";

import { Wallet, User, CalendarDays, Store as StoreIcon } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { ChartSkeleton } from "@/components/shared/skeleton";

const TRY2 = new Intl.NumberFormat("tr-TR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const fmt = (n: number) => `${TRY2.format(n)} ₺`;

const STAFF_ROLE_LABEL: Record<string, string> = {
  manager: "Müdür",
  assistant_manager: "Müdür Yardımcısı",
  sales_staff: "Satış Elemanı",
};

const ROLE_TONE: Record<string, string> = {
  manager: "bg-violet-100 text-violet-700",
  assistant_manager: "bg-blue-100 text-blue-700",
  sales_staff: "bg-emerald-100 text-emerald-700",
};

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

export function AdvancesDashboard({
  brandId,
  storeId,
  year,
  month,
}: {
  brandId: string;
  storeId: string;
  year: number;
  month: number;
}) {
  const { data, isLoading } = trpc.analytics.advances.useQuery({
    brand_id: brandId || undefined,
    store_id: storeId || undefined,
    year,
    month,
  });

  if (isLoading) {
    return <ChartSkeleton height={300} />;
  }

  if (!data || data.people.length === 0) {
    return (
      <Card>
        <CardContent className="py-16 text-center text-muted-foreground animate-fade-in">
          <Wallet className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <div className="font-medium text-foreground">
            {data?.period_label ?? ""} için avans kaydı yok
          </div>
          <div className="text-sm mt-1">
            Avanslar /Yükle ve Analiz Et → Faturasız Peşin Ödeme →
            kategori "Prim/Avans" ile girilir.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {/* Üst özet */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <StatBox
          label={`${data.period_label} Toplam Avans`}
          value={fmt(data.grand_total)}
          accent="text-rose-700"
          icon={Wallet}
        />
        <StatBox
          label="Avans Alan Kişi"
          value={`${data.people.length}`}
          accent="text-violet-700"
          icon={User}
        />
        <StatBox
          label="Toplam Kayıt"
          value={`${data.entry_count}`}
          accent="text-slate-700"
          icon={CalendarDays}
        />
      </div>

      {/* Kişi kişi tarihli döküm */}
      <div className="space-y-3">
        {data.people.map((p) => (
          <Card key={`${p.staff_name}-${p.staff_role}`} className="animate-fade-in">
            <CardContent className="p-5">
              <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <div className="h-9 w-9 rounded-xl bg-slate-100 flex items-center justify-center text-slate-600">
                    <User className="h-4.5 w-4.5" />
                  </div>
                  <div>
                    <div className="font-semibold leading-tight">{p.staff_name}</div>
                    {p.staff_role ? (
                      <span
                        className={`inline-block mt-0.5 rounded-full px-2 py-0.5 text-[10px] font-medium ${ROLE_TONE[p.staff_role] ?? "bg-slate-100 text-slate-600"}`}
                      >
                        {STAFF_ROLE_LABEL[p.staff_role] ?? p.staff_role}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Kişi Toplamı
                  </div>
                  <div className="text-lg font-semibold tabular-nums text-rose-700">
                    {fmt(p.total)}
                  </div>
                </div>
              </div>

              {/* Tarihli avanslar */}
              <div className="rounded-xl border border-border/60 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                      <th className="text-left font-medium py-1.5 px-3">Tarih</th>
                      <th className="text-left font-medium py-1.5 px-3">Mağaza</th>
                      <th className="text-left font-medium py-1.5 px-3">Not</th>
                      <th className="text-right font-medium py-1.5 px-3">Tutar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.entries.map((e) => (
                      <tr key={e.id} className="border-t border-border/40">
                        <td className="py-2 px-3 tabular-nums">{fmtDate(e.date)}</td>
                        <td className="py-2 px-3 text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <StoreIcon className="h-3 w-3" />
                            {e.store_name}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-muted-foreground truncate max-w-32">
                          {e.note ?? "—"}
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums font-medium">
                          {fmt(e.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function StatBox({
  label,
  value,
  accent,
  icon: Icon,
}: {
  label: string;
  value: string;
  accent: string;
  icon: typeof Wallet;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
          <Icon className="h-3.5 w-3.5" />
          {label}
        </div>
        <div className={`mt-1 text-xl font-semibold tabular-nums ${accent}`}>
          {value}
        </div>
      </CardContent>
    </Card>
  );
}
