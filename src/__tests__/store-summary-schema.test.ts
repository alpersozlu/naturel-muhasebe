import { describe, expect, it } from "vitest";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { storeSummaryOutputSchema } from "@/server/services/ocr/schemas/store-summary";

/**
 * 16 BİRLEŞİK ALAN SINIRI — 17.11.2026 kesintisinin nöbetçisi.
 *
 * Anthropic yapılandırılmış çıktıda şema başına en çok 16 "birleşik" (nullable
 * ya da union) alan kabul eder. `gift_voucher_used` nullable eklenince sayı
 * 17'ye çıktı; API her mağaza özetini 400 ile reddetti ("Schemas contains too
 * many parameters with union types … limit: 16") ve Derimod/Mavi özet
 * yüklemeleri 13 saat çalışmadı. Hata yalnız CANLIDA, OCR çağrısında görülüyor
 * — derleme de tip denetimi de temiz geçiyor. Bu yüzden sınır burada sayılır.
 *
 * Dizi alanları (it_pos_amounts, nebim_pay_totals) sayıya girmiyor: kesinti
 * anında şemada 19 birleşik alan vardı ve API "17 parameters" dedi.
 */
const UNION_LIMIT = 16;

function unionScalars(schema: unknown): string[] {
  const fmt = zodOutputFormat(schema as never) as unknown as Record<string, unknown>;
  const js = (fmt.schema ?? fmt) as { properties?: Record<string, { type?: unknown; anyOf?: unknown; oneOf?: unknown }> };
  const props = js.properties ?? {};
  return Object.entries(props)
    .filter(([, v]) => Array.isArray(v?.type) || !!v?.anyOf || !!v?.oneOf)
    .map(([k]) => k);
}

describe("mağaza özeti çıktı şeması", () => {
  it(`en çok ${UNION_LIMIT} nullable/union alan taşır`, () => {
    const found = unionScalars(storeSummaryOutputSchema);
    expect(found.length, `birleşik alanlar: ${found.join(", ")}`).toBeLessThanOrEqual(UNION_LIMIT);
  });

  it("gift_voucher_used nullable DEĞİL — satır yoksa 0 gelir", () => {
    expect(unionScalars(storeSummaryOutputSchema)).not.toContain("gift_voucher_used");
  });
});
