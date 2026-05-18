import "server-only";
import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (client) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY tanımlı değil");
  }
  client = new Anthropic({ apiKey });
  return client;
}

export const OCR_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
