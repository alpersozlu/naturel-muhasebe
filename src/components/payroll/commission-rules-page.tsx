"use client";

import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { PrintButton } from "@/components/payroll/print-button";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DERI_ASISTAN_TABLE,
  DERI_MUDUR_TABLE,
  GARMENT_PREMIUM_PER_UNIT,
  MAVI_ASISTAN_TABLE,
  MAVI_MUDUR_TABLE,
  MAVI_VICE_FACTOR,
  OUTLET_JACKET_MAX_LIST_PRICE,
  OVERTIME_DIVISOR,
  TOP_SELLER_PREMIUM,
  bracketFor,
} from "@/server/services/payroll/rules";
import { moneyTL, rate } from "./format";

/**
 * PRİM KURALLARI — personele anlatmak için tek sayfa (sahibi, 17.11.2026:
 * "çalışanları bilinçlendireyim", "Derimod ve Mavi için 2 ayrı bölüm").
 *
 * Tablolar ve örnek hesaplar rules.ts'teki GERÇEK oranlardan üretilir; oran
 * değişirse bu sayfa kendiliğinden değişir, elle güncellenecek bir metin yoktur.
 * Yazdırıldığında yalnız açık olan markanın bölümü çıkar (Radix sekmesi kapalı
 * sekmeyi hiç basmaz) — müdür kendi markasının sayfasını çıktı alabilir.
 */

const THR = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 });
/** 0,95 → "%95" · 0,9499 → "%94,99" */
const thr = (a: number) => `%${THR.format(Math.round(a * 10000) / 100)}`;

/** Dilimin başarı aralığı: ilk satır "… ve altı", son satır "… ve üstü". */
function rangeLabel(table: readonly { min: number }[], i: number): string {
  const next = table[i + 1];
  if (!next) return `${thr(table[i]!.min)} ve üstü`;
  if (i === 0) return `${thr(next.min - 0.0001)} ve altı`;
  return `${thr(table[i]!.min)} – ${thr(next.min - 0.0001)}`;
}

function Section({ n, title, lead, children }: { n?: number; title: string; lead?: string; children: React.ReactNode }) {
  return (
    <section className="break-inside-avoid">
      <h2 className="flex items-baseline gap-2.5 border-b pb-2 text-base font-semibold tracking-tight">
        {n ? <span className="text-sm font-normal text-muted-foreground tabular-nums">{n}</span> : null}
        {title}
      </h2>
      {lead ? <p className="mt-3 text-sm text-muted-foreground">{lead}</p> : null}
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="text-xs leading-relaxed text-muted-foreground">{children}</p>;
}

/** Oran tablosu — son dilim (en yüksek oran) vurgulanır. */
function RateTable({
  caption,
  cols,
  rows,
}: {
  caption?: string;
  cols: string[];
  rows: { label: string; values: string[]; top?: boolean }[];
}) {
  return (
    <div className="overflow-hidden rounded-xl border">
      {caption ? <div className="border-b bg-muted/40 px-3 py-2 text-xs font-medium">{caption}</div> : null}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2 text-left font-medium">Başarı</th>
            {cols.map((c) => (
              <th key={c} className="px-3 py-2 text-right font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className={cn("border-b last:border-0", r.top && "bg-muted/60 font-semibold")}>
              <td className="px-3 py-2">{r.label}</td>
              {r.values.map((v, i) => (
                <td key={i} className="px-3 py-2 text-right tabular-nums">
                  {v}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Adım adım çözülmüş örnek hesap — son satır sonuçtur. */
function Example({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div className="break-inside-avoid rounded-xl border bg-muted/20 p-3.5">
      <div className="text-sm font-semibold">{title}</div>
      <dl className="mt-2 text-sm">
        {rows.map(([k, v], i) => (
          <div
            key={k}
            className={cn(
              "flex items-baseline justify-between gap-4 border-b border-dashed py-1.5 last:border-0",
              i === rows.length - 1 && "mt-0.5 border-t border-solid border-b-0 pt-2 font-semibold"
            )}
          >
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="whitespace-nowrap tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Who({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <div className="overflow-hidden rounded-xl border">
      <table className="w-full text-sm">
        <tbody>
          {rows.map(([who, basis]) => (
            <tr key={who} className="border-b last:border-0">
              <td className="w-[38%] px-3 py-2 font-medium">{who}</td>
              <td className="px-3 py-2 text-muted-foreground">{basis}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── MAVİ ────────────────────────────────────────────────────────────────────

/** Mavi asistan primi: dilim toplam ciroyla seçilir, ND ve denim ayrı oranla çarpılır. */
function maviAsistan(nd: number, denim: number, target: number) {
  const own = nd + denim;
  const a = own / target;
  const b = bracketFor(MAVI_ASISTAN_TABLE, a);
  return { own, a, b, total: nd * b.nd + denim * b.denim };
}

function MaviSection() {
  const ex = maviAsistan(1_200_000, 360_000, 1_500_000);
  const storeTarget = 5_600_000;
  const storeRevenue = 5_880_000;
  const sb = bracketFor(MAVI_MUDUR_TABLE, storeRevenue / storeTarget);

  // Eşik etkisi: aynı kişi, cirosunun %25'i denim.
  const steps = [1_424_000, 1_425_000, 1_500_000, 1_575_000].map((own) => {
    const r = maviAsistan(own * 0.75, own * 0.25, 1_500_000);
    return { own, a: own / 1_500_000, r };
  });

  return (
    <div className="space-y-7">
      <Section n={1} title="Mavi'de kim hangi cirodan prim alır">
        <Who
          rows={[
            ["Satış Asistanı · Kıdemli Danışman", <>
              <b className="text-foreground">Kendi cirosu</b> ÷ kendi kişisel hedefi
            </>],
            ["Mağaza Müdürü", <>
              <b className="text-foreground">Mağazanın toplam cirosu</b> ÷ mağaza hedefi
            </>],
            ["Müdür Yardımcısı", <>
              Mağazanın toplam cirosu — müdür oranının <b className="text-foreground">%75'i</b>
            </>],
          ]}
        />
        <Note>
          Kasiyer, depo ve lojistik personeline satış primi verilmez. Ciro her zaman KDV hariç net cirodur; iadeler
          düşülmüştür.
        </Note>
      </Section>

      <Section
        n={2}
        title="Satış Asistanı · Kıdemli Danışman"
        lead="Dilimi toplam cironuzun hedefinize oranı belirler; sonra denim ve denim dışı satışınız kendi oranıyla çarpılır."
      >
        <RateTable
          cols={["Denim dışı", "Denim"]}
          rows={MAVI_ASISTAN_TABLE.map((b, i) => ({
            label: rangeLabel(MAVI_ASISTAN_TABLE, i),
            values: [rate(b.nd), rate(b.denim)],
            top: i === MAVI_ASISTAN_TABLE.length - 1,
          }))}
        />
        <Note>
          Denim oranı denim dışının yaklaşık üç katıdır — aynı ciroyu denimle yapmak primi belirgin şekilde büyütür.
        </Note>
      </Section>

      <Section n={3} title="Mağaza Müdürü ve Müdür Yardımcısı" lead="İkisi de tek bir satıcının değil, mağazanın tamamının cirosuna bakar.">
        <RateTable
          cols={["Müdür", "Müdür Yardımcısı"]}
          rows={MAVI_MUDUR_TABLE.map((b, i) => ({
            label: rangeLabel(MAVI_MUDUR_TABLE, i),
            values: [rate(b.rate), rate(b.rate * MAVI_VICE_FACTOR)],
            top: i === MAVI_MUDUR_TABLE.length - 1,
          }))}
        />
        <Note>Müdür yardımcısının oranı her dilimde müdür oranının %75'idir.</Note>
      </Section>

      <Section n={4} title="Örnek hesaplar">
        <Example
          title={`Satış asistanı · hedef ${moneyTL(1_500_000)}`}
          rows={[
            ["Kendi cirosu (1.200.000 denim dışı + 360.000 denim)", moneyTL(ex.own)],
            [`Başarı: ${moneyTL(ex.own)} ÷ ${moneyTL(1_500_000)}`, thr(ex.a)],
            [`Denim dışı 1.200.000 × ${rate(ex.b.nd)}`, moneyTL(1_200_000 * ex.b.nd)],
            [`Denim 360.000 × ${rate(ex.b.denim)}`, moneyTL(360_000 * ex.b.denim)],
            ["PRİM", moneyTL(ex.total)],
          ]}
        />
        <Example
          title={`Müdür ve yardımcısı · mağaza hedefi ${moneyTL(storeTarget)}`}
          rows={[
            ["Mağaza cirosu", moneyTL(storeRevenue)],
            [`Başarı: ${moneyTL(storeRevenue)} ÷ ${moneyTL(storeTarget)}`, thr(storeRevenue / storeTarget)],
            [`Müdür: ${moneyTL(storeRevenue)} × ${rate(sb.rate)}`, moneyTL(storeRevenue * sb.rate)],
            [
              `Müdür yardımcısı: ${moneyTL(storeRevenue)} × ${rate(sb.rate * MAVI_VICE_FACTOR)}`,
              moneyTL(storeRevenue * sb.rate * MAVI_VICE_FACTOR),
            ],
          ]}
        />
      </Section>

      <Section
        n={5}
        title="Eşiği geçmek ne kazandırır"
        lead="Yükselen oran cironun tamamına işlediği için küçük bir ciro farkı primi büyük ölçüde değiştirir. Hedefi 1.500.000 ₺ olan, cirosunun dörtte birini denimle yapan bir asistan:"
      >
        <RateTable
          cols={["Ciro", "Oranlar", "Prim", "Fark"]}
          rows={steps.map((s, i) => ({
            label: thr(s.a),
            values: [
              moneyTL(s.own),
              `${rate(s.r.b.nd)} / ${rate(s.r.b.denim)}`,
              moneyTL(s.r.total),
              i === 0 ? "—" : `+${moneyTL(s.r.total - steps[i - 1]!.r.total)}`,
            ],
            top: i === steps.length - 1,
          }))}
        />
        <Note>
          Eşiğin hemen altındayken yapılan {moneyTL(steps[1]!.own - steps[0]!.own)}'lik bir satış{" "}
          {moneyTL(steps[1]!.r.total - steps[0]!.r.total)} prim getiriyor. Ay sonunda hedefe yakın olanın son günleri bu
          yüzden önemlidir.
        </Note>
      </Section>

      <Section n={6} title="Mavi'ye özel">
        <ul className="list-disc space-y-1.5 pl-5 text-sm">
          <li>
            <b>Ayın en çok satanı {moneyTL(TOP_SELLER_PREMIUM)}</b> — her Mavi mağazasında ayın en çok satan tek kişisine.
          </li>
          <li>
            <b>Pazar ve resmî tatil mesaisi ödenmez</b> (5 Ekim 2026'dan itibaren): çalışılan pazarın 8 saati{" "}
            <b>hak günü</b> olarak izne yazılır, 8 saatin üstü de ödenmez.
          </li>
          <li>Parfüm primi Eylül 2026'dan itibaren kaldırılmıştır.</li>
        </ul>
      </Section>
    </div>
  );
}

// ── DERİMOD ─────────────────────────────────────────────────────────────────

function DerimodSection() {
  const target = 2_000_000;
  const revenue = 2_100_000;
  const ab = bracketFor(DERI_ASISTAN_TABLE, revenue / target);
  const jackets = 20;

  const storeTarget = 4_000_000;
  const storeRevenue = 4_200_000;
  const sb = bracketFor(DERI_MUDUR_TABLE, storeRevenue / storeTarget);

  const steps = [1_899_000, 1_900_000, 2_000_000, 2_100_000, 2_200_000].map((own) => {
    const a = own / target;
    const b = bracketFor(DERI_ASISTAN_TABLE, a);
    return { own, a, b, total: own * b.rate };
  });

  return (
    <div className="space-y-7">
      <Section n={1} title="Derimod'da kim hangi cirodan prim alır">
        <Who
          rows={[
            ["Satış Asistanı", <>
              <b className="text-foreground">Kendi cirosu</b> ÷ kendi kişisel hedefi
            </>],
            ["Mağaza Müdürü", <>
              <b className="text-foreground">Mağazanın toplam cirosu</b> ÷ mağaza hedefi
            </>],
          ]}
        />
        <Note>
          Kasiyer, depo ve lojistik personeline satış primi verilmez. Ciro KDV hariç net cirodur ve Nebim satışlarından gelir. Derimod'da denim ayrımı yoktur: tek oran cironun
          tamamına uygulanır.
        </Note>
      </Section>

      <Section n={2} title="Satış Asistanı" lead="Kendi cironuz ÷ kendi kişisel hedefiniz.">
        <RateTable
          cols={["Oran"]}
          rows={DERI_ASISTAN_TABLE.map((b, i) => ({
            label: rangeLabel(DERI_ASISTAN_TABLE, i),
            values: [rate(b.rate)],
            top: i === DERI_ASISTAN_TABLE.length - 1,
          }))}
        />
      </Section>

      <Section n={3} title="Mağaza Müdürü" lead="Mağazanın toplam cirosu ÷ mağaza hedefi.">
        <RateTable
          cols={["Oran"]}
          rows={DERI_MUDUR_TABLE.map((b, i) => ({
            label: rangeLabel(DERI_MUDUR_TABLE, i),
            values: [rate(b.rate)],
            top: i === DERI_MUDUR_TABLE.length - 1,
          }))}
        />
      </Section>

      <Section n={4} title="Giysi primi">
        <div className="rounded-xl border p-3.5 text-sm">
          <div className="text-lg font-semibold tabular-nums">{moneyTL(GARMENT_PREMIUM_PER_UNIT)} / adet</div>
          <p className="mt-1 text-muted-foreground">
            Satılan her deri giysi / ceket için, satış priminin üstüne eklenir. İade edilen parça bir adet eksi sayılır.
          </p>
          <p className="mt-2 text-muted-foreground">
            <b className="text-foreground">Outlet ceketler sayılmaz</b> — eski sezon ürün kodlu (ilk iki hanesi 23 ve
            altı) ve liste fiyatı {moneyTL(OUTLET_JACKET_MAX_LIST_PRICE)} altındaki ceketler giysi primine girmez.
          </p>
        </div>
      </Section>

      <Section n={5} title="Örnek hesaplar">
        <Example
          title={`Satış asistanı · hedef ${moneyTL(target)} · ${jackets} ceket sattı`}
          rows={[
            ["Kendi cirosu", moneyTL(revenue)],
            [`Başarı: ${moneyTL(revenue)} ÷ ${moneyTL(target)}`, thr(revenue / target)],
            [`Satış primi: ${moneyTL(revenue)} × ${rate(ab.rate)}`, moneyTL(revenue * ab.rate)],
            [`Giysi primi: ${jackets} × ${moneyTL(GARMENT_PREMIUM_PER_UNIT)}`, moneyTL(jackets * GARMENT_PREMIUM_PER_UNIT)],
            ["TOPLAM", moneyTL(revenue * ab.rate + jackets * GARMENT_PREMIUM_PER_UNIT)],
          ]}
        />
        <Example
          title={`Mağaza müdürü · mağaza hedefi ${moneyTL(storeTarget)}`}
          rows={[
            ["Mağaza cirosu", moneyTL(storeRevenue)],
            [`Başarı: ${moneyTL(storeRevenue)} ÷ ${moneyTL(storeTarget)}`, thr(storeRevenue / storeTarget)],
            [`Müdür: ${moneyTL(storeRevenue)} × ${rate(sb.rate)}`, moneyTL(storeRevenue * sb.rate)],
          ]}
        />
      </Section>

      <Section
        n={6}
        title="Eşiği geçmek ne kazandırır"
        lead="Yükselen oran cironun tamamına işler. Hedefi 2.000.000 ₺ olan bir asistan:"
      >
        <RateTable
          cols={["Ciro", "Oran", "Prim", "Fark"]}
          rows={steps.map((s, i) => ({
            label: thr(s.a),
            values: [
              moneyTL(s.own),
              rate(s.b.rate),
              moneyTL(s.total),
              i === 0 ? "—" : `+${moneyTL(s.total - steps[i - 1]!.total)}`,
            ],
            top: i === steps.length - 1,
          }))}
        />
        <Note>
          Eşiğin hemen altındayken yapılan {moneyTL(steps[1]!.own - steps[0]!.own)}'lik bir satış{" "}
          {moneyTL(steps[1]!.total - steps[0]!.total)} prim getiriyor.
        </Note>
      </Section>

      <Section n={7} title="Derimod'a özel">
        <ul className="list-disc space-y-1.5 pl-5 text-sm">
          <li>
            <b>Pazar ve resmî tatil mesaisi ödenir</b> — Mavi'de kaldırılan uygulama Derimod'da sürüyor.
          </li>
          <li>Ayın en çok satanı primi (3.000 ₺) Mavi mağazalarına özeldir, Derimod'da yoktur.</li>
          <li>Kişi ciroları Nebim satışlarından okunur; satış fişindeki danışman adı bu yüzden önemlidir.</li>
        </ul>
      </Section>
    </div>
  );
}

// ── Her iki markada da geçerli ──────────────────────────────────────────────

function SharedRules() {
  return (
    <Section title="Her iki markada da geçerli">
      <ul className="list-disc space-y-1.5 pl-5 text-sm">
        <li>
          <b>Prim maaşla birlikte değil, Ödeme 2'de ve nakit ödenir.</b> Maaşını bankadan alan da primini elden alır.
        </li>
        <li>
          <b>Hedefler</b> her ay yönetim tarafından belirlenir; kişisel hedefler mağaza hedefinin satış danışmanlarına
          bölünmesiyle çıkar.
        </li>
        <li>
          <b>Devamsızlık</b> (rapor / izin) kişisel hedeften takvim günü oranında düşülür; düşen kısım o günlerde
          çalışan arkadaşlarının hedefine eklenir. Pazar karşılığı hak günü devamsızlık sayılmaz.
        </li>
        <li>
          <b>Ay içinde işe başlayan müdür veya yardımcısı</b> ayın tamamından değil, çalıştığı tarih aralığının mağaza
          cirosundan prim alır; hedef de aynı aralığa gün sayısıyla oranlanır.
        </li>
        <li>
          <b>İlk ayındaki personelin primi</b> nakit yerine kıyafet olarak verilebilir.
        </li>
        <li>
          <b>Kesintiler</b> (kasa eksiği, fiyat farkı, faturasız masraf, şirket borcu) maaştan değil, Ödeme 2'den — yani
          mesai ve primden — düşülür.
        </li>
        <li>
          <b>Fazla mesai</b> saat ücreti = kişinin net maaşı ÷ {OVERTIME_DIVISOR}.
        </li>
        <li>
          <b>Kasiyer, depo ve lojistik personeline satış primi verilmez</b>; Ödeme 2'leri yalnız fazla mesaisinden oluşur.
        </li>
        <li>
          <b>Yönetim takdiri:</b> hedefe çok yaklaşmış bir başarı yüzdesi üst dilimden kabul edilebilir. Bu bir hak
          değil, ay bazında verilen karardır.
        </li>
      </ul>
    </Section>
  );
}

/** `brand` ile doğrudan bir markanın bölümü açılabilir (varsayılan Mavi). */
export function CommissionRulesPage({ brand: initial = "mavi" }: { brand?: "mavi" | "derimod" } = {}) {
  const [brand, setBrand] = useState<string>(initial);

  return (
    <div className="space-y-6">
      <style>{`@media print {
        aside, header, nav, .print\\:hidden { display: none !important }
        main { padding: 0 !important }
        .md\\:pl-64 { padding-left: 0 !important }
        body { background: #fff }
        section { break-inside: auto }
        h2 { break-after: avoid }
        table, dl { break-inside: avoid }
      }`}</style>

      <div className="flex flex-wrap items-start justify-between gap-4 print:hidden">
        <PageHeader
          title="Prim Kuralları"
          description="Satış primi hangi cirodan, hangi orandan hesaplanır — personele anlatmak için. Tablolar bordronun kullandığı oranlardan üretilir."
        />
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/payroll">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Maaşlar
            </Link>
          </Button>
          <PrintButton />
        </div>
      </div>

      {/* Yazdırmada sekme başlığı yerine markanın adı geçsin */}
      <div className="hidden print:block">
        <h1 className="text-xl font-semibold">Prim Kuralları — {brand === "mavi" ? "Mavi" : "Derimod"}</h1>
        <p className="text-xs text-muted-foreground">Naturel Trading Ltd.</p>
      </div>

      <Tabs value={brand} onValueChange={setBrand}>
        <TabsList className="print:hidden">
          <TabsTrigger value="mavi" className="px-6">
            Mavi
          </TabsTrigger>
          <TabsTrigger value="derimod" className="px-6">
            Derimod
          </TabsTrigger>
        </TabsList>
        <TabsContent value="mavi" className="mt-5">
          <MaviSection />
        </TabsContent>
        <TabsContent value="derimod" className="mt-5">
          <DerimodSection />
        </TabsContent>
      </Tabs>

      <SharedRules />

      <p className="pt-2 text-xs text-muted-foreground">
        Oranlar Nisan 2026'da onaylanmış komisyon tablolarıdır ve o tarihten beri değişmemiştir. Her kişinin prim
        hesabı, açıklamasıyla birlikte bordroda saklanır.
      </p>
    </div>
  );
}
