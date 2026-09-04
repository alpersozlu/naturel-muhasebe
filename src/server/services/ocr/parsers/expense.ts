import "server-only";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { getAnthropic, OCR_MODEL } from "@/lib/anthropic";
import { preprocessReceipt } from "../preprocess";
import {
  expenseOcrSchema,
  expenseOutputSchema,
  type ExpenseOcr,
} from "../schemas/expense";
import {
  EXPENSE_SYSTEM_PROMPT,
  EXPENSE_USER_PROMPT,
} from "../prompts/expense";

/** Constrained decoders emit "" where the prompt says null; treat as null. */
function blankToNull<T extends Record<string, unknown>>(obj: T, keys: (keyof T)[]): T {
  for (const k of keys) {
    if (typeof obj[k] === "string" && (obj[k] as string).trim() === "") {
      (obj as Record<string, unknown>)[k as string] = null;
    }
  }
  return obj;
}

export async function parseExpense(opts: {
  buffer: Buffer;
  mimeType: string;
}): Promise<{ raw: unknown; parsed: ExpenseOcr; rawText: string; tiles: number }> {
  const isPdf = opts.mimeType === "application/pdf";

  // Invoices are photographed on desks like slips are: crop to the paper,
  // stand sideways shots up, tile a long market receipt.
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
  content.push({ type: "text", text: EXPENSE_USER_PROMPT });

  const client = getAnthropic();
  const response = await client.messages.parse({
    model: OCR_MODEL,
    max_tokens: 2048,
    system: EXPENSE_SYSTEM_PROMPT,
    messages: [{ role: "user", content }],
    output_config: { format: zodOutputFormat(expenseOutputSchema) },
  });

  const rawText = response.content
    .filter((c) => c.type === "text")
    .map((c) => (c as { type: "text"; text: string }).text)
    .join("\n");

  const raw = response.parsed_output;
  if (!raw) {
    throw new Error(`Claude returned non-JSON output: ${rawText.slice(0, 200)}`);
  }
  blankToNull(raw, ["vendor", "expense_date", "expense_date_raw", "description", "rejection_reason"]);
  if (raw.description && raw.description.length > 200) {
    raw.description = raw.description.slice(0, 200);
  }

  const parsed = expenseOcrSchema.parse(raw);
  return { raw, parsed, rawText, tiles: tileCount };
}
