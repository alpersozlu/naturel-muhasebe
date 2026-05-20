import { notFound } from "next/navigation";
import {
  ChevronLeft,
  Store as StoreIcon,
  Upload as UploadIcon,
  AlertTriangle,
} from "lucide-react";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { requireSession } from "@/lib/auth/session";
import { canAccessStore } from "@/lib/auth/permissions";
import { computeDay } from "@/server/services/verification/compute";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UploadList } from "@/components/upload/upload-list";

const TRY_FMT = new Intl.NumberFormat("tr-TR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const DATE_FMT = new Intl.DateTimeFormat("tr-TR", {
  day: "2-digit",
  month: "long",
  year: "numeric",
  weekday: "long",
});

function num(v: { toNumber: () => number } | null | undefined): number {
  return v ? v.toNumber() : 0;
}

const STATUS_BADGE: Record<
  "draft" | "pending" | "approved" | "locked",
  { label: string; className: string }
> = {
  draft: { label: "Taslak", className: "bg-slate-100 text-slate-700" },
  pending: { label: "Bekliyor", className: "bg-amber-100 text-amber-700" },
  approved: { label: "Onaylı", className: "bg-emerald-100 text-emerald-700" },
  locked: { label: "Kilitli", className: "bg-blue-100 text-blue-700" },
};

export default async function DayDetailPage({
  params,
}: {
  params: Promise<{ storeId: string; date: string }>;
}) {
  const { storeId, date } = await params;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound();

  const session = await requireSession();
  const ok = await canAccessStore(session, storeId);
  if (!ok) notFound();

  const store = await prisma.store.findUnique({
    where: { id: storeId },
    include: { brand: true },
  });
  if (!store || store.deleted_at) notFound();

  const dateObj = new Date(`${date}T00:00:00.000Z`);
  const dailyRecord = await prisma.dailyRecord.findUnique({
    where: { store_id_date: { store_id: storeId, date: dateObj } },
    include: {
      store_summary: true,
      z_reports: true,
      pos_slips: { include: { upload: { select: { status: true } } } },
      manual_invoices: true,
      verification: true,
    },
  });

  // Compute live verification (in case Verification row is stale)
  const verification = dailyRecord
    ? await computeDay(prisma, dailyRecord.id)
    : null;

  // KPI calculations
  const posTotal = dailyRecord
    ? dailyRecord.pos_slips
        .filter(
          (p) =>
            p.upload.status === "parsed" || p.upload.status === "confirmed"
        )
        .reduce((s, p) => s + num(p.net_amount_try), 0)
    : 0;

  const zTotal = dailyRecord?.z_reports[0]
    ? num(dailyRecord.z_reports[0].net_sales_try)
    : 0;

  const summaryTotal = dailyRecord?.store_summary
    ? num(dailyRecord.store_summary.sales_total_try)
    : 0;

  const invoiceTotal = dailyRecord
    ? dailyRecord.manual_invoices.reduce((s, i) => s + num(i.amount_try), 0)
    : 0;

  const reportedCash = dailyRecord?.reported_cash_try
    ? num(dailyRecord.reported_cash_try)
    : null;
  const summaryCash = dailyRecord?.store_summary?.cash_sales_try
    ? num(dailyRecord.store_summary.cash_sales_try)
    : null;
  const cashDiff =
    reportedCash !== null && summaryCash !== null
      ? summaryCash - reportedCash
      : null;

  const monthParam = `${date.slice(0, 4)}-${date.slice(5, 7)}`;
  const status = dailyRecord?.status ?? "draft";
  const statusMeta = STATUS_BADGE[status];

  return (
    <div>
      <Link
        href={`/stores/${storeId}?month=${monthParam}`}
        className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4"
      >
        <ChevronLeft className="h-4 w-4 mr-1" />
        {store.name} takvimi
      </Link>

      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div className="flex items-start gap-4 min-w-0">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 shrink-0">
            <StoreIcon className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">
              {DATE_FMT.format(dateObj)}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {store.brand.name} · {store.name}
              {store.city ? ` · ${store.city}` : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge className={statusMeta.className}>{statusMeta.label}</Badge>
          {dailyRecord ? (
            <Button asChild variant="outline" size="sm">
              <Link href="/upload">
                <UploadIcon className="h-4 w-4 mr-1.5" />
                Yükleme sayfası
              </Link>
            </Button>
          ) : (
            <Button asChild size="sm">
              <Link href="/upload">
                <UploadIcon className="h-4 w-4 mr-1.5" />
                Yüklemeye başla
              </Link>
            </Button>
          )}
        </div>
      </div>

      {/* Cash mismatch warning banner */}
      {verification?.notes && verification.notes.includes("Kasa") ? (
        <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-rose-600 mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold text-rose-900 text-sm">
              Kasa Uyarısı
            </div>
            <div className="text-sm text-rose-800 mt-0.5">
              {verification.notes}
            </div>
          </div>
        </div>
      ) : null}

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <KpiCard
          label="Z Raporu (Net)"
          value={zTotal}
          accent="text-cyan-700"
          empty={!dailyRecord?.z_reports[0]}
        />
        <KpiCard
          label="POS Toplamı"
          value={posTotal}
          accent="text-purple-700"
          empty={posTotal === 0}
        />
        <KpiCard
          label="Mağaza Özeti"
          value={summaryTotal}
          accent="text-amber-700"
          empty={!dailyRecord?.store_summary}
        />
        <KpiCard
          label={
            verification && verification.status !== "no_summary" && verification.status !== "no_data"
              ? `Fark (${verification.status === "match" ? "✓" : "✗"})`
              : "Fark"
          }
          value={verification?.difference ?? 0}
          accent={
            verification?.status === "match"
              ? "text-emerald-700"
              : "text-rose-700"
          }
          empty={!verification || verification.status === "no_summary" || verification.status === "no_data"}
        />
      </div>

      {/* Verification breakdown if has summary */}
      {verification && verification.rows.length > 0 ? (
        <Card className="mb-6">
          <CardContent className="p-5">
            <div className="text-sm font-semibold mb-3">Doğrulama Detayı</div>
            <div className="space-y-2 text-sm">
              {verification.rows.map((r) => (
                <div
                  key={r.label}
                  className="flex items-center justify-between border-b border-border/40 last:border-0 pb-1.5"
                >
                  <div className="text-muted-foreground">{r.label}</div>
                  <div className="flex items-center gap-4 tabular-nums">
                    <span className="text-foreground">
                      Belge: {TRY_FMT.format(r.document_total)} ₺
                    </span>
                    <span className="text-muted-foreground">
                      Özet: {TRY_FMT.format(r.summary_total)} ₺
                    </span>
                    <span
                      className={
                        r.matches ? "text-emerald-700" : "text-rose-700"
                      }
                    >
                      {r.matches ? "✓" : `Δ ${TRY_FMT.format(r.difference)}`}
                    </span>
                  </div>
                </div>
              ))}
              {invoiceTotal > 0 ? (
                <div className="flex items-center justify-between pt-2 border-t text-xs text-muted-foreground">
                  <span>El Faturaları toplamı</span>
                  <span className="tabular-nums">
                    {TRY_FMT.format(invoiceTotal)} ₺
                  </span>
                </div>
              ) : null}
              {reportedCash !== null ? (
                <div className="flex items-center justify-between pt-2 border-t text-xs">
                  <span className="text-muted-foreground">
                    Müdür kasa sayımı
                  </span>
                  <div className="flex items-center gap-3 tabular-nums">
                    <span className="text-foreground">
                      {TRY_FMT.format(reportedCash)} ₺
                    </span>
                    {cashDiff !== null && Math.abs(cashDiff) > 0.01 ? (
                      <span
                        className={
                          cashDiff > 0 ? "text-rose-700" : "text-amber-700"
                        }
                      >
                        {cashDiff > 0
                          ? `${TRY_FMT.format(cashDiff)} ₺ eksik`
                          : `${TRY_FMT.format(Math.abs(cashDiff))} ₺ fazla`}
                      </span>
                    ) : (
                      <span className="text-emerald-700">✓ uyuşuyor</span>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Uploads */}
      {dailyRecord ? (
        <UploadList storeId={storeId} date={date} />
      ) : (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground animate-fade-in">
            <UploadIcon className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <div className="font-medium text-foreground">
              Bu güne henüz yükleme yapılmamış.
            </div>
            <div className="text-sm mt-1">
              Yükleme sayfasından bu güne ait belgeleri ekleyebilirsin.
            </div>
            <Button asChild className="mt-4" size="sm">
              <Link href="/upload">
                <UploadIcon className="h-4 w-4 mr-1.5" />
                Yüklemeye başla
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function KpiCard({
  label,
  value,
  accent,
  empty,
}: {
  label: string;
  value: number;
  accent: string;
  empty: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
          {label}
        </div>
        <div
          className={`mt-1 text-xl font-semibold tabular-nums ${
            empty ? "text-muted-foreground" : accent
          }`}
        >
          {empty ? "—" : `${TRY_FMT.format(value)} ₺`}
        </div>
      </CardContent>
    </Card>
  );
}
