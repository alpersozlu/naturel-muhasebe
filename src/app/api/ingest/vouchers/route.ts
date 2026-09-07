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
  const { company_code, txns, cards, final } = parsed.data;

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

  // Hareketler 2019'dan beri, kartlar tamamen: her çalışma TAM bir anlık
  // görüntüdür. Son parçada bu çalışmada dokunulmayan (updated_at eski)
  // satırlar Nebim'de silinmiştir — iptal edilen iadenin çeki (CV…5954)
  // böyle 7 gün "açık" göründü. Aynı %3 / 20 satır emniyeti.
  let pruned_txns = 0;
  let pruned_cards = 0;
  let prune_skipped: string | null = null;
  if (final) {
    const cutoff = new Date(Date.now() - 30 * 60 * 1000);
    const [txnAll, txnStale, cardAll, cardStale] = await Promise.all([
      prisma.nebimVoucherTxn.count({ where: { company_code } }),
      prisma.nebimVoucherTxn.count({ where: { company_code, updated_at: { lt: cutoff } } }),
      prisma.nebimVoucher.count({ where: { company_code } }),
      prisma.nebimVoucher.count({ where: { company_code, updated_at: { lt: cutoff } } }),
    ]);
    const capT = Math.max(20, Math.ceil(txnAll * 0.03));
    const capC = Math.max(20, Math.ceil(cardAll * 0.03));
    if (txnStale > capT || cardStale > capC) {
      prune_skipped = `txns ${txnStale}/${capT}, cards ${cardStale}/${capC}`;
      console.warn("[ingest/vouchers] prune skipped:", prune_skipped);
    } else {
      if (txnStale > 0) {
        pruned_txns = (
          await prisma.nebimVoucherTxn.deleteMany({ where: { company_code, updated_at: { lt: cutoff } } })
        ).count;
      }
      if (cardStale > 0) {
        pruned_cards = (
          await prisma.nebimVoucher.deleteMany({ where: { company_code, updated_at: { lt: cutoff } } })
        ).count;
      }
      if (pruned_txns || pruned_cards) {
        console.info(`[ingest/vouchers] pruned ${pruned_txns} txns, ${pruned_cards} cards no longer in Nebim`);
      }
    }
  }

  return NextResponse.json({
    ok: true,
    txns_received: txns.length,
    cards_received: cards.length,
    pruned_txns,
    pruned_cards,
    prune_skipped,
  });
}
