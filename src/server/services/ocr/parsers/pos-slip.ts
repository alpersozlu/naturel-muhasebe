import "server-only";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { getAnthropic, OCR_MODEL } from "@/lib/anthropic";
import { preprocessReceipt } from "../preprocess";
import {
  posSlipOcrSchema,
  posSlipOutputSchema,
  type PosSlipOcr,
} from "../schemas/pos-slip";
import {
  POS_SLIP_SYSTEM_PROMPT,
  POS_SLIP_USER_PROMPT,
} from "../prompts/pos-slip";

/** Constrained decoders emit "" where the prompt says null; treat as null. */
function blankToNull<T extends Record<string, unknown>>(obj: T, keys: (keyof T)[]): T {
  for (const k of keys) {
    if (typeof obj[k] === "string" && (obj[k] as string).trim() === "") {
      (obj as Record<string, unknown>)[k as string] = null;
    }
  }
  return obj;
}

export async function parsePosSlip(opts: {
  buffer: Buffer;
  mimeType: string;
}): Promise<{ raw: unknown; parsed: PosSlipOcr; rawText: string; tiles: number }> {
  const isPdf = opts.mimeType === "application/pdf";

  // A long slip arrives as several tiles (top to bottom) in ONE request;
  // the prompt tells the model they are pieces of the same slip.
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
  content.push({ type: "text", text: POS_SLIP_USER_PROMPT });

  const client = getAnthropic();
  // Structured output: the decoder cannot narrate ("ADIM 1 …") before the
  // JSON; its only scratchpad is `check_notes`, first in the schema.
  const response = await client.messages.parse({
    model: OCR_MODEL,
    max_tokens: 2048,
    system: POS_SLIP_SYSTEM_PROMPT,
    messages: [{ role: "user", content }],
    output_config: { format: zodOutputFormat(posSlipOutputSchema) },
  });

  const rawText = response.content
    .filter((c) => c.type === "text")
    .map((c) => (c as { type: "text"; text: string }).text)
    .join("\n");

  const raw = response.parsed_output;
  if (!raw) {
    throw new Error(`Claude returned non-JSON output: ${rawText.slice(0, 200)}`);
  }
  blankToNull(raw, ["bank_name", "terminal_no", "date", "date_raw", "rejection_reason"]);
  for (const s of raw.sections) blankToNull(s, ["terminal_no"]);
  raw.sections = raw.sections.filter((s) => s.bank_name.trim() !== "");

  const parsed = posSlipOcrSchema.parse(raw);
  return { raw, parsed, rawText, tiles: tileCount };
}
