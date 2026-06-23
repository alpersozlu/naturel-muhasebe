"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ALL = "__ALL__";

export type NebimSalesSelection = {
  storeId: string;
  dateFrom: string;
  dateTo: string;
  onlyReturns: boolean;
};

export function NebimFilters({
  value,
  onChange,
}: {
  value: NebimSalesSelection;
  onChange: (v: NebimSalesSelection) => void;
}) {
  // NEBIM verisi yalnız Derimod markasina ait — mağaza listesini ondan çek.
  const { data: brands } = trpc.brand.list.useQuery();
  const derimod = useMemo(
    () => (brands ?? []).find((b) => /derimod/i.test(b.name)),
    [brands]
  );
  const { data: stores } = trpc.store.listByBrand.useQuery(
    { brand_id: derimod?.id ?? "" },
    { enabled: !!derimod?.id }
  );

  const hasAny =
    !!value.storeId || !!value.dateFrom || !!value.dateTo || value.onlyReturns;

  // Tarih modu: "single" (tek gün, from=to) | "range" (başlangıç+bitiş).
  // Başlangıç modu: from≠to ise aralık, değilse tek gün.
  const [mode, setMode] = useState<"single" | "range">(
    value.dateFrom && value.dateTo && value.dateFrom !== value.dateTo
      ? "range"
      : "single"
  );
  const switchMode = (m: "single" | "range") => {
    if (m === "single") {
      // Aralıktan tek güne geçerken tek bir güne indir (başlangıcı baz al).
      const d = value.dateFrom || value.dateTo;
      onChange({ ...value, dateFrom: d, dateTo: d });
    }
    setMode(m);
  };

  return (
    <div className="rounded-xl border border-border/70 bg-card p-4 mb-6">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold">Filtreler</div>
        {hasAny ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground"
            onClick={() =>
              onChange({ storeId: "", dateFrom: "", dateTo: "", onlyReturns: false })
            }
          >
            <X className="h-3 w-3 mr-1" />
            Temizle
          </Button>
        ) : null}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="space-y-1.5">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Mağaza
          </Label>
          <Select
            value={value.storeId || ALL}
            onValueChange={(v) =>
              onChange({ ...value, storeId: v === ALL ? "" : v })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Tümü</SelectItem>
              {(stores ?? []).map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5 lg:col-span-2">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Tarih
            </Label>
            {/* Mod seçici: Tek Gün | Aralık (SAP "şunlar arasında" mantığı) */}
            <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
              {(
                [
                  ["single", "Tek Gün"],
                  ["range", "Aralık"],
                ] as const
              ).map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => switchMode(m)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                    mode === m
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {mode === "single" ? (
            <Input
              id="nb-from"
              type="date"
              value={value.dateFrom}
              onChange={(e) =>
                onChange({
                  ...value,
                  dateFrom: e.target.value,
                  dateTo: e.target.value,
                })
              }
            />
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <span className="block text-[9px] uppercase tracking-wider text-muted-foreground">
                  Başlangıç
                </span>
                <Input
                  id="nb-from"
                  type="date"
                  value={value.dateFrom}
                  onChange={(e) =>
                    onChange({ ...value, dateFrom: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1">
                <span className="block text-[9px] uppercase tracking-wider text-muted-foreground">
                  Bitiş
                </span>
                <Input
                  id="nb-to"
                  type="date"
                  value={value.dateTo}
                  onChange={(e) =>
                    onChange({ ...value, dateTo: e.target.value })
                  }
                />
              </div>
            </div>
          )}
        </div>

        <div className="space-y-1.5">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Kayıt Tipi
          </Label>
          <Select
            value={value.onlyReturns ? "returns" : "all"}
            onValueChange={(v) =>
              onChange({ ...value, onlyReturns: v === "returns" })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tümü</SelectItem>
              <SelectItem value="returns">Sadece İadeler</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
