"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Camera, Store } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { KATEGORI_LABEL, SELECTABLE_KATEGORILER } from "@/lib/masraf/categorize";
import type { MASRAF_KATEGORI_KEYS } from "@/lib/zod-schemas/invoiced-expense";

/**
 * KASA KALEMLERİ — mağazanın yüklediği masraf fişleri + faturasız peşin ödemeler
 * (avans hariç). Sistem her kalemi masraf satırına eşler; yönetici düzeltir.
 * "Kategorisi bulunamayan" kalemler DİĞER'e düşer ve öne çıkar.
 */
const MONTHS = ["", "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const fmt = (n: number) => n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dmy = (iso: string) => iso.slice(0, 10).split("-").reverse().join(".");
type Kategori = (typeof MASRAF_KATEGORI_KEYS)[number];
const STORE_CAT: Record<string, string> = {
  rent: "kira", electricity: "elektrik", water: "su", internet: "internet", stationery: "kırtasiye", cleaning: "temizlik", maintenance: "bakım", salary: "maaş",
  bonus: "avans", supplies: "sarf", food: "yemek", marketing: "pazarlama", labor: "işçi", tailor: "terzi", glazier: "camcı", other: "diğer",
};

export function CashItemsDialog({ year, month, brand, onClose }: { year: number; month: number; brand: "mavi" | "derimod"; onClose: () => void }) {
  const utils = trpc.useUtils();
  const q = trpc.invoicedExpense.cashItems.useQuery({ year, month, brand });
  const set = trpc.invoicedExpense.setCashCategory.useMutation({
    onSuccess: () => {
      void utils.invoicedExpense.cashItems.invalidate({ year, month, brand });
      void utils.invoicedExpense.report.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const [onlyReview, setOnlyReview] = useState(false);
  const [store, setStore] = useState("all");
  const items = useMemo(() => q.data ?? [], [q.data]);
  const stores = useMemo(() => Array.from(new Map(items.map((i) => [i.store_code, i.store_label])).entries()), [items]);
  const shown = items.filter((i) => (!onlyReview || i.needs_review) && (store === "all" || i.store_code === store));
  const total = shown.reduce((s, i) => s + i.amount_try, 0);
  const reviewCount = items.filter((i) => i.needs_review).length;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Kasa kalemleri — {MONTHS[month]} {year}</DialogTitle>
          <DialogDescription>
            Mağazaların yüklediği masraf fişleri ve faturasız peşin ödemeler (avans hariç). Satırı yanlış bulduğun kalemi düzelt; tablo anında güncellenir.
            {reviewCount ? ` ${reviewCount} kalemin kategorisi bulunamadı (Diğer).` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button type="button" onClick={() => setOnlyReview((v) => !v)} className={cn("rounded-full border px-2.5 py-1", onlyReview ? "border-amber-400 bg-amber-50 text-amber-800" : "border-border text-muted-foreground")}>
            <AlertTriangle className="mr-1 inline h-3 w-3" /> yalnız kategorisi bulunamayanlar
          </button>
          <Select value={store} onValueChange={setStore}>
            <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">Tüm mağazalar</SelectItem>
              {stores.map(([code, label]) => <SelectItem key={code} value={code} className="text-xs">{code} {label}</SelectItem>)}
            </SelectContent>
          </Select>
          <span className="ml-auto text-muted-foreground">{shown.length} kalem · {fmt(total)} ₺</span>
        </div>
        <div className="max-h-[60vh] overflow-y-auto rounded-lg border border-border/60">
          {q.isLoading ? (
            <div className="p-4 text-sm text-muted-foreground">Yükleniyor…</div>
          ) : shown.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">Kalem yok.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/60 text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Tarih</th>
                  <th className="px-3 py-2 text-left font-medium">Mağaza</th>
                  <th className="px-3 py-2 text-left font-medium">Kalem</th>
                  <th className="px-3 py-2 text-right font-medium">Tutar</th>
                  <th className="px-3 py-2 text-left font-medium">Masraf satırı</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((i) => (
                  <tr key={`${i.source}:${i.id}`} className={cn("border-t border-border/40 align-top", i.needs_review && "bg-amber-50/40")}>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums">{dmy(i.date)}</td>
                    <td className="whitespace-nowrap px-3 py-2">{i.store_label}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        {i.source === "expense" ? <Store className="h-3 w-3 text-muted-foreground" /> : null}
                        <span className="font-medium">{i.vendor ?? (i.source === "cash_advance" ? "Faturasız peşin ödeme" : "—")}</span>
                        {i.photo_id ? <Camera className="h-3 w-3 text-indigo-600" aria-label="sahibi fotoğrafını da yükledi" /> : null}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {i.description ?? ""}{i.document_no ? ` · No ${i.document_no}` : ""} · mağaza: {STORE_CAT[i.store_category] ?? i.store_category}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{fmt(i.amount_try)} ₺</td>
                    <td className="px-3 py-2">
                      <Select value={i.category} onValueChange={(v) => set.mutate({ source: i.source, id: i.id, category: v as Kategori })}>
                        <SelectTrigger className={cn("h-8 w-56 text-xs", i.needs_review && "border-amber-300", i.overridden && "border-indigo-300")}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {SELECTABLE_KATEGORILER.map((k) => <SelectItem key={k} value={k} className="text-xs">{KATEGORI_LABEL[k]}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      {i.overridden ? (
                        <button type="button" className="mt-0.5 text-[10px] text-indigo-700 underline" onClick={() => set.mutate({ source: i.source, id: i.id, category: null })}>
                          elle düzeltildi (otomatik: {KATEGORI_LABEL[i.auto_category as Kategori] ?? i.auto_category}) — geri al
                        </button>
                      ) : i.needs_review ? (
                        <div className="mt-0.5 text-[10px] text-amber-700">kategori bulunamadı</div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
