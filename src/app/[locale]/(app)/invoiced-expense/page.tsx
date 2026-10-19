"use client";

import { useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MaviMatrixSection, type BrandKey } from "@/components/masraf/mavi-matrix-section";
import { InvoicePhotosSection } from "@/components/masraf/invoice-photos-section";

const MONTHS = ["", "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const BRANDS: { key: BrandKey; label: string }[] = [
  { key: "mavi", label: "Mavi" },
  { key: "derimod", label: "Derimod" },
];

export default function InvoicedExpensePage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1); // 0 = tüm yıl (yalnız matris)
  const [brand, setBrand] = useState<BrandKey>("mavi");
  const yearOptions = [now.getFullYear() + (now.getMonth() >= 10 ? 1 : 0), now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2].filter((y, i, a) => a.indexOf(y) === i);
  const photoMonth = month === 0 ? now.getMonth() + 1 : month;

  return (
    <div>
      <PageHeader
        title="Masraflar"
        description="Ayın bütün masraf faturalarını fotoğrafla yükle; sistem okur, mağaza faturası mı şirket faturası mı ayırır, şirket faturalarını 7 mağazaya eşit dağıtır, kasa masraflarını ve bordroyu ekler ve 'Mavi Masraflar' tablosunu üretir."
      />

      {/* Dönem / marka seçici */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select value={brand} onValueChange={(v) => setBrand(v as BrandKey)}>
          <SelectTrigger className="h-9 w-[120px] text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>{BRANDS.map((b) => <SelectItem key={b.key} value={b.key}>{b.label}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
          <SelectTrigger className="h-9 w-[100px] text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>{yearOptions.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
          <SelectTrigger className="h-9 w-[140px] text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="0">Tüm yıl (tablo)</SelectItem>
            {MONTHS.slice(1).map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">Fotoğraflar seçili aya yüklenir{month === 0 ? ` (${MONTHS[photoMonth]})` : ""}.</span>
      </div>

      <InvoicePhotosSection year={year} month={photoMonth} />
      <MaviMatrixSection year={year} month={month} brand={brand} />
    </div>
  );
}
