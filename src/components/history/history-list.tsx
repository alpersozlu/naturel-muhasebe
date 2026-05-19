"use client";

import { format } from "date-fns";
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
} from "lucide-react";
import type { UploadType, UploadStatus } from "@prisma/client";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { HistorySelection } from "./history-filters";

const TYPE_META: Record<UploadType, { label: string; icon: typeof FileText; color: string }> = {
  bank_receipt: { label: "Banka Dekontu", icon: Building, color: "text-blue-600" },
  pos_slip: { label: "POS Fişi", icon: Receipt, color: "text-purple-600" },
  store_summary: { label: "Mağaza Özeti", icon: FileText, color: "text-amber-600" },
  expense: { label: "Masraf/Fatura", icon: Wallet, color: "text-rose-600" },
  cash_advance: { label: "Peşin Ödeme", icon: Banknote, color: "text-emerald-600" },
  z_report: { label: "Z Raporu", icon: Calculator, color: "text-cyan-600" },
};

const STATUS_LABEL: Record<UploadStatus, string> = {
  pending: "Bekliyor",
  processing: "İşleniyor",
  parsed: "Okundu",
  confirmed: "Onaylandı",
  failed: "Başarısız",
};

const STATUS_COLOR: Record<UploadStatus, string> = {
  pending: "bg-slate-100 text-slate-700",
  processing: "bg-blue-100 text-blue-700",
  parsed: "bg-amber-100 text-amber-700",
  confirmed: "bg-emerald-100 text-emerald-700",
  failed: "bg-rose-100 text-rose-700",
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
            <div key={i} className="px-5 py-3.5 flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg animate-pulse bg-muted/60" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-1/3 rounded animate-pulse bg-muted/60" />
                <div className="h-2.5 w-1/2 rounded animate-pulse bg-muted/50" />
              </div>
              <div className="h-5 w-20 rounded animate-pulse bg-muted/60" />
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

  return (
    <>
      <Card>
        <CardContent className="p-0 divide-y">
          {items.map((u) => {
            const meta = TYPE_META[u.type];
            const Icon = meta.icon;
            const detail = describe(u);
            return (
              <div
                key={u.id}
                className="px-5 py-3.5 flex items-center gap-3 hover:bg-muted/30 transition-colors duration-snap"
              >
                <div
                  className={`h-9 w-9 rounded-lg flex items-center justify-center bg-muted/60 ${meta.color} shrink-0`}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">
                    {meta.label}
                    {detail.amount ? (
                      <span className="ml-2 text-emerald-700 tabular-nums">
                        {detail.amount}
                      </span>
                    ) : null}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {u.daily_record.store.brand.name} ·{" "}
                    {u.daily_record.store.name} ·{" "}
                    {format(u.daily_record.date, "d MMM yyyy", { locale: tr })}
                    {detail.bank ? ` · ${detail.bank}` : ""}
                    {detail.vendor ? ` · ${detail.vendor}` : ""}
                  </div>
                  <div className="text-[11px] text-muted-foreground/80 truncate mt-0.5">
                    {u.uploaded_by_user.full_name ?? u.uploaded_by_user.email}{" "}
                    · {format(u.uploaded_at, "HH:mm")}
                  </div>
                </div>
                <Badge
                  variant="secondary"
                  className={`${STATUS_COLOR[u.status]} text-xs shrink-0`}
                >
                  {STATUS_LABEL[u.status]}
                </Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => openFile(u.id)}
                  title="Dosyayı aç"
                >
                  <ExternalLink className="h-4 w-4" />
                </Button>
              </div>
            );
          })}
        </CardContent>
      </Card>

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
};

function describe(u: HistoryItem): { amount: string | null; bank: string | null; vendor: string | null } {
  if (u.type === "pos_slip" && u.pos_slip) {
    return {
      amount: fmtMoney(u.pos_slip.net_amount_try) ? `${fmtMoney(u.pos_slip.net_amount_try)} ₺` : null,
      bank: u.pos_slip.bank_name,
      vendor: null,
    };
  }
  if (u.type === "store_summary" && u.store_summary) {
    const amt = fmtMoney(u.store_summary.sales_total_try);
    return { amount: amt ? `${amt} ₺` : null, bank: null, vendor: null };
  }
  if (u.type === "bank_receipt" && u.bank_receipt) {
    return {
      amount: fmtMoney(u.bank_receipt.amount_try) ? `${fmtMoney(u.bank_receipt.amount_try)} ₺` : null,
      bank: u.bank_receipt.bank_name,
      vendor: null,
    };
  }
  if (u.type === "expense" && u.expense) {
    return {
      amount: fmtMoney(u.expense.amount_try) ? `${fmtMoney(u.expense.amount_try)} ₺` : null,
      bank: null,
      vendor: u.expense.vendor,
    };
  }
  return { amount: null, bank: null, vendor: null };
}
