"use client";

import { useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import {
  AnalyticsFilters,
  type AnalyticsSelection,
} from "@/components/analytics/analytics-filters";
import { ExpenseDashboard } from "@/components/analytics/expense-dashboard";
import { ExportExcelButton } from "@/components/analytics/export-button";
import { trpc } from "@/lib/trpc";

export default function ExpensesPage() {
  const now = new Date();
  const [sel, setSel] = useState<AnalyticsSelection>({
    brandId: "",
    storeId: "",
    year: now.getFullYear(),
    month: now.getMonth() + 1,
  });

  const exportMutation = trpc.analytics.exportExpense.useMutation();

  const handleExport = () =>
    exportMutation.mutateAsync({
      brand_id: sel.brandId || undefined,
      store_id: sel.storeId || undefined,
      year: sel.year,
      month: sel.month,
    });

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-2">
        <PageHeader
          title="Gider Analizi"
          description="Marka, mağaza ve ay bazında giderlerinizi analiz edin."
        />
        <ExportExcelButton onExport={handleExport} />
      </div>
      <AnalyticsFilters value={sel} onChange={setSel} />
      <ExpenseDashboard
        brandId={sel.brandId}
        storeId={sel.storeId}
        year={sel.year}
        month={sel.month}
      />
    </div>
  );
}
