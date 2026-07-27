import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { nebimVoucherIngestSchema } from "@/lib/zod-schemas/nebim-voucher-ingest";
import { buildStoreResolver } from "@/server/services/nebim/store-resolver";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DERIMOD_BRAND = "DERIMOD";
const CHUNK = 25;

function configuredToken(): string {
  return (process.env.INGEST_API_TOKEN || "").trim();
}

/**
 * NEBIM köprüsünden kredi çeki verisi alır (retail-sales ile aynı token).
 * txns: (company_code, payment_line_id) üzerinden idempotent upsert.
 * cards: (company_code, serial) üzerinden anlık görüntü upsert'i.
 */
export async function POST(req: Request) {
  const token = configuredToken();
  const auth = (req.headers.get("authorization") || "").trim();
  if (!token || auth !== `Bearer ${token}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const parsed = nebimVoucherIngestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "validation", details: parsed.error.flatten() },
      { status: 422 }
    );
  }
  const { company_code, txns, cards } = parsed.data;

  const stores = await prisma.store.findMany({
    where: {
      deleted_at: null,
      brand: { name: { equals: DERIMOD_BRAND, mode: "insensitive" } },
    },
    select: { id: true, name: true, city: true },
  });
  const resolveStore = buildStoreResolver(stores);

  for (let i = 0; i < txns.length; i += CHUNK) {
    const chunk = txns.slice(i, i + CHUNK);
    await Promise.all(
      chunk.map((t) => {
        const data = {
          company_code,
          payment_line_id: t.payment_line_id,
          payment_no: t.payment_no ?? null,
          txn_date: t.txn_date,
          txn_time: t.txn_time ?? null,
          store_id: resolveStore(t.store_name ?? t.store_code),
          nebim_store_code: t.store_code ?? null,
          amount: t.amount,
          customer_code: t.customer_code ?? null,
          customer_name: t.customer_name ?? null,
          serial: t.serial ?? null,
          invoice_ref: t.invoice_ref ?? null,
        };
        return prisma.nebimVoucherTxn.upsert({
          where: {
            company_code_payment_line_id: {
              company_code,
              payment_line_id: t.payment_line_id,
            },
          },
          create: data,
          update: data,
        });
      })
    );
  }

  for (let i = 0; i < cards.length; i += CHUNK) {
    const chunk = cards.slice(i, i + CHUNK);
    await Promise.all(
      chunk.map((c) => {
        const data = {
          company_code,
          serial: c.serial,
          amount: c.amount,
          used_amount: c.used_amount,
          first_valid: c.first_valid ?? null,
          last_valid: c.last_valid ?? null,
          is_used: c.is_used,
          is_blocked: c.is_blocked,
          nebim_created: c.nebim_created ?? null,
        };
        return prisma.nebimVoucher.upsert({
          where: { company_code_serial: { company_code, serial: c.serial } },
          create: data,
          update: data,
        });
      })
    );
  }

  return NextResponse.json({
    ok: true,
    txns_received: txns.length,
    cards_received: cards.length,
  });
}
