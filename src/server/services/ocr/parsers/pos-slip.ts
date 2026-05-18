import "server-only";
import { getAnthropic, OCR_MODEL } from "@/lib/anthropic";
import { preprocessImage } from "../preprocess";
import { posSlipOcrSchema, type PosSlipOcr } from "../schemas/pos-slip";
import {
  POS_SLIP_SYSTEM_PROMPT,
  POS_SLIP_USER_PROMPT,
} from "../prompts/pos-slip";

type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

function extractJson(raw: string): string {
  // Try fenced first
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced && fenced[1]) return fenced[1].trim();
  // Fallback: first {…}
  const m = raw.match(/\{[\s\S]*\}/);
  if (m) return m[0];
  return raw.trim();
}

export async function parsePosSlip(opts: {
  buffer: Buffer;
  mimeType: string;
}): Promise<{ raw: unknown; parsed: PosSlipOcr; rawText: string }> {
  const isPdf = opts.mimeType === "application/pdf";

  let imageBuffer = opts.buffer;
  let mediaType: ImageMediaType = "image/jpeg";

  if (!isPdf) {
    const r = await preprocessImage(opts.buffer, opts.mimeType);
    imageBuffer = r.buffer;
    mediaType = r.mediaType;
  }

  const base64 = imageBuffer.toString("base64");
  const client = getAnthropic();

  const sourceBlock = isPdf
    ? ({
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: base64,
        },
      } as const)
    : ({
        type: "image",
        source: {
          type: "base64",
          media_type: mediaType,
          data: base64,
        },
      } as const);

  const response = await client.messages.create({
    model: OCR_MODEL,
    max_tokens: 1024,
    system: POS_SLIP_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        // SDK type fragmentation between image/document — cast at the boundary
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        content: [sourceBlock as any, { type: "text", text: POS_SLIP_USER_PROMPT }],
      },
    ],
  });

  const rawText = response.content
    .filter((c) => c.type === "text")
    .map((c) => (c as { type: "text"; text: string }).text)
    .join("\n");

  const jsonText = extractJson(rawText);
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch {
    throw new Error(`Claude returned non-JSON output: ${rawText.slice(0, 200)}`);
  }
  const parsed = posSlipOcrSchema.parse(raw);
  return { raw, parsed, rawText };
}
