"use client";

import { useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import {
  AnalyticsFilters,
  type AnalyticsSelection,
} from "@/components/analytics/analytics-filters";
import { ZAnalysisBlock } from "@/components/analytics/z-analysis-block";

export default function ZAnalysisPage() {
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
        title="Z Analizi"
        description="Toplam Z (Z Raporu + El Faturası) — Visa alt sınır kontrolü, mağaza karşılaştırma, aylık trend."
      />
      <AnalyticsFilters value={sel} onChange={setSel} />
      <ZAnalysisBlock
        brandId={sel.brandId}
        storeId={sel.storeId}
        year={sel.year}
        month={sel.month}
      />
    </div>
  );
}
