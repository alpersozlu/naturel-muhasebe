"use client";

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

const TYPE_LABEL: Record<string, string> = {
  bank_receipt: "İban Dekontu",
  pos_slip: "POS Fişi",
  store_summary: "Mağaza Özeti",
  expense: "Masraf/Fatura",
  cash_advance: "Faturasız Peşin Ödeme",
  z_report: "Z Raporu",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Bekliyor",
  processing: "İşleniyor",
  parsed: "Okundu",
  confirmed: "Onaylandı",
  failed: "Başarısız",
};

export type HistorySelection = {
  brandId: string;
  storeId: string;
  type: string;
  status: string;
  dateFrom: string;
  dateTo: string;
};

export const defaultSelection: HistorySelection = {
  brandId: "",
  storeId: "",
  type: "",
  status: "",
  dateFrom: "",
  dateTo: "",
};

export function HistoryFilters({
  value,
  onChange,
}: {
  value: HistorySelection;
  onChange: (v: HistorySelection) => void;
}) {
  const { data: brands } = trpc.brand.list.useQuery();
  const { data: stores } = trpc.store.listByBrand.useQuery(
    { brand_id: value.brandId },
    { enabled: !!value.brandId }
  );

  const hasAny =
    !!value.brandId ||
    !!value.storeId ||
    !!value.type ||
    !!value.status ||
    !!value.dateFrom ||
    !!value.dateTo;

  return (
    <div className="rounded-xl border border-border/70 bg-card p-4 mb-6">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold">Filtreler</div>
        {hasAny ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground"
            onClick={() => onChange(defaultSelection)}
          >
            <X className="h-3 w-3 mr-1" />
            Temizle
          </Button>
        ) : null}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="space-y-1.5">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
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
              <SelectItem value={ALL}>Tümü</SelectItem>
              {(brands ?? []).map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
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
              <SelectItem value={ALL}>Tümü</SelectItem>
              {(stores ?? []).map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Tip
          </Label>
          <Select
            value={value.type || ALL}
            onValueChange={(v) => onChange({ ...value, type: v === ALL ? "" : v })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Tümü</SelectItem>
              {Object.entries(TYPE_LABEL).map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Durum
          </Label>
          <Select
            value={value.status || ALL}
            onValueChange={(v) =>
              onChange({ ...value, status: v === ALL ? "" : v })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Tümü</SelectItem>
              {Object.entries(STATUS_LABEL).map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label
            htmlFor="date-from"
            className="text-[10px] uppercase tracking-wider text-muted-foreground"
          >
            Başlangıç
          </Label>
          <Input
            id="date-from"
            type="date"
            value={value.dateFrom}
            onChange={(e) => onChange({ ...value, dateFrom: e.target.value })}
          />
        </div>

        <div className="space-y-1.5">
          <Label
            htmlFor="date-to"
            className="text-[10px] uppercase tracking-wider text-muted-foreground"
          >
            Bitiş
          </Label>
          <Input
            id="date-to"
            type="date"
            value={value.dateTo}
            onChange={(e) => onChange({ ...value, dateTo: e.target.value })}
          />
        </div>
      </div>
    </div>
  );
}
