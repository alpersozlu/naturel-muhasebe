"use client";

import { format, isSameDay, differenceInCalendarDays } from "date-fns";
import { tr } from "date-fns/locale";
import {
  FileText,
  Receipt,
  Building,
  Banknote,
  Wallet,
  History as HistoryIcon,
  ExternalLink,
  Loader2,
  ChevronDown,
  Calculator,
  ShieldCheck,
} from "lucide-react";
import type { UploadType, UploadStatus } from "@prisma/client";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { HistorySelection } from "./history-filters";

const TYPE_META: Record<
  UploadType,
  { label: string; icon: typeof FileText; color: string; bg: string }
> = {
  bank_receipt: {
    label: "İban Dekontu",
    icon: Building,
    color: "text-blue-600",
    bg: "bg-blue-50",
  },
  pos_slip: {
    label: "POS Fişi",
    icon: Receipt,
    color: "text-purple-600",
    bg: "bg-purple-50",
  },
  store_summary: {
    label: "Mağaza Özeti",
    icon: FileText,
    color: "text-amber-600",
    bg: "bg-amber-50",
  },
  expense: {
    label: "Masraf/Fatura",
    icon: Wallet,
    color: "text-rose-600",
    bg: "bg-rose-50",
  },
  cash_advance: {
    label: "Faturasız Peşin Ödeme",
    icon: Banknote,
    color: "text-emerald-600",
    bg: "bg-emerald-50",
  },
  z_report: {
    label: "Z Raporu",
    icon: Calculator,
    color: "text-cyan-600",
    bg: "bg-cyan-50",
  },
  dealer_daily_report: {
    label: "Bayi Gün Sonu (SAP)",
    icon: ShieldCheck,
    color: "text-indigo-600",
    bg: "bg-indigo-50",
  },
};

const STATUS_META: Record<UploadStatus, { label: string; cls: string }> = {
  pending: { label: "Bekliyor", cls: "bg-slate-100 text-slate-700 border-slate-200" },
  processing: { label: "İşleniyor", cls: "bg-blue-100 text-blue-700 border-blue-200" },
  parsed: { label: "Okundu", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  confirmed: { label: "Onaylandı", cls: "bg-emerald-100 text-emerald-800 border-emerald-300" },
  failed: { label: "Başarısız", cls: "bg-rose-100 text-rose-700 border-rose-200" },
};

const TRY_FORMATTER = new Intl.NumberFormat("tr-TR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function fmtMoney(n: unknown): string | null {
  if (n === null || n === undefined) return null;
  // Server may serialize Prisma Decimal as: Decimal object, string, or number
  const num =
    typeof n === "object" && n !== null && "toNumber" in n
      ? (n as { toNumber: () => number }).toNumber()
      : Number(n);
  return Number.isFinite(num) ? TRY_FORMATTER.format(num) : null;
}

function dayHeader(date: Date): { primary: string; secondary: string | null } {
  const today = new Date();
  const diff = differenceInCalendarDays(today, date);
  if (isSameDay(date, today)) {
    return { primary: format(date, "d MMMM yyyy", { locale: tr }), secondary: "Bugün" };
  }
  if (diff === 1) {
    return { primary: format(date, "d MMMM yyyy", { locale: tr }), secondary: "Dün" };
  }
  if (diff > 1 && diff < 7) {
    return {
      primary: format(date, "d MMMM yyyy", { locale: tr }),
      secondary: format(date, "EEEE", { locale: tr }),
    };
  }
  return {
    primary: format(date, "d MMMM yyyy", { locale: tr }),
    secondary: format(date, "EEEE", { locale: tr }),
  };
}

export function HistoryList({ filters }: { filters: HistorySelection }) {
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    trpc.history.list.useInfiniteQuery(
      {
        brand_id: filters.brandId || undefined,
        store_id: filters.storeId || undefined,
        type: (filters.type || undefined) as UploadType | undefined,
        status: (filters.status || undefined) as UploadStatus | undefined,
        date_from: filters.dateFrom || undefined,
        date_to: filters.dateTo || undefined,
        limit: 25,
      },
      {
        getNextPageParam: (last) => last.nextCursor ?? undefined,
      }
    );

  const utils = trpc.useUtils();
  const openFile = async (id: string) => {
    try {
      const res = await utils.upload.signedUrl.fetch({ id });
      window.open(res.url, "_blank", "noopener");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-0 divide-y">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="px-5 py-4 flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl animate-pulse bg-muted/60" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 w-1/3 rounded animate-pulse bg-muted/60" />
                <div className="h-2.5 w-1/2 rounded animate-pulse bg-muted/50" />
              </div>
              <div className="h-7 w-28 rounded animate-pulse bg-muted/60" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  const items = data?.pages.flatMap((p) => p.items) ?? [];

  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="py-16 text-center text-muted-foreground animate-fade-in">
          <HistoryIcon className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <div className="font-medium text-foreground">İşlem bulunamadı</div>
          <div className="text-sm mt-1">
            Filtreleri değiştir veya yeni bir yükleme yap.
          </div>
        </CardContent>
      </Card>
    );
  }

  // Group items by daily_record.date (the business day they belong to),
  // not by uploaded_at — so all uploads for "19 Mayıs" cluster together
  // regardless of when they were uploaded.
  const groups = new Map<string, { date: Date; items: typeof items }>();
  for (const u of items) {
    const iso = format(u.daily_record.date, "yyyy-MM-dd");
    if (!groups.has(iso)) {
      groups.set(iso, { date: new Date(u.daily_record.date), items: [] });
    }
    groups.get(iso)!.items.push(u);
  }
  const sortedGroups = Array.from(groups.values()).sort(
    (a, b) => b.date.getTime() - a.date.getTime()
  );

  return (
    <>
      <div className="space-y-5">
        {sortedGroups.map((group) => {
          const header = dayHeader(group.date);
          const iso = format(group.date, "yyyy-MM-dd");
          return (
            <div key={iso}>
              {/* Sticky day header */}
              <div className="sticky top-0 z-10 -mx-1 px-1 py-2 bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/65 mb-2">
                <div className="flex items-baseline justify-between gap-3 px-1">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {header.primary}
                  </h3>
                  {header.secondary ? (
                    <span className="text-[11px] font-medium text-primary/80">
                      {header.secondary}
                    </span>
                  ) : null}
                </div>
              </div>

              <Card>
                <CardContent className="p-0 divide-y">
                  {group.items.map((u) => {
                    const meta = TYPE_META[u.type];
                    const Icon = meta.icon;
                    const status = STATUS_META[u.status];
                    const detail = describe(u);
                    return (
                      <div
                        key={u.id}
                        className="px-5 py-4 flex items-center gap-4 hover:bg-muted/20 transition-colors duration-snap"
                      >
                        {/* SOL: tip ikonu + label + durum + meta */}
                        <div
                          className={`h-12 w-12 rounded-xl flex items-center justify-center shrink-0 ${meta.bg} ${meta.color}`}
                        >
                          <Icon className="h-5 w-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold">
                              {meta.label}
                            </span>
                            <span
                              className={`inline-flex items-center text-[10px] uppercase tracking-wider font-medium px-2 py-0.5 rounded-full border ${status.cls}`}
                            >
                              {status.label}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground truncate flex items-center gap-1.5 mt-1">
                            <span className="font-medium text-foreground/80">
                              {u.daily_record.store.name}
                            </span>
                            <span className="text-muted-foreground/50">·</span>
                            <span>{u.daily_record.store.brand.name}</span>
                            {detail.extra ? (
                              <>
                                <span className="text-muted-foreground/50">·</span>
                                <span>{detail.extra}</span>
                              </>
                            ) : null}
                          </div>
                          <div className="text-[11px] text-muted-foreground/70 truncate mt-0.5">
                            {u.uploaded_by_user.full_name ??
                              u.uploaded_by_user.email}{" "}
                            · {format(u.uploaded_at, "HH:mm")}
                          </div>
                        </div>

                        {/* SAĞ: büyük tutar (CardPlus) + dikey ayraç + dosya */}
                        {detail.amount ? (
                          <div className="text-right shrink-0">
                            <div className="text-lg sm:text-xl lg:text-2xl font-bold tabular-nums tracking-tight text-foreground">
                              {detail.amount}
                            </div>
                            <div className="text-[10px] font-medium text-muted-foreground tracking-wider uppercase">
                              {detail.unit}
                            </div>
                          </div>
                        ) : null}
                        <div className="shrink-0 border-l border-border/60 pl-3">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9"
                            onClick={() => openFile(u.id)}
                            title="Dosyayı aç"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex flex-col items-center gap-2">
        {hasNextPage ? (
          <Button
            variant="outline"
            size="sm"
            disabled={isFetchingNextPage}
            onClick={() => fetchNextPage()}
          >
            {isFetchingNextPage ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                Yükleniyor
              </>
            ) : (
              <>
                Daha fazla yükle
                <ChevronDown className="h-4 w-4 ml-1" />
              </>
            )}
          </Button>
        ) : null}
        <div className="text-xs text-muted-foreground">
          {items.length} işlem gösteriliyor
          {!hasNextPage && items.length > 0 ? " · son" : ""}
        </div>
      </div>
    </>
  );
}

type HistoryItem = {
  type: UploadType;
  pos_slip: { bank_name: string | null; net_amount_try: unknown } | null;
  store_summary: { sales_total_try: unknown } | null;
  bank_receipt: { bank_name: string | null; amount_try: unknown } | null;
  expense: { vendor: string | null; amount_try: unknown; category: string } | null;
  z_report: { net_sales_try: unknown } | null;
  dealer_daily_report: { net_sales_try: unknown; store_code: string | null } | null;
};

function describe(u: HistoryItem): {
  amount: string | null;
  unit: string | null;
  extra: string | null;
} {
  if (u.type === "pos_slip" && u.pos_slip) {
    return {
      amount: fmtMoney(u.pos_slip.net_amount_try),
      unit: "Net Tutar",
      extra: u.pos_slip.bank_name,
    };
  }
  if (u.type === "store_summary" && u.store_summary) {
    return {
      amount: fmtMoney(u.store_summary.sales_total_try),
      unit: "Satış Toplamı",
      extra: null,
    };
  }
  if (u.type === "bank_receipt" && u.bank_receipt) {
    return {
      amount: fmtMoney(u.bank_receipt.amount_try),
      unit: "Dekont Tutarı",
      extra: u.bank_receipt.bank_name,
    };
  }
  if (u.type === "expense" && u.expense) {
    return {
      amount: fmtMoney(u.expense.amount_try),
      unit: "Masraf Tutarı",
      extra: u.expense.vendor,
    };
  }
  if (u.type === "z_report" && u.z_report) {
    return {
      amount: fmtMoney(u.z_report.net_sales_try),
      unit: "Net Satış",
      extra: null,
    };
  }
  if (u.type === "dealer_daily_report" && u.dealer_daily_report) {
    return {
      amount: fmtMoney(u.dealer_daily_report.net_sales_try),
      unit: "SAP Net Satış",
      extra: u.dealer_daily_report.store_code
        ? `Kod ${u.dealer_daily_report.store_code}`
        : null,
    };
  }
  return { amount: null, unit: null, extra: null };
}
