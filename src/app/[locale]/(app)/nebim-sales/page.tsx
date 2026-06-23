"use client";

import { useState } from "react";
import { ListOrdered, BarChart3 } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import {
  NebimFilters,
  type NebimSalesSelection,
} from "@/components/nebim-sales/nebim-filters";
import { NebimList } from "@/components/nebim-sales/nebim-list";
import { NebimAnaliz } from "@/components/nebim-sales/nebim-analiz";

function defaultSelection(): NebimSalesSelection {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  // Varsayılan: içinde bulunulan ayın başından bugüne.
  return { storeId: "", dateFrom: `${y}-${m}-01`, dateTo: `${y}-${m}-${d}`, onlyReturns: false };
}

type Tab = "list" | "analiz";

const TABS: { key: Tab; label: string; icon: typeof ListOrdered }[] = [
  { key: "list", label: "Liste", icon: ListOrdered },
  { key: "analiz", label: "Analiz", icon: BarChart3 },
];

export default function NebimSalesPage() {
  const [sel, setSel] = useState<NebimSalesSelection>(defaultSelection);
  const [tab, setTab] = useState<Tab>("list");

  return (
    <div>
      <PageHeader
        title="Derimod Satışları (NEBIM)"
        description="NEBIM'den otomatik aktarılan perakende satışlar. Mağaza ve tarihe göre filtreleyebilirsin."
      />

      {/* Sekme seçici: Liste | Analiz */}
      <div className="inline-flex rounded-xl border border-border bg-muted/40 p-1 mb-4">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              tab === key
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      <NebimFilters value={sel} onChange={setSel} />

      {tab === "list" ? <NebimList filters={sel} /> : <NebimAnaliz filters={sel} />}
    </div>
  );
}
