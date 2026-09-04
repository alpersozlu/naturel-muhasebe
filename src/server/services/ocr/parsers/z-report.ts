import "server-only";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { getAnthropic, OCR_MODEL } from "@/lib/anthropic";
import { preprocessReceipt } from "../preprocess";
import {
  zReportOcrSchema,
  zReportOutputSchema,
  type ZReportOcr,
} from "../schemas/z-report";
import {
  Z_REPORT_SYSTEM_PROMPT,
  Z_REPORT_USER_PROMPT,
} from "../prompts/z-report";

/** Constrained decoders emit "" where the prompt says null; treat as null. */
function blankToNull<T extends Record<string, unknown>>(obj: T, keys: (keyof T)[]): T {
  for (const k of keys) {
    if (typeof obj[k] === "string" && (obj[k] as string).trim() === "") {
      (obj as Record<string, unknown>)[k as string] = null;
    }
  }
  return obj;
}

export async function parseZReport(opts: {
  buffer: Buffer;
  mimeType: string;
}): Promise<{ raw: unknown; parsed: ZReportOcr; rawText: string; tiles: number }> {
  const isPdf = opts.mimeType === "application/pdf";

  // A Z report is a long till strip: same paper crop + tiling as POS slips.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const content: any[] = [];
  let tileCount = 1;
  if (isPdf) {
    content.push({
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: opts.buffer.toString("base64"),
      },
    });
  } else {
    const r = await preprocessReceipt(opts.buffer, opts.mimeType);
    tileCount = r.tiles.length;
    for (const tile of r.tiles) {
      content.push({
        type: "image",
        source: { type: "base64", media_type: r.mediaType, data: tile.toString("base64") },
      });
    }
  }
  content.push({ type: "text", text: Z_REPORT_USER_PROMPT });

  const client = getAnthropic();
  const response = await client.messages.parse({
    model: OCR_MODEL,
    max_tokens: 2048,
    system: Z_REPORT_SYSTEM_PROMPT,
    messages: [{ role: "user", content }],
    output_config: { format: zodOutputFormat(zReportOutputSchema) },
  });

  const rawText = response.content
    .filter((c) => c.type === "text")
    .map((c) => (c as { type: "text"; text: string }).text)
    .join("\n");

  const raw = response.parsed_output;
  if (!raw) {
    throw new Error(`Claude returned non-JSON output: ${rawText.slice(0, 200)}`);
  }
  blankToNull(raw, ["report_no", "report_date", "report_date_raw", "rejection_reason"]);

  const parsed = zReportOcrSchema.parse(raw);
  return { raw, parsed, rawText, tiles: tileCount };
}
