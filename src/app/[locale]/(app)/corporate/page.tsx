"use client";

import { useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import {
  AnalyticsFilters,
  type AnalyticsSelection,
} from "@/components/analytics/analytics-filters";
import { CorporateDashboard } from "@/components/analytics/corporate-dashboard";

export default function CorporatePage() {
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
        title="Kurumsal & Yönetim Alışverişi"
        description="Anlaşmalı şirket (Kaner, Tip-İş...) ve yönetici/kişi alışverişlerinin kişi ve şirket bazında aylık + yıllık dökümü; kalan borçlar ile birlikte."
      />
      <AnalyticsFilters value={sel} onChange={setSel} />
      <CorporateDashboard
        brandId={sel.brandId}
        storeId={sel.storeId}
        year={sel.year}
        month={sel.month}
      />
    </div>
  );
}
