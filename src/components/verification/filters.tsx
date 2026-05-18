"use client";

import { trpc } from "@/lib/trpc";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const MONTHS = [
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

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
      <div className="space-y-2">
        <Label>Marka</Label>
        <Select
          value={value.brandId}
          onValueChange={(v) => onChange({ ...value, brandId: v, storeId: "" })}
        >
          <SelectTrigger>
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

      <div className="space-y-2">
        <Label>Mağaza</Label>
        <Select
          value={value.storeId}
          onValueChange={(v) => onChange({ ...value, storeId: v })}
          disabled={!value.brandId}
        >
          <SelectTrigger>
            <SelectValue placeholder="Mağaza seç" />
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

      <div className="space-y-2">
        <Label>Yıl</Label>
        <Select
          value={String(value.year)}
          onValueChange={(v) => onChange({ ...value, year: Number(v) })}
        >
          <SelectTrigger>
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
      </div>

      <div className="space-y-2">
        <Label>Ay</Label>
        <Select
          value={String(value.month)}
          onValueChange={(v) => onChange({ ...value, month: Number(v) })}
        >
          <SelectTrigger>
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
      </div>
    </div>
  );
}
