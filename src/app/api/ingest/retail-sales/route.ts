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
  const { company_code, currency, lines, run_id, pull_since, final } = parsed.data;
  const sourceTag = run_id ? `nebim:${run_id}` : "nebim";

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
          barcode: l.barcode ?? null,
          currency,
          source: sourceTag,
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

  // Nebim iptal edilen belgeyi bayraklamaz, SİLER (KESIF40: 1-R-7-92614
  // trInvoiceHeader'da yok). Köprü hiç silmediği için silinen faturalar
  // DocuFlow'da yaşıyordu (ciro, Hareket Özeti, özet çapraz kontrolü hepsi
  // 1.499,99 fazla). Çalışmanın son parçasında, çekilen aralıkta olup bu
  // çalışmanın damgasını taşımayan satırlar Nebim'den silinmiş demektir.
  // Emniyet: bir seferde aralığın %3'ünden (en az 20 satır) fazlası
  // silinecekse dokunma — kısmi/bozuk bir çekim tabloyu boşaltmasın.
  let pruned = 0;
  let prune_skipped: string | null = null;
  let pruned_invoices: string[] = [];
  if (final && run_id && pull_since) {
    const since = new Date(`${pull_since}T00:00:00.000Z`);
    const range = { company_code, invoice_date: { gte: since } };
    const [inRange, stale] = await Promise.all([
      prisma.nebimSaleLine.count({ where: range }),
      prisma.nebimSaleLine.findMany({
        where: { ...range, source: { not: sourceTag } },
        select: { invoice_ref: true },
      }),
    ]);
    const cap = Math.max(20, Math.ceil(inRange * 0.03));
    if (stale.length > cap) {
      prune_skipped = `stale=${stale.length} > cap=${cap} (in_range=${inRange})`;
      console.warn("[ingest/retail-sales] prune skipped:", prune_skipped);
    } else if (stale.length > 0) {
      pruned_invoices = Array.from(new Set(stale.map((s) => s.invoice_ref))).slice(0, 50);
      const del = await prisma.nebimSaleLine.deleteMany({
        where: { ...range, source: { not: sourceTag } },
      });
      pruned = del.count;
      console.info(`[ingest/retail-sales] pruned ${pruned} lines no longer in Nebim:`, pruned_invoices);
    }
  }

  return NextResponse.json({
    ok: true,
    received: lines.length,
    store_matched: matched,
    store_unmatched: lines.length - matched,
    unmatched_store_names: Array.from(unmatchedNames),
    pruned,
    pruned_invoices,
    prune_skipped,
  });
}
