"use client";

import { useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import {
  AnalyticsFilters,
  type AnalyticsSelection,
} from "@/components/analytics/analytics-filters";
import { ShoppingVouchersDashboard } from "@/components/analytics/shopping-vouchers-dashboard";
import { ShoppingVouchersExportButtons } from "@/components/analytics/shopping-vouchers-export-buttons";

export default function ShoppingVouchersPage() {
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
          title="Alışveriş Çekleri"
          description="Mağaza Özeti'nden okunan alışveriş çeki kullanımlarını ay bazında, tarihli takip et — Mavi HQ'ye (Türkiye) iade bildirimi için. Excel/PDF indir."
        />
        <ShoppingVouchersExportButtons
          brandId={sel.brandId}
          storeId={sel.storeId}
          year={sel.year}
          month={sel.month}
        />
      </div>
      <AnalyticsFilters value={sel} onChange={setSel} />
      <ShoppingVouchersDashboard
        brandId={sel.brandId}
        storeId={sel.storeId}
        year={sel.year}
        month={sel.month}
      />
    </div>
  );
}
