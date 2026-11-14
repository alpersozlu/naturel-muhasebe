import "server-only";
import { getAnthropic, OCR_MODEL } from "@/lib/anthropic";
import { preprocessImage } from "../preprocess";
import { chequeOcrSchema, type ChequeOcr } from "../schemas/cheque";
import { CHEQUE_SYSTEM_PROMPT, CHEQUE_USER_PROMPT } from "../prompts/cheque";

function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced && fenced[1]) return fenced[1].trim();
  const m = raw.match(/\{[\s\S]*\}/);
  if (m) return m[0];
  return raw.trim();
}

export async function parseCheque(opts: {
  buffer: Buffer;
  mimeType: string;
  cachedRaw?: unknown;
}): Promise<{ raw: unknown; parsed: ChequeOcr }> {
  if (opts.cachedRaw) {
    return { raw: opts.cachedRaw, parsed: chequeOcrSchema.parse(opts.cachedRaw) };
  }
  const isPdf = opts.mimeType === "application/pdf";
  let imageBuffer = opts.buffer;
  let mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp" = "image/jpeg";
  if (!isPdf) {
    const r = await preprocessImage(opts.buffer, opts.mimeType);
    imageBuffer = r.buffer;
    mediaType = r.mediaType;
  }
  const base64 = imageBuffer.toString("base64");
  const sourceBlock = isPdf
    ? ({ type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } } as const)
    : ({ type: "image", source: { type: "base64", media_type: mediaType, data: base64 } } as const);

  const response = await getAnthropic().messages.create({
    model: OCR_MODEL,
    max_tokens: 1536,
    system: CHEQUE_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        content: [sourceBlock as any, { type: "text", text: CHEQUE_USER_PROMPT }],
      },
    ],
  });
  const rawText = response.content
    .filter((c) => c.type === "text")
    .map((c) => (c as { type: "text"; text: string }).text)
    .join("\n");
  let raw: unknown;
  try {
    raw = JSON.parse(extractJson(rawText));
  } catch {
    throw new Error(`Claude returned non-JSON output: ${rawText.slice(0, 200)}`);
  }
  return { raw, parsed: chequeOcrSchema.parse(raw) };
}
