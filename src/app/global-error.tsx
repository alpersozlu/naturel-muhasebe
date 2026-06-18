"use client";

import { useEffect } from "react";
import { tryRecoverFromChunkError } from "@/lib/is-chunk-error";

/**
 * En üst seviye hata sınırı — root/locale layout bile patlarsa devreye girer.
 * Kendi <html>/<body>'sini render eder; Tailwind garantili olmadığı için
 * inline stil kullanır. Chunk hatasında otomatik bir kez yeniler.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (tryRecoverFromChunkError(error)) return;
    console.error("Global error boundary:", error);
  }, [error]);

  return (
    <html lang="tr">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
          background: "#f8fafc",
          color: "#0f172a",
        }}
      >
        <div style={{ textAlign: "center", padding: 32, maxWidth: 420 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              background: "#fff1f2",
              color: "#e11d48",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 16px",
              fontSize: 28,
            }}
          >
            ⚠
          </div>
          <h1 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 6px" }}>
            Bir şeyler ters gitti
          </h1>
          <p style={{ fontSize: 14, color: "#64748b", margin: "0 0 24px" }}>
            Uygulama beklenmedik bir hatayla karşılaştı. Sayfayı yenilemeyi dene.
          </p>
          <button
            onClick={() => reset()}
            style={{
              background: "#4f46e5",
              color: "#fff",
              border: "none",
              borderRadius: 10,
              padding: "10px 20px",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Sayfayı yenile
          </button>
        </div>
      </body>
    </html>
  );
}
