"use client";

import { useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import {
  AnalyticsFilters,
  type AnalyticsSelection,
} from "@/components/analytics/analytics-filters";
import { ExpenseDashboard } from "@/components/analytics/expense-dashboard";

export default function ExpensesPage() {
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
        title="Gider Analizi"
        description="Marka, mağaza ve ay bazında giderlerinizi analiz edin."
      />
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
