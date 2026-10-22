import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ikVerify } from "@/server/services/ik-bridge";

/**
 * İK → MUHASEBE köprü ucu (imzalı). Naturel İK ayrı bir program; personel ve
 * mağazaların ASLI burada (Maaşlar › Personel). İK bunları her gece ve
 * sahibinin "Şimdi eşitle"siyle okur; maaş / banka yalnız gerektiğinde,
 * tek kişi için okunur ve İK'da saklanmaz.
 *
 *   POST /api/bridge/ik   x-signature: hex(hmac_sha256(BRIDGE_SECRET, body))
 *   { exp, op: "snapshot" }
 *   { exp, op: "finance", employeeId }
 *   { exp, op: "terminate", employeeId, endDate: "YYYY-MM-DD", note? }
 */
export const dynamic = "force-dynamic";

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export async function POST(req: Request) {
  const body = await req.text();
  const v = ikVerify(body, req.headers.get("x-signature"));
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status });
  const { op } = v.data;

  if (op === "snapshot") {
    const [brands, stores, employees, closed] = await Promise.all([
      prisma.brand.findMany({ select: { id: true, name: true } }),
      prisma.store.findMany({ select: { id: true, name: true, brand_id: true, deleted_at: true } }),
      prisma.payrollEmployee.findMany({
        select: { id: true, store_id: true, full_name: true, position: true, start_date: true, end_date: true, status: true, sort_order: true, deleted_at: true },
      }),
      prisma.payrollPeriod.findFirst({ where: { status: "closed" }, orderBy: [{ year: "desc" }, { month: "desc" }] }),
    ]);
    let lockedBefore: string | null = null;
    if (closed) {
      const y = closed.month === 12 ? closed.year + 1 : closed.year;
      const m = closed.month === 12 ? 1 : closed.month + 1;
      lockedBefore = `${y}-${String(m).padStart(2, "0")}-01`;
    }
    return NextResponse.json({
      brands,
      stores: stores.map((s) => ({ id: s.id, name: s.name, brand_id: s.brand_id, deleted: !!s.deleted_at })),
      employees: employees.map((e) => ({ ...e, start_date: iso(e.start_date), end_date: iso(e.end_date), deleted: !!e.deleted_at, deleted_at: undefined })),
      lockedBefore,
    });
  }

  if (op === "finance") {
    const e = await prisma.payrollEmployee.findUnique({
      where: { id: String(v.data.employeeId) },
      select: { base_salary: true, iban: true, bank_account_no: true, bank_branch_code: true, bank_account_name: true, pay_method: true },
    });
    if (!e) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({
      netSalary: Number(e.base_salary),
      iban: e.iban,
      accountNo: e.bank_account_no,
      branch: e.bank_branch_code,
      holder: e.bank_account_name,
      payMethod: e.pay_method,
    });
  }

  if (op === "terminate") {
    const id = String(v.data.employeeId);
    const endDate = String(v.data.endDate);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return NextResponse.json({ error: "bad date" }, { status: 400 });
    const e = await prisma.payrollEmployee.findUnique({ where: { id }, select: { notes: true, status: true, end_date: true } });
    if (!e) return NextResponse.json({ error: "not found" }, { status: 404 });
    const note = `Ayrıldı ${endDate} (Naturel İK)${v.data.note ? ` — ${String(v.data.note).slice(0, 300)}` : ""}`;
    await prisma.payrollEmployee.update({
      where: { id },
      data: { status: "left", end_date: new Date(`${endDate}T00:00:00.000Z`), notes: e.notes ? `${e.notes}\n${note}` : note },
    });
    await prisma.auditLog.create({
      data: { action: "update", entity_type: "PayrollEmployee", entity_id: id, before_json: { status: e.status, end_date: iso(e.end_date) }, after_json: { status: "left", end_date: endDate, source: "naturel-ik" } },
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "unknown op" }, { status: 400 });
}
