import "server-only";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { getAnthropic, OCR_MODEL } from "@/lib/anthropic";
import { preprocessImage } from "../preprocess";
import {
  storeSummaryOcrSchema,
  storeSummaryOutputSchema,
  type StoreSummaryOcr,
} from "../schemas/store-summary";
import {
  STORE_SUMMARY_SYSTEM_PROMPT,
  STORE_SUMMARY_USER_PROMPT,
} from "../prompts/store-summary";

export async function parseStoreSummary(opts: {
  buffer: Buffer;
  mimeType: string;
}): Promise<{ raw: unknown; parsed: StoreSummaryOcr; rawText: string }> {
  const isPdf = opts.mimeType === "application/pdf";

  let imageBuffer = opts.buffer;
  let mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp" =
    "image/jpeg";

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

  // Structured output: the decoder is constrained to `storeSummaryOutputSchema`,
  // so the model cannot narrate its steps in prose first. Measured before this
  // change: ~30 s and ~950 output tokens per store summary, occasionally
  // overrunning max_tokens with no JSON at all. See the schema comment.
  const response = await client.messages.parse({
    model: OCR_MODEL,
    max_tokens: 2048,
    system: STORE_SUMMARY_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        content: [sourceBlock as any, { type: "text", text: STORE_SUMMARY_USER_PROMPT }],
      },
    ],
    output_config: { format: zodOutputFormat(storeSummaryOutputSchema) },
  });

  const rawText = response.content
    .filter((c) => c.type === "text")
    .map((c) => (c as { type: "text"; text: string }).text)
    .join("\n");

  const raw = response.parsed_output;
  if (!raw) {
    throw new Error(`Claude returned non-JSON output: ${rawText.slice(0, 200)}`);
  }
  // Strict re-validation (date regex, currency default); strips check_notes
  // from `parsed` while `raw` keeps it for raw_ocr_json.
  const parsed = storeSummaryOcrSchema.parse(raw);
  return { raw, parsed, rawText };
}
