"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const MONTHS = [
  "Ocak",
  "Şubat",
  "Mart",
  "Nisan",
  "Mayıs",
  "Haziran",
  "Temmuz",
  "Ağustos",
  "Eylül",
  "Ekim",
  "Kasım",
  "Aralık",
];

export type VerificationSelection = {
  brandId: string;
  storeId: string;
  year: number;
  month: number;
};

/**
 * Doğrulama Sistemi araç çubuğu: marka › mağaza ve ay gezgini.
 * Ay ileri/geri okları en sık yapılan işi (önceki aya bakmak) tek tıka indirir;
 * yıl/ay seçicileri uzak dönemler için kalır.
 */
export function VerificationFilters({
  value,
  onChange,
}: {
  value: VerificationSelection;
  onChange: (v: VerificationSelection) => void;
}) {
  const { data: brands } = trpc.brand.list.useQuery();
  const { data: stores } = trpc.store.listByBrand.useQuery(
    { brand_id: value.brandId },
    { enabled: !!value.brandId }
  );

  const now = new Date();
  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i);
  const isCurrentMonth = value.year === now.getFullYear() && value.month === now.getMonth() + 1;

  const shiftMonth = (delta: number) => {
    let m = value.month + delta;
    let y = value.year;
    if (m < 1) {
      m = 12;
      y -= 1;
    } else if (m > 12) {
      m = 1;
      y += 1;
    }
    onChange({ ...value, year: y, month: m });
  };

  return (
    <div className="mb-5 rounded-2xl border border-border bg-card px-4 py-3 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="grid grid-cols-2 gap-3 sm:w-[28rem]">
          <div className="space-y-1.5">
            <Label htmlFor="verif-brand" className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Marka
            </Label>
            <Select
              value={value.brandId}
              onValueChange={(v) => onChange({ ...value, brandId: v, storeId: "" })}
            >
              <SelectTrigger id="verif-brand" className="h-10">
                <SelectValue placeholder="Marka seç" />
              </SelectTrigger>
              <SelectContent>
                {(brands ?? []).map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="verif-store" className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Mağaza
            </Label>
            <Select
              value={value.storeId}
              onValueChange={(v) => onChange({ ...value, storeId: v })}
              disabled={!value.brandId}
            >
              <SelectTrigger id="verif-store" className="h-10">
                <SelectValue placeholder={value.brandId ? "Mağaza seç" : "Önce marka"} />
              </SelectTrigger>
              <SelectContent>
                {(stores ?? []).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Dönem</div>
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-10 w-10 shrink-0"
              onClick={() => shiftMonth(-1)}
              aria-label="Önceki ay"
              title="Önceki ay"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Select
              value={String(value.month)}
              onValueChange={(v) => onChange({ ...value, month: Number(v) })}
            >
              <SelectTrigger className="h-10 w-[7.5rem]" aria-label="Ay">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONTHS.map((label, idx) => (
                  <SelectItem key={idx + 1} value={String(idx + 1)}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={String(value.year)}
              onValueChange={(v) => onChange({ ...value, year: Number(v) })}
            >
              <SelectTrigger className="h-10 w-[5.5rem]" aria-label="Yıl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {years.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-10 w-10 shrink-0"
              onClick={() => shiftMonth(1)}
              disabled={isCurrentMonth}
              aria-label="Sonraki ay"
              title={isCurrentMonth ? "Bu ay" : "Sonraki ay"}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            {!isCurrentMonth ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-10 px-3 text-xs"
                onClick={() => onChange({ ...value, year: now.getFullYear(), month: now.getMonth() + 1 })}
              >
                Bu ay
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
