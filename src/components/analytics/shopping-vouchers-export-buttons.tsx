"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Download, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";

const TRY2 = new Intl.NumberFormat("tr-TR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}
function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!
  );
}

function triggerXlsxDownload(base64: string, filename: string): void {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ShoppingVouchersExportButtons({
  brandId,
  storeId,
  year,
  month,
}: {
  brandId: string;
  storeId: string;
  year: number;
  month: number;
}) {
  const [xlsxLoading, setXlsxLoading] = useState(false);
  const utils = trpc.useUtils();
  const exportXlsx = trpc.analytics.exportShoppingVouchers.useMutation();

  const filter = {
    brand_id: brandId || undefined,
    store_id: storeId || undefined,
    year,
    month,
  };

  const handleExcel = async () => {
    setXlsxLoading(true);
    try {
      const { base64, filename } = await exportXlsx.mutateAsync(filter);
      triggerXlsxDownload(base64, filename);
      toast.success("Excel indirildi");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Excel oluşturulamadı");
    } finally {
      setXlsxLoading(false);
    }
  };

  const handlePdf = async () => {
    try {
      const data = await utils.analytics.shoppingVouchers.fetch(filter);
      if (!data || data.entries.length === 0) {
        toast.error("Bu dönemde alışveriş çeki kaydı yok");
        return;
      }
      const html = buildPrintHtml(data);
      const w = window.open("", "_blank", "width=900,height=700");
      if (!w) {
        toast.error("Açılır pencere engellendi — izin ver, tekrar dene");
        return;
      }
      w.document.write(html);
      w.document.close();
      w.focus();
      setTimeout(() => w.print(), 350);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "PDF oluşturulamadı");
    }
  };

  return (
    <div className="flex gap-2">
      <Button variant="outline" size="sm" onClick={handlePdf}>
        <FileText className="h-4 w-4 mr-1.5" /> PDF / Yazdır
      </Button>
      <Button variant="outline" size="sm" disabled={xlsxLoading} onClick={handleExcel}>
        {xlsxLoading ? (
          <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
        ) : (
          <Download className="h-4 w-4 mr-1.5" />
        )}
        Excel
      </Button>
    </div>
  );
}

type SvData = Awaited<
  ReturnType<
    ReturnType<typeof trpc.useUtils>["analytics"]["shoppingVouchers"]["fetch"]
  >
>;

function buildPrintHtml(data: SvData): string {
  const fmt = (n: number) => `${TRY2.format(n)} ₺`;
  const rows = data.entries
    .map(
      (e) => `<tr>
        <td>${fmtDate(e.date)}</td>
        <td>${esc(e.brand_name)}</td>
        <td>${esc(e.store_name)}</td>
        <td class="r">${fmt(e.amount)}</td>
      </tr>`
    )
    .join("");

  return `<!DOCTYPE html><html lang="tr"><head><meta charset="utf-8">
  <title>Alışveriş Çeki Takibi — ${esc(data.period_label)}</title>
  <style>
    * { font-family: -apple-system, Arial, sans-serif; }
    body { margin: 24px; color: #1f2937; }
    h1 { font-size: 18px; margin: 0 0 2px; }
    .sub { font-size: 12px; color: #6b7280; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; margin-top: 4px; font-size: 12px; }
    th, td { padding: 5px 8px; border-bottom: 1px solid #e5e7eb; text-align: left; }
    th { background:#f9fafb; font-size: 10px; text-transform: uppercase; color:#6b7280; }
    .r { text-align: right; }
    .grand { margin-top: 16px; font-size: 15px; font-weight: 700; text-align: right; color:#4338ca; border-top:2px solid #1f2937; padding-top:8px; }
    @media print { body { margin: 12px; } }
  </style></head><body>
  <h1>Alışveriş Çeki Takibi (Türkiye İade Bildirimi)</h1>
  <div class="sub">${esc(data.period_label)} · ${data.entry_count} kayıt · Naturel Ticaret Muhasebe</div>
  <table><thead><tr><th>Tarih</th><th>Marka</th><th>Mağaza</th><th class="r">Alışveriş Çeki</th></tr></thead>
  <tbody>${rows}</tbody></table>
  <div class="grand">GENEL TOPLAM: ${fmt(data.grand_total)}</div>
  </body></html>`;
}
