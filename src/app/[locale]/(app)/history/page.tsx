"use client";

import { useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import {
  HistoryFilters,
  defaultSelection,
  type HistorySelection,
} from "@/components/history/history-filters";
import { HistoryList } from "@/components/history/history-list";

export default function HistoryPage() {
  const [sel, setSel] = useState<HistorySelection>(defaultSelection);

  return (
    <div>
      <PageHeader
        title="İşlem Geçmişi"
        description="Tüm yükleme işlemleri — filtreleyerek arayabilir, dosyaları aç ya da OCR durumunu inceleyebilirsin."
      />
      <HistoryFilters value={sel} onChange={setSel} />
      <HistoryList filters={sel} />
    </div>
  );
}
