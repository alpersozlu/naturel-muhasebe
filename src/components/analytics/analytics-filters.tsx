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

const ALL = "__ALL__";

export type AnalyticsSelection = {
  brandId: string;
  storeId: string;
  year: number;
  month: number;
};

export function AnalyticsFilters({
  value,
  onChange,
  showStore = true,
}: {
  value: AnalyticsSelection;
  onChange: (v: AnalyticsSelection) => void;
  showStore?: boolean;
}) {
  const { data: brands } = trpc.brand.list.useQuery();
  const { data: stores } = trpc.store.listByBrand.useQuery(
    { brand_id: value.brandId },
    { enabled: !!value.brandId }
  );

  const now = new Date();
  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i);

  return (
    <div className={`grid grid-cols-2 ${showStore ? "sm:grid-cols-4" : "sm:grid-cols-3"} gap-3 mb-6`}>
      <div className="space-y-1.5">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">
          Marka
        </Label>
        <Select
          value={value.brandId || ALL}
          onValueChange={(v) =>
            onChange({ ...value, brandId: v === ALL ? "" : v, storeId: "" })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Tüm Markalar</SelectItem>
            {(brands ?? []).map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {showStore ? (
        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            Mağaza
          </Label>
          <Select
            value={value.storeId || ALL}
            onValueChange={(v) =>
              onChange({ ...value, storeId: v === ALL ? "" : v })
            }
            disabled={!value.brandId}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Tüm Mağazalar</SelectItem>
              {(stores ?? []).map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">
          Yıl
        </Label>
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

      <div className="space-y-1.5">
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">
          Ay
        </Label>
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
