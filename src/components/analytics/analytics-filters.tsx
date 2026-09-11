"use client";

import { trpc } from "@/lib/trpc";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
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
  /** Day range (YYYY-MM-DD, inclusive). Both set = range mode; otherwise month mode. */
  dateFrom?: string;
  dateTo?: string;
};

const iso = (d: Date) => d.toISOString().slice(0, 10);

export function AnalyticsFilters({
  value,
  onChange,
  showStore = true,
  allowRange = false,
}: {
  value: AnalyticsSelection;
  onChange: (v: AnalyticsSelection) => void;
  showStore?: boolean;
  /** Offer "Gün aralığı" next to the month picker (expense analysis). */
  allowRange?: boolean;
}) {
  const { data: brands } = trpc.brand.list.useQuery();
  const { data: stores } = trpc.store.listByBrand.useQuery(
    { brand_id: value.brandId },
    { enabled: !!value.brandId }
  );

  const now = new Date();
  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i);
  const rangeMode = allowRange && !!value.dateFrom && !!value.dateTo;

  // Switching to the range starts from the selected month; switching back
  // keeps year/month (already derived from the range end by the page).
  const toRange = () => {
    const from = new Date(Date.UTC(value.year, value.month - 1, 1));
    const last = new Date(Date.UTC(value.year, value.month, 0));
    const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    onChange({ ...value, dateFrom: iso(from), dateTo: iso(last < today ? last : today) });
  };
  const toMonth = () => onChange({ ...value, dateFrom: undefined, dateTo: undefined });
  const cols = (showStore ? 4 : 3) + (allowRange ? 1 : 0);
  const colsClass = cols === 5 ? "sm:grid-cols-5" : cols === 4 ? "sm:grid-cols-4" : "sm:grid-cols-3";

  return (
    <div className={`grid grid-cols-2 ${colsClass} gap-3 mb-6`}>
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

      {allowRange ? (
        <div className="space-y-1.5">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            Dönem
          </Label>
          <div
            role="radiogroup"
            aria-label="Dönem türü"
            className="grid grid-cols-2 h-10 rounded-md border border-input bg-background p-0.5 text-sm"
          >
            <button
              type="button"
              role="radio"
              aria-checked={!rangeMode}
              onClick={toMonth}
              className={`rounded-[5px] transition-colors ${
                !rangeMode ? "bg-foreground text-background font-medium" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Ay
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={rangeMode}
              onClick={toRange}
              className={`rounded-[5px] transition-colors ${
                rangeMode ? "bg-foreground text-background font-medium" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Gün aralığı
            </button>
          </div>
        </div>
      ) : null}

      {rangeMode ? (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Başlangıç
            </Label>
            <Input
              type="date"
              value={value.dateFrom}
              max={value.dateTo}
              onChange={(e) => e.target.value && onChange({ ...value, dateFrom: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Bitiş
            </Label>
            <Input
              type="date"
              value={value.dateTo}
              min={value.dateFrom}
              onChange={(e) => e.target.value && onChange({ ...value, dateTo: e.target.value })}
            />
          </div>
        </>
      ) : (
        <>
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
        </>
      )}
    </div>
  );
}
