import "server-only";
import type { PrismaClient, Upload } from "@prisma/client";
import { inspectFile, type FileForensics } from "./file-forensics";
import { visionCheck, type VisionCheck } from "./vision-check";
import { computeDay } from "@/server/services/verification/compute";

/**
 * Is an uploaded document a real capture of a physical / system document, or
 * something made to look like one?
 *
 * Three independent layers, weakest alone, decisive together:
 *  1. file      — provenance manifests and generator output sizes (bytes).
 *  2. vision    — what the picture itself shows (see vision-check.ts).
 *  3. context   — does the slip fit this store's own history and the day's
 *                 arithmetic?
 *
 * Verdicts:
 *  - "synthetic"  hard evidence → the upload is refused and the admins are
 *                 told why. The uploader gets a neutral message: the reasons
 *                 are a how-to for the next attempt.
 *  - "suspicious" kept and counted, but flagged: only an admin can lock the
 *                 day until an admin has looked at it.
 *  - "ok"
 *  - "cleared"    an admin reviewed a flag and accepted the document (set by
 *                 upload.reviewAuthenticity; never produced here).
 */
export type AuthenticityLevel = "ok" | "suspicious" | "synthetic";

export type AuthenticityReport = {
  level: AuthenticityLevel;
  /** Admin-facing, Turkish, most important first. */
  reasons: string[];
  file: FileForensics;
  vision: VisionCheck | null;
  context: ContextSignals | null;
  checked_at: string;
};

export type ContextSignals = {
  unknown_terminals: Array<{ bank: string; terminal: string; known: string[] }>;
  closes_total_but_not_cards: { slip_total: number; card_row_gap: number } | null;
};

/** Documents that only exist on paper: a rendered image of one is never legitimate. */
const PAPER_TYPES = new Set<Upload["type"]>(["pos_slip", "z_report", "expense"]);
export const ASSESSED_TYPES = new Set<Upload["type"]>([
  "pos_slip",
  "z_report",
  "store_summary",
  "bank_receipt",
  "expense",
]);

/** Phase 1 — runs alongside OCR: bytes + picture. */
export async function inspectUpload(opts: {
  buffer: Buffer;
  mimeType: string;
}): Promise<{ file: FileForensics; vision: VisionCheck | null }> {
  const [file, vision] = await Promise.all([inspectFile(opts.buffer), visionCheck(opts)]);
  return { file, vision };
}

/** Phase 2 — after OCR has written its rows: store history and day arithmetic. */
export async function contextSignals(prisma: PrismaClient, upload: Upload): Promise<ContextSignals | null> {
  if (upload.type !== "pos_slip") return null;
  try {
    const dr = await prisma.dailyRecord.findUnique({ where: { id: upload.daily_record_id }, select: { store_id: true } });
    if (!dr) return null;
    const mine = await prisma.posSlip.findMany({ where: { upload_id: upload.id } });
    if (mine.length === 0) return null;

    // This store's earlier slips from OTHER uploads: which terminals does each bank use here?
    const history = await prisma.posSlip.findMany({
      where: { daily_record: { store_id: dr.store_id }, upload_id: { not: upload.id }, terminal_no: { not: null } },
      select: { bank_name: true, terminal_no: true },
      take: 500,
    });
    const byBank = new Map<string, Set<string>>();
    for (const h of history) {
      const k = bankKey(h.bank_name);
      if (!k || !h.terminal_no) continue;
      (byBank.get(k) ?? byBank.set(k, new Set()).get(k)!).add(normTerminal(h.terminal_no));
    }
    const unknown: ContextSignals["unknown_terminals"] = [];
    for (const s of mine) {
      const k = bankKey(s.bank_name);
      const t = s.terminal_no ? normTerminal(s.terminal_no) : "";
      const known = k ? Array.from(byBank.get(k) ?? []) : [];
      // Needs a little history to mean anything; OCR wobbles by a character or two.
      if (!k || !t || known.length < 2) continue;
      if (!known.some((h) => editDistance(h, t) <= 2)) {
        unknown.push({ bank: s.bank_name ?? k, terminal: s.terminal_no ?? "", known: known.slice(0, 6) });
      }
    }

    // The slip makes the grand total balance while the card row still does not.
    let closes: ContextSignals["closes_total_but_not_cards"] = null;
    const slipTotal = mine.reduce((a, s) => a + (s.net_amount_try?.toNumber() ?? 0), 0);
    if (slipTotal >= 1000) {
      const day = await computeDay(prisma, upload.daily_record_id);
      const total = day.rows.find((r) => r.label === "GENEL TOPLAM");
      const cards = day.rows.find((r) => r.label.startsWith("POS"));
      if (total && cards && Math.abs(total.difference) <= 1 && Math.abs(cards.difference) > 100) {
        closes = { slip_total: slipTotal, card_row_gap: cards.difference };
      }
    }
    return { unknown_terminals: unknown, closes_total_but_not_cards: closes };
  } catch (e) {
    console.error("[authenticity] context signals failed", e instanceof Error ? e.message : e);
    return null;
  }
}

export function decide(opts: {
  type: Upload["type"];
  file: FileForensics;
  vision: VisionCheck | null;
  context: ContextSignals | null;
}): AuthenticityReport {
  const { type, file, vision, context } = opts;
  const reasons: string[] = [];
  const paper = PAPER_TYPES.has(type);

  const provenance = file.ai_provenance_markers.length > 0;
  const generated = vision?.capture_type === "computer_generated_picture_of_paper";
  const anomalies = vision?.label_anomalies ?? [];
  const high = vision?.synthetic_likelihood === "high";
  const medium = vision?.synthetic_likelihood === "medium";
  const supporting =
    (file.generator_dimensions ? 1 : 0) +
    ((context?.unknown_terminals.length ?? 0) > 0 ? 1 : 0) +
    (context?.closes_total_but_not_cards ? 1 : 0);

  if (provenance) reasons.push(`Dosyada görsel üretici izi var: ${file.ai_provenance_markers.join(", ")}.`);
  if (anomalies.length) reasons.push(`Sabit basılı etiketlerde yazım/harf bozukluğu: ${anomalies.slice(0, 4).join(" · ")}`);
  if (generated) reasons.push("Görsel, kâğıdın fotoğrafı değil; bilgisayarda üretilmiş bir kâğıt görüntüsüne benziyor.");
  if (vision && (high || medium)) for (const r of vision.reasons.slice(0, 5)) reasons.push(r);
  if (file.generator_dimensions) {
    reasons.push(`Görsel boyutu ${file.width}×${file.height}: görsel üreticilerin standart çıktı ölçüsü, telefon fotoğrafı ölçüsü değil.`);
  }
  for (const u of context?.unknown_terminals ?? []) {
    reasons.push(`${u.bank} terminal/işyeri no "${u.terminal}" bu mağazada daha önce hiç görülmedi (bilinenler: ${u.known.join(", ")}).`);
  }
  if (context?.closes_total_but_not_cards) {
    const c = context.closes_total_but_not_cards;
    reasons.push(
      `Fiş tutarı (${fmt(c.slip_total)} ₺) günün GENEL farkını tam kapatıyor ama kart satırı hâlâ ${fmt(Math.abs(c.card_row_gap))} ₺ tutmuyor.`
    );
  }

  let level: AuthenticityLevel = "ok";
  if (provenance && paper) level = "synthetic";
  else if (high && (anomalies.length > 0 || generated) && paper) level = "synthetic";
  else if (provenance || high || generated) level = "suspicious";
  else if (medium && supporting >= 1) level = "suspicious";
  // A generator-sized frame on its own is a hint, not a finding: it flags
  // only when the picture itself could not be judged, or was judged unclear.
  else if (paper && file.generator_dimensions && (!vision || vision.capture_type === "unclear")) level = "suspicious";
  else if (supporting >= 2) level = "suspicious";

  return {
    level,
    reasons: level === "ok" ? [] : reasons,
    file,
    vision,
    context,
    checked_at: new Date().toISOString(),
  };
}

// ───── helpers ─────

function fmt(n: number): string {
  return n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function bankKey(name: string | null): string | null {
  const s = (name ?? "").toLocaleLowerCase("tr");
  if (!s) return null;
  if (/yap[ıi]/.test(s)) return "yapikredi";
  if (/i[sş]\s*bank|iş bank|isbank/.test(s)) return "isbank";
  if (/koop/.test(s)) return "koopbank";
  if (/nova/.test(s)) return "nova";
  if (/ziraat/.test(s)) return "ziraat";
  if (/garanti/.test(s)) return "garanti";
  if (/akbank/.test(s)) return "akbank";
  if (/limasol/.test(s)) return "limasol";
  if (/creditwest|credit west/.test(s)) return "creditwest";
  return s.replace(/[^a-z0-9]/g, "").slice(0, 16) || null;
}

/** Upper-case, no separators, no leading zeros, O→0 / I→1 (the usual OCR swaps). */
function normTerminal(t: string): string {
  return t.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/O/g, "0").replace(/I/g, "1").replace(/^0+/, "");
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let last = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const keep = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, last + (a[i - 1] === b[j - 1] ? 0 : 1));
      last = keep;
    }
  }
  return prev[b.length]!;
}
