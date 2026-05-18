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

export type UploadSelection = {
  brandId: string;
  storeId: string;
  date: string; // YYYY-MM-DD
};

export function UploadSelectors({
  value,
  onChange,
}: {
  value: UploadSelection;
  onChange: (next: UploadSelection) => void;
}) {
  const { data: brands } = trpc.brand.list.useQuery();
  const { data: stores } = trpc.store.listByBrand.useQuery(
    { brand_id: value.brandId },
    { enabled: !!value.brandId }
  );

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
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
        <Label htmlFor="upload-date">Tarih</Label>
        <Input
          id="upload-date"
          type="date"
          value={value.date}
          onChange={(e) => onChange({ ...value, date: e.target.value })}
        />
      </div>
    </div>
  );
}
