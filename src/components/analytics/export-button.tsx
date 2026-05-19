"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

function triggerDownload(base64: string, filename: string): void {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
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

export function ExportExcelButton({
  onExport,
  label = "Excel'e Aktar",
}: {
  onExport: () => Promise<{ base64: string; filename: string }>;
  label?: string;
}) {
  const [loading, setLoading] = useState(false);

  const handle = async () => {
    setLoading(true);
    try {
      const { base64, filename } = await onExport();
      triggerDownload(base64, filename);
      toast.success("Excel indirildi");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Excel oluşturulamadı");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button variant="outline" size="sm" disabled={loading} onClick={handle}>
      {loading ? (
        <>
          <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
          Hazırlanıyor
        </>
      ) : (
        <>
          <Download className="h-4 w-4 mr-1.5" />
          {label}
        </>
      )}
    </Button>
  );
}
