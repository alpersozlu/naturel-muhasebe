"use client";

import { useState } from "react";
import {
  Receipt,
  FileText,
  Building,
  Calculator,
  ShieldCheck,
  CalendarRange,
  CalendarDays,
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
import { MaviGiftVoucherCard } from "@/components/upload/mavi-gift-voucher-card";
import { UploadList } from "@/components/upload/upload-list";
import { ReconciliationPanel } from "@/components/upload/reconciliation-panel";
import { MergeWizard } from "@/components/upload/merge-wizard";

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
  // "single" = normal tek gün; "merge" = gün birleşmesi sihirbazı (Derimod)
  const [mode, setMode] = useState<"single" | "merge">("single");

  const { data: me } = trpc.user.me.useQuery();
  const isAdmin = me?.role === "admin";

  // Seçili marka Derimod mu? (Mavi Hediye Çeki kartı sadece Derimod'da görünür)
  const { data: brands } = trpc.brand.list.useQuery();
  const selectedBrand = brands?.find((b) => b.id === sel.brandId);
  const isDerimod =
    !!selectedBrand &&
    selectedBrand.name
      .toLocaleLowerCase("tr")
      .replace(/ı/g, "i")
      .includes("derimod");

  return (
    <div>
      <PageHeader
        title="Yükle ve Analiz Et"
        description="Marka, mağaza ve gün seçimi yaparak gün sonu belgelerini yükleyin."
      />

      <UploadSelectors value={sel} onChange={setSel} />

      {/* Mod seçimi — Gün Birleşmesi sadece Derimod'da */}
      {isDerimod && sel.storeId ? (
        <div className="mb-6 inline-flex items-center gap-1 rounded-xl border border-border bg-card p-1">
          <button
            type="button"
            onClick={() => setMode("single")}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              mode === "single"
                ? "bg-violet-600 text-white"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <CalendarDays className="h-3.5 w-3.5" />
            Tek Gün
          </button>
          <button
            type="button"
            onClick={() => setMode("merge")}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              mode === "merge"
                ? "bg-violet-600 text-white"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <CalendarRange className="h-3.5 w-3.5" />
            Gün Birleşmesi
          </button>
        </div>
      ) : null}

      {isDerimod && sel.storeId && mode === "merge" ? (
        <MergeWizard storeId={sel.storeId} isAdmin={isAdmin} />
      ) : (
      <>
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
        {/* Mavi Hediye Çeki — SADECE Derimod mağazaları */}
        {isDerimod ? (
          <MaviGiftVoucherCard storeId={sel.storeId} date={sel.date} />
        ) : null}
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
      </>
      )}
    </div>
  );
}
