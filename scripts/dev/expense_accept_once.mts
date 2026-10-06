// ONE-TIME ACCEPTANCE (owner, 06.10.2026): the İtimat Kargo invoice dated 26.09.2026 (100 ₺) that Derimod Lefkoşa
// uploaded to its 03.10.2026 day — the date rule rejected it. Owner: accept this one, once. The expense record is
// written exactly as the processor would have (category/description from the store's own entry); the upload is
// marked confirmed with date_mismatch = true so the exception stays visible.
import { prisma } from "@/lib/prisma";
import { computeDay } from "@/server/services/verification/compute";
const tl = (v: number) => new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
const id = "13739298-fb42-48b0-8339-02a0375b8fb9";
const up = await prisma.upload.findUniqueOrThrow({ where: { id }, include: { daily_record: { include: { store: { select: { name: true } } } }, expense: true } });
if (up.status !== "failed" || up.expense) throw new Error(`beklenmeyen durum: ${up.status}, masraf kaydı ${up.expense ? "var" : "yok"}`);
const raw: any = up.raw_ocr_json;
const meta: any = up.user_meta_json ?? {};
console.log(`${up.daily_record.store.name} · gün ${up.daily_record.date.toISOString().slice(0, 10)} (${up.daily_record.status}) · ham: ${raw.vendor} ${raw.amount} ${raw.currency} ${raw.expense_date} · mağazanın girdiği: ${meta.expense_category} "${meta.expense_description}"`);
if (raw.amount !== 100 || raw.expense_date !== "2026-09-26") throw new Error("ham okuma beklenenden farklı");
const parsed = { ...raw, category: meta.expense_category ?? raw.category, description: meta.expense_description ?? raw.description, accepted_by_owner: "Sahibi 06.10.2026: 26.09 tarihli kargo faturası bir defalık kabul (mağaza parasını ödediği güne yükledi)" };
const fields = {
  category: (meta.expense_category ?? raw.category) as any,
  vendor: raw.vendor as string,
  amount: raw.amount as number,
  currency: "TRY" as const,
  amount_try: raw.amount as number,
  expense_date: new Date(`${raw.expense_date}T00:00:00.000Z`),
  description: (meta.expense_description ?? raw.description) as string,
  vat_rate: null,
  vat_included: true,
  user_corrected: true,
};
await prisma.$transaction(async (tx) => {
  await tx.expense.create({ data: { upload_id: up.id, daily_record_id: up.daily_record_id, ...fields } });
  await tx.upload.update({ where: { id: up.id }, data: { status: "confirmed", error_message: null, date_mismatch: true, parsed_data_json: parsed } });
});
const after = await prisma.upload.findUniqueOrThrow({ where: { id }, include: { expense: true } });
console.log(`KABUL EDİLDİ: durum ${after.status} · tarih farkı işaretli=${after.date_mismatch} · masraf ${tl(Number(after.expense!.amount_try))} ${after.expense!.category} "${after.expense!.description}" · fatura tarihi ${after.expense!.expense_date.toISOString().slice(0, 10)}`);
const v: any = await computeDay(prisma, up.daily_record_id);
const cashRow = v.rows?.find((r: any) => /Nakit/i.test(r.label ?? ""));
console.log(`03.10 mutabakat: durum ${v.status} · nakit kaynakları satırı ${cashRow ? tl(cashRow.summary_total ?? 0) + " / " + tl(cashRow.actual_total ?? 0) : "?"} · genel fark ${tl(v.difference)}`);
await prisma.$disconnect();
