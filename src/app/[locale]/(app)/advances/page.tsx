"use client";

import { useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import {
  AnalyticsFilters,
  type AnalyticsSelection,
} from "@/components/analytics/analytics-filters";
import { AdvancesDashboard } from "@/components/analytics/advances-dashboard";
import { AdvancesExportButtons } from "@/components/analytics/advances-export-buttons";

export default function AdvancesPage() {
  const now = new Date();
  const [sel, setSel] = useState<AnalyticsSelection>({
    brandId: "",
    storeId: "",
    year: now.getFullYear(),
    month: now.getMonth() + 1,
  });

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-2">
        <PageHeader
          title="Avans Takip"
          description="Personel avanslarını ay bazında, kişi kişi tarihli takip et — maaştan kesinti için. PDF/Excel olarak indir."
        />
        <AdvancesExportButtons
          brandId={sel.brandId}
          storeId={sel.storeId}
          year={sel.year}
          month={sel.month}
        />
      </div>
      <AnalyticsFilters value={sel} onChange={setSel} />
      <AdvancesDashboard
        brandId={sel.brandId}
        storeId={sel.storeId}
        year={sel.year}
        month={sel.month}
      />
    </div>
  );
}
