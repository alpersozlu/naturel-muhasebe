import "server-only";
import sharp from "sharp";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { getAnthropic } from "@/lib/anthropic";

export type QuarterTurn = 0 | 90 | 180 | 270;

/** Small, fast model: the question is trivial for a vision model. */
const ORIENTATION_MODEL = process.env.OCR_ORIENTATION_MODEL || "claude-haiku-4-5";

const CANDIDATES: QuarterTurn[] = [0, 90, 270];

const pickSchema = z.object({
  upright_image: z.enum(["1", "2", "3"]),
});

const PROMPT =
  "Aynı basılı fişin üç farklı döndürülmüş hali: 1, 2 ve 3 numaralı görseller. " +
  "Hangisinde metin DÜZ okunuyor (satırlar yatay, harflerin tepesi yukarıda, " +
  "baş aşağı değil)? Sadece o görselin numarasını ver.";

/**
 * Which quarter turn stands the paper up — decided by showing the model the
 * paper turned three ways and asking which one reads upright.
 *
 * Why this shape of question: asking "how many degrees clockwise must this
 * turn?" got "90" from both Haiku and Sonnet on slips that in fact needed
 * 270 — the clockwise/counter-clockwise semantics are ambiguous to the
 * model and the answer flipped between runs. Comparing three renderings is
 * an easier, unambiguous task. And why a model at all: ink-profile
 * bumpiness, run-length ratios and left-alignment tests were each measured
 * on real slips and tracked the paper's shape or layout, not the text
 * direction. Any failure degrades to "no rotation"; it must never block an
 * upload. Called only for papers wider than tall (see preprocessReceipt).
 */
export async function detectOrientation(image: Buffer): Promise<QuarterTurn> {
  try {
    const client = getAnthropic();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const content: any[] = [];
    for (let i = 0; i < CANDIDATES.length; i++) {
      const turned = await sharp(image)
        .rotate(CANDIDATES[i]!)
        .resize({ width: 700, height: 700, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 70 })
        .toBuffer();
      content.push({ type: "text", text: `Görsel ${i + 1}:` });
      content.push({
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: turned.toString("base64") },
      });
    }
    content.push({ type: "text", text: PROMPT });
    const response = await client.messages.parse({
      model: ORIENTATION_MODEL,
      max_tokens: 64,
      messages: [{ role: "user", content }],
      output_config: { format: zodOutputFormat(pickSchema) },
    });
    const idx = Number(response.parsed_output?.upright_image ?? "1") - 1;
    return CANDIDATES[idx] ?? 0;
  } catch (e) {
    console.warn("[OCR] orientation check failed, assuming upright", e);
    return 0;
  }
}
