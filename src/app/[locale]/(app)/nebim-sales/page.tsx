"use client";

import { useState } from "react";
import { ListOrdered, BarChart3 } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { trpc } from "@/lib/trpc";
import { ExportExcelButton } from "@/components/analytics/export-button";
import type { DiscountBand } from "@/lib/zod-schemas/nebim-sales";
import {
  NebimFilters,
  type NebimSalesSelection,
} from "@/components/nebim-sales/nebim-filters";
import { NebimList } from "@/components/nebim-sales/nebim-list";
import { NebimAnaliz } from "@/components/nebim-sales/nebim-analiz";

function defaultSelection(): NebimSalesSelection {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  // Varsayılan: içinde bulunulan ayın başından bugüne.
  return {
    storeId: "",
    dateFrom: `${y}-${m}-01`,
    dateTo: `${y}-${m}-${d}`,
    onlyReturns: false,
    discountBand: "",
  };
}

type Tab = "list" | "analiz";

const TABS: { key: Tab; label: string; icon: typeof ListOrdered }[] = [
  { key: "list", label: "Liste", icon: ListOrdered },
  { key: "analiz", label: "Analiz", icon: BarChart3 },
];

export default function NebimSalesPage() {
  const [sel, setSel] = useState<NebimSalesSelection>(defaultSelection);
  const [tab, setTab] = useState<Tab>("list");
  const exportMutation = trpc.nebimSales.exportExcel.useMutation();

  return (
    <div>
      <PageHeader
        title="Derimod Satışları (NEBIM)"
        description="NEBIM'den otomatik aktarılan perakende satışlar. Mağaza ve tarihe göre filtreleyebilirsin."
      />

      {/* Sekme seçici + Excel'e aktar */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="inline-flex rounded-xl border border-border bg-muted/40 p-1">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                tab === key
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>

        {tab === "list" ? (
          <ExportExcelButton
            onExport={() =>
              exportMutation.mutateAsync({
                store_id: sel.storeId || undefined,
                date_from: sel.dateFrom || undefined,
                date_to: sel.dateTo || undefined,
                only_returns: sel.onlyReturns || undefined,
                discount_band: (sel.discountBand || undefined) as
                  | DiscountBand
                  | undefined,
              })
            }
          />
        ) : null}
      </div>

      <NebimFilters value={sel} onChange={setSel} />

      {tab === "list" ? <NebimList filters={sel} /> : <NebimAnaliz filters={sel} />}
    </div>
  );
}
