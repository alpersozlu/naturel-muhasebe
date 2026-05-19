"use client";

import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { tr } from "date-fns/locale";
import {
  FileText,
  Receipt,
  Building,
  Banknote,
  Wallet,
  Trash2,
  ExternalLink,
  AlertCircle,
  Check,
} from "lucide-react";
import type { UploadType, UploadStatus } from "@prisma/client";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  PosSlipDetails,
  StoreSummaryDetails,
  BankReceiptDetails,
  ExpenseDetails,
} from "./parsed-details";

const TYPE_META: Record<UploadType, { label: string; icon: typeof FileText; color: string }> = {
  bank_receipt: { label: "Banka Dekontu", icon: Building, color: "text-blue-600" },
  pos_slip: { label: "POS Fişi", icon: Receipt, color: "text-purple-600" },
  store_summary: { label: "Mağaza Özeti", icon: FileText, color: "text-amber-600" },
  expense: { label: "Masraf/Fatura", icon: Wallet, color: "text-rose-600" },
  cash_advance: { label: "Peşin Ödeme", icon: Banknote, color: "text-emerald-600" },
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

export function UploadList({ storeId, date }: { storeId: string; date: string }) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.upload.listForStoreDate.useQuery(
    { store_id: storeId, date },
    { enabled: !!storeId && !!date }
  );

  const del = trpc.upload.delete.useMutation({
    onSuccess: () => {
      toast.success("Silindi");
      utils.upload.listForStoreDate.invalidate({ store_id: storeId, date });
    },
    onError: (e) => toast.error(e.message),
  });

  const confirmMut = trpc.upload.confirm.useMutation({
    onSuccess: () => {
      toast.success("Onaylandı");
      utils.upload.listForStoreDate.invalidate({ store_id: storeId, date });
    },
    onError: (e) => toast.error(e.message),
  });

  const openFile = async (id: string) => {
    try {
      const res = await utils.upload.signedUrl.fetch({ id });
      window.open(res.url, "_blank", "noopener");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  if (!storeId || !date) return null;

  return (
    <Card className="mt-6">
      <CardContent className="p-0">
        <div className="px-5 py-3 border-b">
          <div className="font-semibold">Bu güne ait yüklemeler</div>
          <div className="text-xs text-muted-foreground">
            {date} — {data?.length ?? 0} dosya
          </div>
        </div>

        {isLoading ? (
          <div className="px-4 py-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 py-3">
                <div className="h-5 w-5 rounded animate-pulse bg-muted/60" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-32 rounded animate-pulse bg-muted/60" />
                  <div className="h-2.5 w-48 rounded animate-pulse bg-muted/50" />
                </div>
                <div className="h-5 w-16 rounded animate-pulse bg-muted/60" />
              </div>
            ))}
          </div>
        ) : !data || data.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            Henüz yükleme yok.
          </div>
        ) : (
          <div className="divide-y">
            {data.map((u) => {
              const meta = TYPE_META[u.type];
              const Icon = meta.icon;
              return (
                <div key={u.id}>
                  <div className="px-5 py-3 flex items-center gap-3">
                    <Icon className={`h-5 w-5 shrink-0 ${meta.color}`} />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{meta.label}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {(u.file_size_bytes / 1024).toFixed(0)} KB ·{" "}
                        {u.uploaded_by_user.full_name ?? u.uploaded_by_user.email} ·{" "}
                        {formatDistanceToNow(u.uploaded_at, { addSuffix: true, locale: tr })}
                      </div>
                    </div>
                    <Badge variant="secondary" className={`${STATUS_COLOR[u.status]} text-xs`}>
                      {STATUS_LABEL[u.status]}
                    </Badge>
                    {u.status === "parsed" ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-emerald-700 hover:text-emerald-700 hover:bg-emerald-50"
                        title="Onayla"
                        onClick={() => confirmMut.mutate({ id: u.id })}
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => openFile(u.id)}
                    >
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => {
                        if (confirm("Bu dosyayı silmek istediğine emin misin?")) {
                          del.mutate({ id: u.id });
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  {/* Parsed detail panel */}
                  {u.status === "parsed" || u.status === "confirmed" ? (
                    <>
                      {u.pos_slip ? <PosSlipDetails data={u.pos_slip} /> : null}
                      {u.store_summary ? <StoreSummaryDetails data={u.store_summary} /> : null}
                      {u.bank_receipt ? <BankReceiptDetails data={u.bank_receipt} /> : null}
                      {u.expense ? <ExpenseDetails data={u.expense} /> : null}
                    </>
                  ) : null}

                  {/* Failure detail */}
                  {u.status === "failed" && u.error_message ? (
                    <div className="border-t bg-rose-50/50 px-5 py-2 flex items-start gap-2 text-xs text-rose-700">
                      <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      <code className="font-mono whitespace-pre-wrap break-all">
                        {u.error_message}
                      </code>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
