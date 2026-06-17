"use client";

import { useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import {
  NebimFilters,
  type NebimSalesSelection,
} from "@/components/nebim-sales/nebim-filters";
import { NebimList } from "@/components/nebim-sales/nebim-list";

function defaultSelection(): NebimSalesSelection {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  // Varsayılan: içinde bulunulan ayın başından bugüne.
  return { storeId: "", dateFrom: `${y}-${m}-01`, dateTo: `${y}-${m}-${d}`, onlyReturns: false };
}

export default function NebimSalesPage() {
  const [sel, setSel] = useState<NebimSalesSelection>(defaultSelection);

  return (
    <div>
      <PageHeader
        title="Derimod Satışları (NEBIM)"
        description="NEBIM'den otomatik aktarılan perakende satışlar. Mağaza ve tarihe göre filtreleyebilirsin."
      />
      <NebimFilters value={sel} onChange={setSel} />
      <NebimList filters={sel} />
    </div>
  );
}
