"use client";

import { Ticket, CalendarDays, Store as StoreIcon, Tag } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { ChartSkeleton } from "@/components/shared/skeleton";

const TRY2 = new Intl.NumberFormat("tr-TR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const fmt = (n: number) => `${TRY2.format(n)} ₺`;

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

export function ShoppingVouchersDashboard({
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
  const { data, isLoading } = trpc.analytics.shoppingVouchers.useQuery({
    brand_id: brandId || undefined,
    store_id: storeId || undefined,
    year,
    month,
  });

  if (isLoading) {
    return <ChartSkeleton height={300} />;
  }

  if (!data || data.entries.length === 0) {
    return (
      <Card>
        <CardContent className="py-16 text-center text-muted-foreground animate-fade-in">
          <Ticket className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <div className="font-medium text-foreground">
            {data?.period_label ?? ""} için alışveriş çeki kaydı yok
          </div>
          <div className="text-sm mt-1">
            Alışveriş çekleri, Mağaza Özeti (kasa raporu) yüklendiğinde
            "Alışveriş Çeki Toplam" satırından otomatik okunur.
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
          label={`${data.period_label} Toplam Çek`}
          value={fmt(data.grand_total)}
          accent="text-indigo-700"
          icon={Ticket}
        />
        <StatBox
          label="Kayıt Sayısı"
          value={`${data.entry_count}`}
          accent="text-slate-700"
          icon={CalendarDays}
        />
        <StatBox
          label="Ortalama / Kayıt"
          value={fmt(data.entry_count ? data.grand_total / data.entry_count : 0)}
          accent="text-violet-700"
          icon={Tag}
        />
      </div>

      {/* Türkiye iade bilgi notu */}
      <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 px-4 py-3 text-sm text-indigo-900">
        Bu liste, Mavi HQ&apos;ye (Türkiye) iade için kullanılan alışveriş
        çeklerini tarih ve mağaza bazında gösterir. Excel olarak indirip
        bildirebilirsin.
      </div>

      {/* Tarihli döküm */}
      <Card className="animate-fade-in">
        <CardContent className="p-5">
          <div className="rounded-xl border border-border/60 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="text-left font-medium py-2 px-3">Tarih</th>
                  <th className="text-left font-medium py-2 px-3">Marka</th>
                  <th className="text-left font-medium py-2 px-3">Mağaza</th>
                  <th className="text-right font-medium py-2 px-3">Alışveriş Çeki</th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((e) => (
                  <tr key={e.id} className="border-t border-border/40">
                    <td className="py-2 px-3 tabular-nums">{fmtDate(e.date)}</td>
                    <td className="py-2 px-3 text-muted-foreground">
                      {e.brand_name}
                    </td>
                    <td className="py-2 px-3 text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <StoreIcon className="h-3 w-3" />
                        {e.store_name}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums font-medium text-indigo-700">
                      {fmt(e.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-primary/40 bg-primary/5">
                  <td className="py-2 px-3 font-semibold" colSpan={3}>
                    GENEL TOPLAM
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums font-semibold text-indigo-700">
                    {fmt(data.grand_total)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </CardContent>
      </Card>
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
  icon: typeof Ticket;
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
