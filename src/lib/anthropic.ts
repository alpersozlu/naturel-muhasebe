import "server-only";
import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (client) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY tanımlı değil");
  }
  // Only the OCR parsers use this client, and they run inside a Vercel
  // function with maxDuration 60 s (preprocessing takes 5–10 s of that).
  // The SDK default — 10 min timeout, 2 retries — means a stalled call is
  // simply killed with the function and the upload sits in "processing"
  // until the sweep marks it failed. Measured 2026-09-04: one call hung for
  // 304 s. Failing fast with a clear error is the better outcome; a retry
  // would not fit in the budget anyway.
  client = new Anthropic({ apiKey, timeout: 45_000, maxRetries: 0 });
  return client;
}

export const OCR_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
