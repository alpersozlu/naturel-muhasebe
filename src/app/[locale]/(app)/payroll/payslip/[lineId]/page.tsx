import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { computeFromLine, lineInclude, num } from "@/server/services/payroll/period";
import {
  ADDITION_CATEGORIES,
  CARRY_FORWARD_CATEGORY,
  DEDUCTION_CATEGORIES,
  PAY_METHOD_LABEL,
  periodLabel,
} from "@/server/services/payroll/rules";
import { nextPeriodKey } from "@/server/services/payroll/period";
import { PrintButton } from "@/components/payroll/print-button";

export const dynamic = "force-dynamic";

const TRY = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (v: number) => `${TRY.format(v)} ₺`;
const dmy = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
};
const CHANNEL: Record<string, string> = { garanti: "banka", ziraat: "Ziraat", cash: "nakit", other: "diğer" };
const PCT = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pct = (r: number) => `%${PCT.format(r * 100)}`;
/** Ödeme satırı adı — personele giden belgede kısa ve tek biçimli */
const paymentLabel = (e: { kind: string; category: string | null }) =>
  e.kind === "advance" ? "Avans" : e.category === "payment1" ? "Ödeme 1 (maaş)" : e.category === "payment2" ? "Ödeme 2 (mesai · komisyon · prim)" : e.category === "cash" ? "Nakit ödeme" : "Ödeme";

/**
 * Bordro fişi — Mert'in PDF düzeninin HTML karşılığı; tarayıcıdan PDF'e
 * yazdırılır. Rakamlar aynı hesap motorundan gelir (compute.ts), bu yüzden
 * ekrandaki tabloyla asla çelişmez.
 *
 * PERSONELE GİDER (sahibi, 07.10.2026: "basitleştir, ne kadar ödeneceğini rahat
 * görsün"): iç notlar (kayıt notları, mesai dökümü, komisyon açıklaması, satır
 * notu, kimin ne zaman karar verdiği) bu belgede YAZILMAZ; her kalem yalnız
 * adı + tutarı. Ayrıntı uygulamadaki kişi penceresinde.
 */
export default async function PayslipPage({ params }: { params: { lineId: string } }) {
  const l = await prisma.payrollLine.findUnique({
    where: { id: params.lineId },
    include: { ...lineInclude, period: true },
  });
  if (!l) notFound();
  const sm = await prisma.payrollStoreMonth.findUnique({
    where: { period_id_store_id: { period_id: l.period_id, store_id: l.store_id } },
  });
  const line = computeFromLine(l, { revenue: num(sm?.revenue), target: num(sm?.target) });
  const c = line.calc;
  const label = periodLabel(l.period.year, l.period.month).toLocaleUpperCase("tr");
  const entries = c.entries.filter((e) => e.counted);
  const payments = entries.filter((e) => e.kind === "advance" || e.kind === "payment");
  const deductions = entries.filter((e) => e.kind === "deduction");
  // Sonraki aya devredilen tutar hak ediş değildir — primlerde değil özette gösterilir.
  const additions = entries.filter((e) => e.kind === "addition" && e.category !== CARRY_FORWARD_CATEGORY);
  const nk = nextPeriodKey(l.period.year, l.period.month);
  const premiumsTotal = c.perfume_amount + c.garment_amount + c.top_seller_amount + c.extra_premium;
  const closedMonth = l.period.status === "closed";

  return (
    <div className="mx-auto max-w-3xl">
      <style>{`@media print { aside, header, nav, .print\\:hidden { display: none !important } main { padding: 0 !important } .md\\:pl-64 { padding-left: 0 !important } body { background: #fff } }`}</style>
      <div className="mb-4 flex items-center justify-between print:hidden">
        <a href="/tr/payroll" className="text-sm text-muted-foreground hover:underline">
          ← Maaşlar
        </a>
        <PrintButton />
      </div>

      <article className="rounded-xl border bg-white p-8 text-[13px] leading-relaxed text-slate-900 shadow-xs print:border-0 print:shadow-none">
        <header className="border-b-2 border-slate-900 pb-3">
          <div className="text-lg font-bold tracking-tight">{label} MAAŞ BORDROSU</div>
          <div className="text-slate-600">Naturel Ticaret</div>
        </header>

        <dl className="mt-4 grid grid-cols-[9rem_1fr] gap-y-1">
          <dt className="text-slate-500">Çalışan:</dt>
          <dd className="font-semibold">{line.full_name}</dd>
          <dt className="text-slate-500">Pozisyon:</dt>
          <dd>{line.position}</dd>
          <dt className="text-slate-500">Mağaza:</dt>
          <dd>{line.store_name}</dd>
          <dt className="text-slate-500">Ödeme Şekli:</dt>
          <dd>{PAY_METHOD_LABEL[line.pay_method]}</dd>
          {/* Banka şube / hesap numarası fişte YAZILMAZ (sahibi, 07.10.2026). */}
        </dl>

        <Section title="1. MAAŞ ve ÖDEMELER">
          <Row label={`${periodLabel(l.period.year, l.period.month)} Net Maaş`} v={money(line.base_salary)} />
          {payments.map((e) => (
            <Row key={e.id} label={`${dmy(String(e.entry_date))} — ${paymentLabel(e)}${e.channel ? ` · ${CHANNEL[e.channel] ?? e.channel}` : ""}`} v={money(e.amount)} />
          ))}
          <Row label="Ödemeler Toplamı" v={money(c.paid_total)} bold />
        </Section>

        {c.overtime_amount > 0 ? (
          <Section title="2. EK MESAİ (Fazla Çalışma)">
            <Row label={`${line.overtime_hours} saat × ${money(c.hourly_rate)} (saatlik ücret = aylık net ÷ 208)`} v={money(c.overtime_amount)} bold />
          </Section>
        ) : null}

        {(c.commission.final > 0 || premiumsTotal > 0 || additions.length > 0) ? (
          <Section title="3. KOMİSYON ve PRİMLER">
            {line.commission_profile !== "none" && c.commission.final > 0 ? (
              <>
                <Row
                  label={`Komisyon — ${c.commission.basis_label.toLocaleLowerCase("tr")} ${money(c.commission.basis)}${
                    c.commission.target ? ` · hedef ${money(c.commission.target)}` : ""
                  }${c.commission.achievement_used != null ? ` · başarı ${pct(c.commission.achievement_used)}` : ""}`}
                  v={money(c.commission.final)}
                  bold
                />
              </>
            ) : null}
            {c.perfume_amount > 0 ? <Row label={`Parfüm Primi: ${line.perfume_units} adet × 50 ₺`} v={money(c.perfume_amount)} /> : null}
            {c.garment_amount > 0 ? <Row label={`Giysi Primi: ${line.garment_units} adet × 200 ₺`} v={money(c.garment_amount)} /> : null}
            {c.top_seller_amount > 0 ? <Row label="Top-Seller Primi (ayın en çok satanı)" v={money(c.top_seller_amount)} /> : null}
            {c.extra_premium > 0 ? <Row label="Ek Prim" v={money(c.extra_premium)} /> : null}
            {additions.map((e) => (
              <Row key={e.id} label={`${dmy(String(e.entry_date))} — ${ADDITION_CATEGORIES[(e.category ?? "other") as keyof typeof ADDITION_CATEGORIES] ?? "Ek hak ediş"}`} v={money(e.amount)} />
            ))}
          </Section>
        ) : null}

        <Section title="4. KESİNTİLER">
          {deductions.length === 0 ? (
            <Row label="Kesinti bulunmamaktadır." v={money(0)} />
          ) : (
            deductions.map((e) => (
              <Row key={e.id} label={`${dmy(String(e.entry_date))} — ${DEDUCTION_CATEGORIES[(e.category ?? "other") as keyof typeof DEDUCTION_CATEGORIES] ?? "Kesinti"}`} v={`−${money(e.amount)}`} />
            ))
          )}
        </Section>

        <Section title="5. ÖZET">
          <Row label="Toplam Hak Ediş (maaş + mesai + komisyon + primler − kesintiler)" v={money(c.gross)} />
          <Row label="Şimdiye Kadar Ödenen (avanslar dahil)" v={`−${money(c.paid_total)}`} />
          {c.carried_forward_total > 0 ? (
            <Row
              label={`Sonraki aya devredilen (${periodLabel(nk.year, nk.month)} maaşından kesilecek)`}
              v={money(c.carried_forward_total)}
            />
          ) : null}
          <Row label={closedMonth ? "KALAN (ay kapandı)" : "ÖDENECEK TUTAR"} v={money(c.net_remaining)} bold big />
        </Section>

        <div className="mt-10 grid grid-cols-2 gap-8 text-slate-600">
          <div>Çalışan İmza: ____________________</div>
          <div>İşveren İmza: ____________________</div>
        </div>
      </article>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5">
      <div className="mb-1 border-b border-slate-300 pb-1 text-[12px] font-bold tracking-wide text-slate-700">{title}</div>
      <div className="space-y-0.5">{children}</div>
    </section>
  );
}

function Row({ label, v, bold, big }: { label: string; v: string; bold?: boolean; big?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 ${bold ? "font-semibold" : ""} ${big ? "text-base" : ""}`}>
      <span>{label}</span>
      <span className="tabular-nums whitespace-nowrap">{v}</span>
    </div>
  );
}
