import { redirect } from "@/i18n/navigation";
import {
  Store as StoreIcon,
  Calendar as CalendarIcon,
  Upload as UploadIcon,
  CheckCircle2,
  AlertCircle,
  Clock,
  Lock,
  XCircle,
  ShieldAlert,
} from "lucide-react";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { requireSession } from "@/lib/auth/session";
import {
  getAccessibleStoreIds,
  isAdmin,
} from "@/lib/auth/permissions";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const TRY_FMT = new Intl.NumberFormat("tr-TR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const DATE_FMT = new Intl.DateTimeFormat("tr-TR", {
  weekday: "long",
  day: "2-digit",
  month: "long",
  year: "numeric",
});

function num(v: { toNumber: () => number } | null | undefined): number {
  return v ? v.toNumber() : 0;
}

type DayStatus = "empty" | "partial" | "verified" | "error" | "locked";

const STATUS: Record<
  DayStatus,
  { label: string; icon: typeof CheckCircle2; bg: string; ring: string; iconCls: string; dot: string }
> = {
  empty: {
    label: "Yüklenmedi",
    icon: AlertCircle,
    bg: "bg-card",
    ring: "ring-1 ring-border",
    iconCls: "text-muted-foreground",
    dot: "bg-muted-foreground/30",
  },
  partial: {
    label: "Beklemede",
    icon: Clock,
    bg: "bg-amber-50/60",
    ring: "ring-1 ring-amber-200",
    iconCls: "text-amber-600",
    dot: "bg-amber-500",
  },
  verified: {
    label: "Doğrulandı",
    icon: CheckCircle2,
    bg: "bg-emerald-50/60",
    ring: "ring-1 ring-emerald-200",
    iconCls: "text-emerald-600",
    dot: "bg-emerald-500",
  },
  error: {
    label: "Hatalı",
    icon: XCircle,
    bg: "bg-rose-50/60",
    ring: "ring-1 ring-rose-200",
    iconCls: "text-rose-600",
    dot: "bg-rose-500",
  },
  locked: {
    label: "Kilitli",
    icon: Lock,
    bg: "bg-blue-50/60",
    ring: "ring-1 ring-blue-200",
    iconCls: "text-blue-600",
    dot: "bg-blue-500",
  },
};

export default async function TodayDashboard() {
  const session = await requireSession();
  const accessibleIds = await getAccessibleStoreIds(session);

  if (!isAdmin(session) && accessibleIds.length === 0) {
    // Manager with no store assignment — show contact page
    redirect({ href: "/contact", locale: "tr" });
  }

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart);
  todayEnd.setUTCDate(todayEnd.getUTCDate() + 1);
  const todayIso = todayStart.toISOString().slice(0, 10);

  const stores = await prisma.store.findMany({
    where: {
      deleted_at: null,
      ...(isAdmin(session) ? {} : { id: { in: accessibleIds } }),
    },
    include: {
      brand: true,
      daily_records: {
        where: { date: { gte: todayStart, lt: todayEnd } },
        include: {
          uploads: { select: { status: true } },
          verification: { select: { status: true, difference: true } },
          z_reports: { select: { net_sales_try: true } },
          store_summary: {
            select: { sales_total_try: true, loyalty_points_total_try: true },
          },
          dealer_daily_report: {
            select: { net_sales_try: true, loyalty_try: true },
          },
          pos_slips: {
            select: {
              net_amount_try: true,
              upload: { select: { status: true } },
            },
          },
        },
      },
    },
    orderBy: [{ brand: { name: "asc" } }, { name: "asc" }],
  });

  // Aggregate KPIs across stores
  let totalSales = 0;
  let totalSummaries = 0;
  let storesVerified = 0;
  let storesPending = 0;
  let storesError = 0;

  type Card = {
    storeId: string;
    storeName: string;
    brandName: string;
    city: string | null;
    status: DayStatus;
    summaryTotal: number;
    zTotal: number;
    posTotal: number;
    uploadCount: number;
    posCount: number;
    hasZ: boolean;
    hasSummary: boolean;
    verificationDiff: number | null;
    /** SAP Bayi Raporu yüklenmiş + özetle |fark| > 5 TL ise true */
    sapAlert: null | {
      net_diff: number;
      loyalty_diff: number;
      /** Pozitif (SAP > özet) = müdür özeti az = manipülasyon riski */
      critical: boolean;
    };
  };

  let sapAlertCount = 0;
  let sapCriticalCount = 0;
  const cards: Card[] = stores.map((s) => {
    const dr = s.daily_records[0];
    if (!dr) {
      storesPending++;
      return {
        storeId: s.id,
        storeName: s.name,
        brandName: s.brand.name,
        city: s.city,
        status: "empty" as DayStatus,
        summaryTotal: 0,
        zTotal: 0,
        posTotal: 0,
        uploadCount: 0,
        posCount: 0,
        hasZ: false,
        hasSummary: false,
        verificationDiff: null,
        sapAlert: null,
      };
    }

    const hasFailed = dr.uploads.some((u) => u.status === "failed");
    const verification = dr.verification?.status ?? null;
    const isLocked = dr.status === "locked";
    const hasZ = dr.z_reports.length > 0;
    const hasSummary = dr.store_summary !== null;
    const posCount = dr.pos_slips.length;

    const summaryTotal = num(dr.store_summary?.sales_total_try ?? null);
    const zTotal = num(dr.z_reports[0]?.net_sales_try ?? null);
    const posTotal = dr.pos_slips
      .filter(
        (p) => p.upload.status === "parsed" || p.upload.status === "confirmed"
      )
      .reduce((s, p) => s + num(p.net_amount_try), 0);

    const verifiedComplete =
      hasZ &&
      hasSummary &&
      posCount > 0 &&
      verification === "match" &&
      (dr.status === "approved" || dr.status === "locked");

    let status: DayStatus;
    if (isLocked) status = "locked";
    else if (hasFailed) status = "error";
    else if (verifiedComplete) status = "verified";
    else status = "partial";

    if (status === "verified" || status === "locked") storesVerified++;
    else if (status === "error") storesError++;
    else storesPending++;

    if (summaryTotal > 0) {
      totalSales += summaryTotal;
      totalSummaries++;
    }

    // SAP Bayi Raporu farkı (varsa)
    let sapAlert: Card["sapAlert"] = null;
    if (dr.dealer_daily_report && dr.store_summary) {
      const sapNet = num(dr.dealer_daily_report.net_sales_try);
      const sapLoy = num(dr.dealer_daily_report.loyalty_try);
      const sumNet = num(dr.store_summary.sales_total_try);
      const sumLoy = num(dr.store_summary.loyalty_points_total_try);
      const netDiff = sapNet - sumNet;
      const loyDiff = sapLoy - sumLoy;
      const TOL = 5;
      if (Math.abs(netDiff) > TOL || Math.abs(loyDiff) > TOL) {
        sapAlertCount++;
        const critical = netDiff > TOL || loyDiff > TOL; // SAP > özet = özet az = riskli
        if (critical) sapCriticalCount++;
        sapAlert = { net_diff: netDiff, loyalty_diff: loyDiff, critical };
      }
    }

    return {
      storeId: s.id,
      storeName: s.name,
      brandName: s.brand.name,
      city: s.city,
      status,
      summaryTotal,
      zTotal,
      posTotal,
      uploadCount: dr.uploads.length,
      posCount,
      hasZ,
      hasSummary,
      verificationDiff: dr.verification?.difference
        ? num(dr.verification.difference)
        : null,
      sapAlert,
    };
  });

  const firstName = session.full_name?.split(" ")[0] ?? "merhaba";
  const totalStores = cards.length;

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          Merhaba, {firstName}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {DATE_FMT.format(todayStart)} · {totalStores} mağaza
        </p>
      </div>

      {/* SAP Bayi Raporu fark alarmı — sadece varsa görünür */}
      {sapAlertCount > 0 ? (
        <SapAlertStrip
          total={sapAlertCount}
          critical={sapCriticalCount}
          alerts={cards.filter((c) => c.sapAlert !== null)}
        />
      ) : null}

      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <SummaryCard
          label="Bugün Satış"
          value={totalSummaries > 0 ? `${TRY_FMT.format(totalSales)} ₺` : "—"}
          hint={`${totalSummaries}/${totalStores} özet`}
          accent="text-emerald-700"
        />
        <SummaryCard
          label="Doğrulandı"
          value={`${storesVerified}/${totalStores}`}
          hint={storesVerified === totalStores ? "Tüm mağazalar tamam" : "Devam ediyor"}
          accent="text-emerald-700"
        />
        <SummaryCard
          label="Beklemede"
          value={`${storesPending}`}
          hint={storesPending === 0 ? "Eksik yok" : "Tamamlanmadı"}
          accent={storesPending === 0 ? "text-muted-foreground" : "text-amber-700"}
        />
        <SummaryCard
          label="Hata"
          value={`${storesError}`}
          hint={storesError === 0 ? "Temiz" : "İnceleme gerekli"}
          accent={storesError === 0 ? "text-muted-foreground" : "text-rose-700"}
        />
      </div>

      {/* Store cards */}
      {cards.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            <StoreIcon className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <div className="font-medium text-foreground">Hiç mağaza yok</div>
            <div className="text-sm mt-1">
              Yönetici Portalı'ndan mağaza ekleyerek başla.
            </div>
            <Button asChild className="mt-4" size="sm">
              <Link href="/admin">Yönetici Portalı'na Git</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {cards.map((c) => (
            <StoreCard key={c.storeId} card={c} todayIso={todayIso} />
          ))}
        </div>
      )}

      {/* Quick actions */}
      <div className="mt-8 pt-6 border-t flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground mr-2">Hızlı:</span>
        <Button asChild variant="outline" size="sm">
          <Link href="/upload">
            <UploadIcon className="h-3.5 w-3.5 mr-1.5" />
            Belge Yükle
          </Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href="/verification">
            <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
            Doğrulama Sistemi
          </Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href="/history">
            <CalendarIcon className="h-3.5 w-3.5 mr-1.5" />
            Geçmiş
          </Link>
        </Button>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint: string;
  accent: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
          {label}
        </div>
        <div className={`mt-1 text-xl font-semibold tabular-nums ${accent}`}>
          {value}
        </div>
        <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>
      </CardContent>
    </Card>
  );
}

function StoreCard({
  card,
  todayIso,
}: {
  card: {
    storeId: string;
    storeName: string;
    brandName: string;
    city: string | null;
    status: DayStatus;
    summaryTotal: number;
    zTotal: number;
    posTotal: number;
    uploadCount: number;
    posCount: number;
    hasZ: boolean;
    hasSummary: boolean;
    verificationDiff: number | null;
    sapAlert: null | { net_diff: number; loyalty_diff: number; critical: boolean };
  };
  todayIso: string;
}) {
  const s = STATUS[card.status];
  const Icon = s.icon;

  // Çıkar net özet — neyi vurgulayalım?
  const main =
    card.status === "verified" || card.status === "locked"
      ? `${TRY_FMT.format(card.summaryTotal)} ₺`
      : card.status === "error"
        ? "Hata var"
        : card.status === "partial"
          ? card.summaryTotal > 0
            ? `${TRY_FMT.format(card.summaryTotal)} ₺`
            : card.zTotal > 0
              ? `Z: ${TRY_FMT.format(card.zTotal)} ₺`
              : `${card.uploadCount} yükleme`
          : "Henüz başlanmadı";

  const checklist: Array<{ label: string; done: boolean }> = [
    { label: "Z Raporu", done: card.hasZ },
    { label: "POS Fişi", done: card.posCount > 0 },
    { label: "Mağaza Özeti", done: card.hasSummary },
  ];

  return (
    <Link
      href={`/stores/${card.storeId}/days/${todayIso}`}
      className={`group block rounded-2xl p-5 ${s.bg} ${s.ring} hover:shadow-md hover:-translate-y-0.5 transition-all duration-snap ease-snappy`}
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <div className="font-semibold leading-tight truncate group-hover:text-primary transition-colors">
            {card.storeName}
          </div>
          <div className="text-xs text-muted-foreground truncate mt-0.5">
            {card.brandName}
            {card.city ? ` · ${card.city}` : ""}
          </div>
        </div>
        <div className={`h-9 w-9 rounded-xl bg-card flex items-center justify-center ${s.iconCls} shrink-0`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>

      <div className="mb-3">
        <div className="text-xl font-semibold tabular-nums">{main}</div>
        {card.verificationDiff !== null &&
        card.verificationDiff !== 0 &&
        card.status !== "verified" ? (
          <div className="text-xs text-rose-600 mt-0.5 tabular-nums">
            Δ {TRY_FMT.format(Math.abs(card.verificationDiff))} ₺ fark
          </div>
        ) : null}
      </div>

      {/* Checklist */}
      <div className="flex items-center gap-3 text-[11px]">
        {checklist.map((item) => (
          <div
            key={item.label}
            className={`flex items-center gap-1 ${
              item.done ? "text-emerald-700" : "text-muted-foreground/60"
            }`}
          >
            <div
              className={`h-1.5 w-1.5 rounded-full ${
                item.done ? "bg-emerald-500" : "bg-muted-foreground/30"
              }`}
            />
            {item.label}
          </div>
        ))}
      </div>

      <div className="mt-3 pt-3 border-t border-border/40 flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge variant="secondary" className="bg-card text-foreground/80">
            {s.label}
          </Badge>
          {card.sapAlert ? (
            <Badge
              variant="secondary"
              className={
                card.sapAlert.critical
                  ? "bg-rose-100 text-rose-800 border border-rose-200"
                  : "bg-amber-100 text-amber-800 border border-amber-200"
              }
            >
              <ShieldAlert className="h-3 w-3 mr-0.5" />
              SAP {card.sapAlert.critical ? "Riski" : "Farkı"}
            </Badge>
          ) : null}
        </div>
        <span className="text-muted-foreground group-hover:text-primary transition-colors">
          Aç →
        </span>
      </div>
    </Link>
  );
}

/**
 * Bugün için SAP Bayi Raporu vs Mağaza Özeti farkı olan mağazaları gösterir.
 * Sadece sapAlertCount > 0 ise render edilir.
 */
function SapAlertStrip({
  total,
  critical,
  alerts,
}: {
  total: number;
  critical: number;
  alerts: Array<{
    storeId: string;
    storeName: string;
    brandName: string;
    sapAlert: null | { net_diff: number; loyalty_diff: number; critical: boolean };
  }>;
}) {
  const hasCritical = critical > 0;
  const toneCls = hasCritical
    ? "border-rose-300 bg-gradient-to-r from-rose-50 to-rose-50/40"
    : "border-amber-300 bg-gradient-to-r from-amber-50 to-amber-50/40";
  const iconCls = hasCritical ? "text-rose-600" : "text-amber-600";
  const titleCls = hasCritical ? "text-rose-900" : "text-amber-900";

  return (
    <div
      className={`mb-6 rounded-2xl border-2 ${toneCls} p-4 animate-fade-in shadow-sm`}
    >
      <div className="flex items-start gap-3">
        <div className={`shrink-0 ${iconCls}`}>
          <ShieldAlert className="h-6 w-6" />
        </div>
        <div className="flex-1 min-w-0">
          <div className={`font-semibold text-sm ${titleCls}`}>
            {hasCritical
              ? `🚨 ${critical} mağazada SAP manipülasyon riski`
              : `⚠️ ${total} mağazada SAP fark`}
          </div>
          <div className="text-xs text-foreground/70 mt-1">
            {hasCritical
              ? "SAP Bayi Raporu, Mağaza Özeti'nden YÜKSEK — müdür özetini olduğundan az göstermiş olabilir."
              : "Mağaza Özeti, SAP Bayi Raporu'ndan YÜKSEK — anomali, kontrol edin."}
          </div>
          <div className="flex flex-wrap gap-1.5 mt-3">
            {alerts.map((c) => {
              if (!c.sapAlert) return null;
              const isCrit = c.sapAlert.critical;
              const total = c.sapAlert.net_diff;
              const sign = total > 0 ? "+" : "";
              return (
                <Link
                  key={c.storeId}
                  href={`/stores/${c.storeId}`}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    isCrit
                      ? "bg-white border-rose-300 text-rose-800 hover:bg-rose-50"
                      : "bg-white border-amber-300 text-amber-800 hover:bg-amber-50"
                  }`}
                >
                  <span className="truncate max-w-32">{c.storeName}</span>
                  <span className="tabular-nums">
                    {sign}
                    {TRY_FMT.format(total)} ₺
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
