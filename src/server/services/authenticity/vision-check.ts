import "server-only";
import sharp from "sharp";
import convertHeic from "heic-convert";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { getAnthropic, OCR_MODEL } from "@/lib/anthropic";

/**
 * Second pair of eyes on the ORIGINAL upload (not the OCR tiles): is this a
 * camera photo / scan of a physical document, or a picture that was made on
 * a computer? First seen 2026-09-20: a machine-generated "POS gün sonu" slip
 * for exactly the day's missing amount, with the tell-tale artefacts of
 * generated text ("GÜNSONU ÜZET", broken glyphs) and none of a photograph's
 * (hand, surface, perspective, uneven light).
 *
 * The model is asked for observations, not for a verdict on a person. Its
 * answer is one signal among several; see assess.ts for how it is weighed.
 */
export const AUTHENTICITY_MODEL = process.env.AUTHENTICITY_MODEL || OCR_MODEL;

export const visionCheckSchema = z.object({
  // Scratchpad first: what is physically visible, before any judgement.
  observations: z.string(),
  capture_type: z.enum([
    "camera_photo_of_paper", // hand, table, perspective, shadows, uneven light
    "flatbed_scan", // real paper, even light, scanner artefacts
    "photo_of_screen", // moiré, screen bezel, pixels
    "screenshot_or_digital_export", // app/PDF export: legitimately digital
    "computer_generated_picture_of_paper", // rendered/generated image imitating a photo of paper
    "unclear",
  ]),
  synthetic_likelihood: z.enum(["low", "medium", "high"]),
  /** Exact strings as they appear, only for fixed printed labels that are
   *  misspelled or contain malformed / mixed glyphs. Empty when none. */
  label_anomalies: z.array(z.string()),
  /** Short, concrete, checkable reasons (Turkish). */
  reasons: z.array(z.string()),
  merchant_header: z.string(),
  document_date_text: z.string(),
});
export type VisionCheck = z.infer<typeof visionCheckSchema>;

const SYSTEM = `Bir perakende zincirinin belge denetçisisin. Mağazalar gün sonu belgelerinin FOTOĞRAFINI yükler: POS gün sonu slibi, Z raporu, mağaza özeti, banka dekontu, masraf fişi. Görevin yüklenen görselin fiziksel bir belgenin gerçek görüntüsü mü, yoksa bilgisayarda üretilmiş/yapay zekâ ile oluşturulmuş bir görsel mi olduğunu GÖZLEME dayalı değerlendirmek.

ÖNCE GÖZLEMLE (observations): ışık, gölge, perspektif, kâğıdın kıvrımı/buruşukluğu, tutan el ya da zemin, odak bulanıklığı, baskı kalitesi, yazı tipi tutarlılığı, arka plan.

GERÇEK FOTOĞRAFIN İZLERİ: eğik açı/perspektif, düzensiz ışık ve gölge, kâğıtta kıvrım-yırtık-buruşma, parmak/masa/tezgâh, hafif bulanıklık, termal baskıda soluk ya da kesik noktalar.

ÜRETİLMİŞ GÖRSELİN İZLERİ:
- Sabit etiketlerde yazım hatası ya da bozuk/karışık harf. POS ve yazarkasa yazıcıları etiketleri SABİT yazılımdan basar; "GÜNSONU ÖZET", "RAPOR SONU", "TOPLAM", "TARİH", "İŞYERİ NO", "TERMİNAL NO", "BU BELGEYİ SAKLAYINIZ" gibi kelimelerde yazım hatası olmaz. "ÜZET", yarım/iç içe harfler, anlamsız kelimeler güçlü işarettir. Bulduğun her birini label_anomalies'e AYNEN yaz.
- Kusursuz düz ve eşit aydınlatma, sıfır perspektif, tek renk yapay arka plan, kâğıt kenarlarında çizim gibi düzgün tırtık.
- Termal yazıcının basamayacağı pürüzsüz vektör logo, belge içinde birbirine uymayan yazı tipleri.

DİKKAT — BUNLAR TEK BAŞINA ŞÜPHE DEĞİLDİR:
- Türkçe noktalı harflerin basılmaması (TARIH, ISLEM, SATIS, GUNSONU OZET): eski POS yazıcılarında NORMALDİR.
- Banka dekontu ve mağaza özeti çoğu zaman ekran görüntüsü ya da PDF çıktısıdır; bunlar "screenshot_or_digital_export"tur ve meşrudur.
- Düşük çözünürlük, WhatsApp sıkıştırması, meta verisi olmaması.
- Senin okuyamadığın silik yazı anomali DEĞİLDİR; yalnız NET okunup YANLIŞ olan etiketleri yaz.
- label_anomalies YALNIZ sabit basılı etiketler içindir. Tutarlar, tarihler, isimler, yazıyla tutar satırı ("BEŞBİNALTIYÜZTL" gibi bitişik yazım bankalarda normaldir), açıklama metinleri buraya GİRMEZ.

synthetic_likelihood: "high" yalnız somut iz varsa (etiket anomalisi ya da açıkça çizim/üretim görünümü). Emin değilsen "low" ya da "medium" de. reasons: kısa, somut, Türkçe maddeler.`;

/** The model has no clock: without today's date it reads the current year as
 *  "a future date" and calls honest documents suspicious (measured). */
function userPrompt(): string {
  const today = new Date().toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul" });
  return `Bugünün tarihi ${today}. Belgedeki tarih bugüne yakınsa bu NORMALDİR; tarih bir anomali değildir ve değerlendirmene girmez. Bu yüklenen belge görselini değerlendir.`;
}

/** Returns null on any failure: this check must never block an upload. */
export async function visionCheck(opts: { buffer: Buffer; mimeType: string }): Promise<VisionCheck | null> {
  try {
    if (opts.mimeType === "application/pdf") return null;
    let working = opts.buffer;
    if (opts.mimeType === "image/heic" || opts.mimeType === "image/heif") {
      working = Buffer.from(
        await convertHeic({ buffer: opts.buffer as unknown as ArrayBufferLike, format: "JPEG", quality: 0.92 })
      );
    }
    // Whole frame, EXIF-upright, large enough to read labels. No cropping and
    // no contrast work: the surroundings and the light ARE the evidence.
    const image = await sharp(working)
      .rotate()
      .resize({ width: 1568, height: 1568, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 88 })
      .toBuffer();

    const response = await getAnthropic().messages.parse(
      {
        model: AUTHENTICITY_MODEL,
        max_tokens: 1500,
        system: SYSTEM,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image.toString("base64") } },
              { type: "text", text: userPrompt() },
            ],
          },
        ],
        output_config: { format: zodOutputFormat(visionCheckSchema) },
      },
      { timeout: 35_000 }
    );
    return response.parsed_output ?? null;
  } catch (e) {
    console.error("[authenticity] vision check failed", e instanceof Error ? e.message : e);
    return null;
  }
}
