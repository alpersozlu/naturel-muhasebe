"use client";

import { useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import {
  AnalyticsFilters,
  type AnalyticsSelection,
} from "@/components/analytics/analytics-filters";
import { RevenueDashboard } from "@/components/analytics/revenue-dashboard";
import { ExportExcelButton } from "@/components/analytics/export-button";
import { trpc } from "@/lib/trpc";

export default function RevenuesPage() {
  const now = new Date();
  const [sel, setSel] = useState<AnalyticsSelection>({
    brandId: "",
    storeId: "",
    year: now.getFullYear(),
    month: now.getMonth() + 1,
  });

  const utils = trpc.useUtils();
  const exportMutation = trpc.analytics.exportRevenue.useMutation();

  const handleExport = () =>
    exportMutation.mutateAsync({
      brand_id: sel.brandId || undefined,
      store_id: sel.storeId || undefined,
      year: sel.year,
      month: sel.month,
    });

  // utils needed to keep typings flowing via trpc context
  void utils;

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-2">
        <PageHeader
          title="Gelir Analizi"
          description="Mağazalar genelindeki nakit ve satış noktası gelir modellerini analiz edin."
        />
        <ExportExcelButton onExport={handleExport} />
      </div>
      <AnalyticsFilters value={sel} onChange={setSel} />
      <RevenueDashboard
        brandId={sel.brandId}
        storeId={sel.storeId}
        year={sel.year}
        month={sel.month}
      />
    </div>
  );
}
