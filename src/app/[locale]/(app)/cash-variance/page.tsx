"use client";

import { useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import {
  AnalyticsFilters,
  type AnalyticsSelection,
} from "@/components/analytics/analytics-filters";
import { CashVarianceBlock } from "@/components/analytics/cash-variance-block";

export default function CashVariancePage() {
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
        title="Kasa Farkları"
        description="Mağaza özetiyle yüklenen belgeler arasındaki farkı mağaza ve gün bazında takip edin — eksik kasayı tespit edin."
      />
      <AnalyticsFilters value={sel} onChange={setSel} />
      <CashVarianceBlock
        brandId={sel.brandId}
        storeId={sel.storeId}
        year={sel.year}
        month={sel.month}
      />
    </div>
  );
}
