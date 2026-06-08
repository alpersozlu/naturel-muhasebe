"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Download, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";

const STAFF_ROLE_LABEL: Record<string, string> = {
  manager: "Müdür",
  assistant_manager: "Müdür Yardımcısı",
  sales_staff: "Satış Elemanı",
};
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

export function AdvancesExportButtons({
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
  const exportXlsx = trpc.analytics.exportAdvances.useMutation();

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
      const data = await utils.analytics.advances.fetch(filter);
      if (!data || data.people.length === 0) {
        toast.error("Bu dönemde avans kaydı yok");
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

type AdvData = Awaited<
  ReturnType<ReturnType<typeof trpc.useUtils>["analytics"]["advances"]["fetch"]>
>;

function buildPrintHtml(data: AdvData): string {
  const fmt = (n: number) => `${TRY2.format(n)} ₺`;
  const peopleHtml = data.people
    .map((p) => {
      const rows = p.entries
        .map(
          (e) => `<tr>
            <td>${fmtDate(e.date)}</td>
            <td>${esc(e.store_name)}</td>
            <td>${esc(e.note ?? "—")}</td>
            <td class="r">${fmt(e.amount)}</td>
          </tr>`
        )
        .join("");
      const role = p.staff_role
        ? STAFF_ROLE_LABEL[p.staff_role] ?? p.staff_role
        : "";
      return `<div class="person">
        <div class="phead"><b>${esc(p.staff_name)}</b> ${role ? `<span class="role">${esc(role)}</span>` : ""}
          <span class="ptotal">Toplam: ${fmt(p.total)}</span></div>
        <table><thead><tr><th>Tarih</th><th>Mağaza</th><th>Not</th><th class="r">Tutar</th></tr></thead>
        <tbody>${rows}</tbody></table>
      </div>`;
    })
    .join("");

  return `<!DOCTYPE html><html lang="tr"><head><meta charset="utf-8">
  <title>Avans Takip — ${esc(data.period_label)}</title>
  <style>
    * { font-family: -apple-system, Arial, sans-serif; }
    body { margin: 24px; color: #1f2937; }
    h1 { font-size: 18px; margin: 0 0 2px; }
    .sub { font-size: 12px; color: #6b7280; margin-bottom: 16px; }
    .person { margin-bottom: 18px; break-inside: avoid; }
    .phead { font-size: 13px; padding: 6px 0; border-bottom: 2px solid #6366f1; display:flex; gap:8px; align-items:center; }
    .role { font-size: 10px; background:#eef2ff; color:#4338ca; padding:1px 6px; border-radius:8px; }
    .ptotal { margin-left:auto; font-weight:600; color:#dc2626; }
    table { width: 100%; border-collapse: collapse; margin-top: 4px; font-size: 12px; }
    th, td { padding: 4px 8px; border-bottom: 1px solid #e5e7eb; text-align: left; }
    th { background:#f9fafb; font-size: 10px; text-transform: uppercase; color:#6b7280; }
    .r { text-align: right; }
    .grand { margin-top: 16px; font-size: 15px; font-weight: 700; text-align: right; color:#dc2626; border-top:2px solid #1f2937; padding-top:8px; }
    @media print { body { margin: 12px; } }
  </style></head><body>
  <h1>Avans Takip Raporu</h1>
  <div class="sub">${esc(data.period_label)} · ${data.people.length} kişi · ${data.entry_count} kayıt · Naturel Ticaret Muhasebe</div>
  ${peopleHtml}
  <div class="grand">GENEL TOPLAM: ${fmt(data.grand_total)}</div>
  </body></html>`;
}
