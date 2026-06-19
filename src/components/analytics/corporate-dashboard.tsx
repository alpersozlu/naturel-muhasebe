"use client";

import {
  Building2,
  Building,
  User,
  Store as StoreIcon,
  Wallet,
  Clock,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { ChartSkeleton } from "@/components/shared/skeleton";
import type { CorporateParty } from "@/server/services/analytics/corporate";

const TRY2 = new Intl.NumberFormat("tr-TR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const fmt = (n: number) => `${TRY2.format(n)} ₺`;

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

export function CorporateDashboard({
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
  const { data, isLoading } = trpc.analytics.corporate.useQuery({
    brand_id: brandId || undefined,
    store_id: storeId || undefined,
    year,
    month,
  });

  if (isLoading) return <ChartSkeleton height={300} />;

  const isEmpty =
    !data || (data.companies.length === 0 && data.management.length === 0);

  if (isEmpty) {
    return (
      <Card>
        <CardContent className="py-16 text-center text-muted-foreground animate-fade-in">
          <Building2 className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <div className="font-medium text-foreground">
            {data?.period_label ?? ""} için kurumsal/yönetim alışverişi yok
          </div>
          <div className="text-sm mt-1">
            Kayıtlar /Yükle ve Analiz Et → Kurumsal & Yönetim Alışverişi
            kartından girilir.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Üst KPI */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatBox label={`${data.period_label} Toplam`} value={fmt(data.month_total)} accent="text-indigo-700" icon={Wallet} />
        <StatBox label={`${data.period_label} Borç`} value={fmt(data.month_debt)} accent="text-rose-700" icon={Clock} />
        <StatBox label={`${data.period_label} Ödenen`} value={fmt(data.month_paid)} accent="text-emerald-700" icon={Check} />
        <StatBox label={`${data.year} Toplam`} value={fmt(data.year_total)} accent="text-slate-700" icon={Building2} />
        <StatBox label={`${data.year} Kalan Borç`} value={fmt(data.year_debt)} accent="text-rose-700" icon={Clock} />
      </div>

      {/* Kurumsal şirketler */}
      {data.companies.length > 0 ? (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Building className="h-4 w-4 text-indigo-600" />
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Kurumsal Şirketler ({data.companies.length})
            </h2>
          </div>
          <div className="space-y-3">
            {data.companies.map((c) => (
              <PartyCard key={`c-${c.name}`} party={c} kind="corporate" />
            ))}
          </div>
        </section>
      ) : null}

      {/* Yönetim kişileri */}
      {data.management.length > 0 ? (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <User className="h-4 w-4 text-violet-600" />
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Yönetim ({data.management.length} kişi)
            </h2>
          </div>
          <div className="space-y-3">
            {data.management.map((p) => (
              <PartyCard key={`m-${p.name}`} party={p} kind="management" />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function PartyCard({
  party,
  kind,
}: {
  party: CorporateParty;
  kind: "corporate" | "management";
}) {
  const Icon = kind === "corporate" ? Building : User;
  const tone = kind === "corporate" ? "bg-indigo-100 text-indigo-700" : "bg-violet-100 text-violet-700";

  const utils = trpc.useUtils();
  const setPaid = trpc.corporatePurchase.setPaid.useMutation({
    onSuccess: (_d, vars) => {
      toast.success(vars.is_paid ? "Ödendi olarak işaretlendi" : "Borç olarak işaretlendi");
      utils.analytics.corporate.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Card className="animate-fade-in">
      <CardContent className="p-5">
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <div className="flex items-center gap-2">
            <div className={`h-9 w-9 rounded-xl flex items-center justify-center ${tone}`}>
              <Icon className="h-4.5 w-4.5" />
            </div>
            <div>
              <div className="font-semibold leading-tight">{party.name}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                Yıllık toplam {fmt(party.year_total)}
                {party.year_debt > 0.005
                  ? ` · kalan borç ${fmt(party.year_debt)}`
                  : " · borç yok"}
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Bu Dönem
            </div>
            <div className="text-lg font-semibold tabular-nums text-indigo-700">
              {fmt(party.month_total)}
            </div>
            {party.month_debt > 0.005 ? (
              <div className="text-[11px] text-rose-600 font-medium">
                borç {fmt(party.month_debt)}
              </div>
            ) : (
              <div className="text-[11px] text-emerald-600 font-medium">ödendi</div>
            )}
          </div>
        </div>

        {/* Kurumsal grupta kişi kırılımı */}
        {kind === "corporate" && party.people && party.people.length > 1 ? (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {party.people.map((p) => (
              <span
                key={p.person_name}
                className="inline-flex items-center gap-1 rounded-full bg-muted/60 px-2 py-0.5 text-[11px] text-muted-foreground"
              >
                <User className="h-3 w-3" />
                {p.person_name}: {fmt(p.month_total)}
                {p.month_debt > 0.005 ? (
                  <span className="text-rose-600">(borç)</span>
                ) : null}
              </span>
            ))}
          </div>
        ) : null}

        {/* Tarihli alışverişler (bu dönem) */}
        {party.entries.length > 0 ? (
          <div className="rounded-xl border border-border/60 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="text-left font-medium py-1.5 px-3">Tarih</th>
                  {kind === "corporate" ? (
                    <th className="text-left font-medium py-1.5 px-3">Kişi</th>
                  ) : null}
                  <th className="text-left font-medium py-1.5 px-3">Mağaza</th>
                  <th className="text-center font-medium py-1.5 px-3">Durum</th>
                  <th className="text-right font-medium py-1.5 px-3">Tutar</th>
                </tr>
              </thead>
              <tbody>
                {party.entries.map((e) => (
                  <tr key={e.id} className="border-t border-border/40">
                    <td className="py-2 px-3 tabular-nums">{fmtDate(e.date)}</td>
                    {kind === "corporate" ? (
                      <td className="py-2 px-3 text-muted-foreground truncate max-w-32">
                        {e.person_name}
                      </td>
                    ) : null}
                    <td className="py-2 px-3 text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <StoreIcon className="h-3 w-3" />
                        {e.store_name}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-center">
                      <button
                        type="button"
                        disabled={setPaid.isPending}
                        onClick={() =>
                          setPaid.mutate({ id: e.id, is_paid: !e.is_paid })
                        }
                        title={
                          e.is_paid
                            ? "Ödendi — tıkla: borç yap"
                            : "Borç — tıkla: ödendi işaretle"
                        }
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium border transition-colors disabled:opacity-50 ${
                          e.is_paid
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                            : "bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100"
                        }`}
                      >
                        {e.is_paid ? (
                          <Check className="h-2.5 w-2.5" />
                        ) : (
                          <Clock className="h-2.5 w-2.5" />
                        )}
                        {e.is_paid ? "Ödendi" : "Borç"}
                      </button>
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums font-medium">
                      {fmt(e.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </CardContent>
    </Card>
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
        <div className={`mt-1 text-lg font-semibold tabular-nums ${accent}`}>
          {value}
        </div>
      </CardContent>
    </Card>
  );
}
