"use client";

import { useState } from "react";
import {
  Receipt,
  FileText,
  Building,
  Calculator,
  ShieldCheck,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { PageHeader } from "@/components/shared/page-header";
import {
  UploadSelectors,
  type UploadSelection,
} from "@/components/upload/upload-selectors";
import { UploadCard } from "@/components/upload/upload-card";
import { CashAdvanceCard } from "@/components/upload/cash-advance-card";
import { DailyCashCard } from "@/components/upload/daily-cash-card";
import { ManualInvoiceCard } from "@/components/upload/manual-invoice-card";
import { MasrafFaturaCard } from "@/components/upload/masraf-fatura-card";
import { GiftVoucherCard } from "@/components/upload/gift-voucher-card";
import { UploadList } from "@/components/upload/upload-list";
import { ReconciliationPanel } from "@/components/upload/reconciliation-panel";

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

export default function UploadPage() {
  const [sel, setSel] = useState<UploadSelection>({
    brandId: "",
    storeId: "",
    date: todayIso(),
  });

  const { data: me } = trpc.user.me.useQuery();
  const isAdmin = me?.role === "admin";

  return (
    <div>
      <PageHeader
        title="Yükle ve Analiz Et"
        description="Marka, mağaza ve gün seçimi yaparak gün sonu belgelerini yükleyin."
      />

      <UploadSelectors value={sel} onChange={setSel} />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <UploadCard
          type="z_report"
          label="Z Raporu"
          icon={Calculator}
          iconBg="bg-cyan-50"
          iconColor="text-cyan-600"
          storeId={sel.storeId}
          date={sel.date}
        />
        <UploadCard
          type="pos_slip"
          label="POS Fişi"
          icon={Receipt}
          iconBg="bg-purple-50"
          iconColor="text-purple-600"
          storeId={sel.storeId}
          date={sel.date}
          multiple
        />
        <UploadCard
          type="store_summary"
          label="Mağaza Özeti"
          icon={FileText}
          iconBg="bg-amber-50"
          iconColor="text-amber-600"
          storeId={sel.storeId}
          date={sel.date}
        />
        <UploadCard
          type="bank_receipt"
          label="İban Dekontu"
          icon={Building}
          iconBg="bg-blue-50"
          iconColor="text-blue-600"
          storeId={sel.storeId}
          date={sel.date}
        />
        <DailyCashCard storeId={sel.storeId} date={sel.date} />
        <GiftVoucherCard storeId={sel.storeId} date={sel.date} />
        <ManualInvoiceCard storeId={sel.storeId} date={sel.date} />
        <CashAdvanceCard storeId={sel.storeId} date={sel.date} />
        <MasrafFaturaCard storeId={sel.storeId} date={sel.date} />
        <UploadCard
          type="dealer_daily_report"
          label="Bayi Gün Sonu (SAP)"
          icon={ShieldCheck}
          iconBg="bg-indigo-50"
          iconColor="text-indigo-600"
          storeId={sel.storeId}
          date={sel.date}
        />
      </div>

      <UploadList storeId={sel.storeId} date={sel.date} />

      <ReconciliationPanel
        storeId={sel.storeId}
        date={sel.date}
        canApprove={isAdmin}
      />
    </div>
  );
}
