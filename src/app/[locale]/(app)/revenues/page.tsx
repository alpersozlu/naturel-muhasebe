"use client";

import { useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import {
  AnalyticsFilters,
  type AnalyticsSelection,
} from "@/components/analytics/analytics-filters";
import { RevenueDashboard } from "@/components/analytics/revenue-dashboard";

export default function RevenuesPage() {
  const now = new Date();
  const [sel, setSel] = useState<AnalyticsSelection>({
    brandId: "",
    storeId: "",
    year: now.getFullYear(),
    month: now.getMonth() + 1,
  });

  return (
    <div>
      <PageHeader
        title="Gelir Analizi"
        description="Mağazalar genelindeki nakit ve satış noktası gelir modellerini analiz edin."
      />
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
