"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { tryRecoverFromChunkError, isChunkLoadError } from "@/lib/is-chunk-error";

/**
 * Auth'lu sayfa grubunun hata sınırı.
 * - Chunk hatası (deploy sonrası stale sekme) → sessizce bir kez otomatik yenile.
 * - Diğer hatalar → şık Türkçe hata kartı + "Tekrar dene" / "Sayfayı yenile".
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Chunk hatasıysa render yerine reload tetikle (UI gösterme)
  const [recovering] = useState(() => isChunkLoadError(error));

  useEffect(() => {
    if (tryRecoverFromChunkError(error)) return;
    // Geliştirme tanısı için konsola yaz
    console.error("App error boundary:", error);
  }, [error]);

  if (recovering) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <RotateCw className="h-5 w-5 mr-2 animate-spin" />
        Yeni sürüm yükleniyor…
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto py-16">
      <Card>
        <CardContent className="py-12 text-center animate-fade-in">
          <div className="h-14 w-14 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="h-7 w-7" />
          </div>
          <div className="text-lg font-semibold text-foreground">
            Bir şeyler ters gitti
          </div>
          <p className="text-sm text-muted-foreground mt-1.5 max-w-sm mx-auto">
            Bu sayfa beklenmedik bir hatayla karşılaştı. Tekrar deneyebilir ya da
            sayfayı yenileyebilirsin.
          </p>
          {error.digest ? (
            <p className="text-[11px] text-muted-foreground/60 mt-3 font-mono">
              Hata kodu: {error.digest}
            </p>
          ) : null}
          <div className="flex items-center justify-center gap-2 mt-6">
            <Button variant="outline" onClick={() => reset()}>
              <RotateCw className="h-4 w-4 mr-1.5" />
              Tekrar dene
            </Button>
            <Button onClick={() => window.location.reload()}>
              Sayfayı yenile
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
