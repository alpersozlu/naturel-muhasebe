import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { nebimIngestSchema } from "@/lib/zod-schemas/nebim-ingest";
import { buildStoreResolver } from "@/server/services/nebim/store-resolver";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// NEBIM verisi bu markanın mağazalarına eşlenir.
const DERIMOD_BRAND = "DERIMOD";
// Tek POST içindeki satırları parça parça upsert et (zaman aşımına takılmamak için).
const CHUNK = 25;

/**
 * NEBIM köprüsünden gelen perakende satış satırlarını alır.
 * Bearer token ile korunur. (company_code, invoice_ref, sort_order) üzerinden
 * idempotent upsert — köprü son N günü tekrar gönderse de satır çiftlenmez.
 */
function configuredToken(): string {
  // .trim(): Vercel'e yapıştırırken sona eklenen boşluk/satır sonunu temizle.
  return (process.env.INGEST_API_TOKEN || "").trim();
}

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

  const parsed = nebimIngestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "validation", details: parsed.error.flatten() },
      { status: 422 }
    );
  }
  const { company_code, currency, lines } = parsed.data;

  // Derimod mağazalarını yükle ve ad→id çözücüyü kur.
  const stores = await prisma.store.findMany({
    where: {
      deleted_at: null,
      brand: { name: { equals: DERIMOD_BRAND, mode: "insensitive" } },
    },
    select: { id: true, name: true, city: true },
  });
  const resolveStore = buildStoreResolver(stores);

  let matched = 0;
  const unmatchedNames = new Set<string>();

  for (let i = 0; i < lines.length; i += CHUNK) {
    const chunk = lines.slice(i, i + CHUNK);
    await Promise.all(
      chunk.map((l) => {
        const store_id = resolveStore(l.store_name ?? l.store_code);
        if (store_id) matched++;
        else if (l.store_name) unmatchedNames.add(l.store_name);

        // İndirim oranı — satış ve İADE için (iadede orijinal/net negatif;
        // (amount_vi - net_amount)/amount_vi oranı yine pozitif/doğru çıkar).
        const amt = l.amount_vi;
        const net = l.net_amount;
        const discount_pct =
          amt != null && amt !== 0 && net != null
            ? Math.round(((amt - net) / amt) * 10000) / 100
            : null;

        const data = {
          company_code,
          invoice_ref: l.invoice_ref,
          sort_order: l.sort_order,
          store_id,
          nebim_store_code: l.store_code ?? null,
          store_name_raw: l.store_name ?? null,
          invoice_date: l.invoice_date,
          created_date: l.created_date ?? null,
          is_return: l.is_return,
          office: l.office ?? null,
          item_code: l.item_code ?? null,
          item_desc: l.item_desc ?? null,
          color_code: l.color_code ?? null,
          color_desc: l.color_desc ?? null,
          size: l.size ?? null,
          salesperson_code: l.salesperson_code ?? null,
          salesperson_name: l.salesperson_name ?? null,
          customer_code: l.customer_code ?? null,
          customer_name: l.customer_name ?? null,
          payment_type: l.payment_type ?? null,
          card_type: l.card_type ?? null,
          pay_cash: l.pay_cash ?? null,
          pay_card: l.pay_card ?? null,
          qty: l.qty,
          price: l.price ?? null,
          vat_rate: l.vat_rate ?? null,
          amount_vi: l.amount_vi ?? null,
          line_disc: l.line_disc ?? null,
          doc_disc: l.doc_disc ?? null,
          tax_base: l.tax_base ?? null,
          vat: l.vat ?? null,
          net_amount: l.net_amount ?? null,
          discount_pct,
          invoice_note: l.invoice_note ?? null,
          mgmt_note: l.mgmt_note ?? null,
          discount_reason: l.discount_reason ?? null,
          campaign: l.campaign ?? null,
          currency,
          source: "nebim",
        };

        return prisma.nebimSaleLine.upsert({
          where: {
            company_code_invoice_ref_sort_order: {
              company_code,
              invoice_ref: l.invoice_ref,
              sort_order: l.sort_order,
            },
          },
          create: data,
          update: data,
        });
      })
    );
  }

  return NextResponse.json({
    ok: true,
    received: lines.length,
    store_matched: matched,
    store_unmatched: lines.length - matched,
    unmatched_store_names: Array.from(unmatchedNames),
  });
}
