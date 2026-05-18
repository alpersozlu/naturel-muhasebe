"use client";

import type { PosSlip, StoreSummary, BankReceipt, Expense } from "@prisma/client";

const TRY_FORMATTER = new Intl.NumberFormat("tr-TR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const DATE_FORMATTER = new Intl.DateTimeFormat("tr-TR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

function fmt(n: unknown): string {
  if (n === null || n === undefined) return "—";
  const num = typeof n === "object" && n !== null && "toNumber" in n
    ? (n as { toNumber: () => number }).toNumber()
    : Number(n);
  return Number.isFinite(num) ? TRY_FORMATTER.format(num) : "—";
}

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return DATE_FORMATTER.format(new Date(d));
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="text-sm font-medium mt-0.5">{value}</div>
    </div>
  );
}

export function PosSlipDetails({ data }: { data: PosSlip }) {
  return (
    <div className="border-t bg-muted/30">
      <div className="px-5 py-3 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3">
        <Field label="Banka" value={data.bank_name ?? "—"} />
        <Field label="Tarih" value={fmtDate(data.slip_date)} />
        <Field label="Terminal" value={data.terminal_no ?? "—"} />
        <Field
          label="Net Tutar"
          value={
            <span className="text-emerald-700 font-semibold">
              {fmt(data.net_amount)} {data.currency}
            </span>
          }
        />
        <Field
          label="Satış"
          value={`${data.sales_count ?? "—"} adet · ${fmt(data.sales_amount)}`}
        />
        <Field
          label="İade"
          value={`${data.refund_count ?? 0} adet · ${fmt(data.refund_amount ?? 0)}`}
        />
      </div>
    </div>
  );
}

export function StoreSummaryDetails({ data }: { data: StoreSummary }) {
  return (
    <div className="border-t bg-muted/30">
      <div className="px-5 py-3 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3">
        <Field
          label="Satış Toplam"
          value={
            <span className="text-emerald-700 font-semibold">
              {fmt(data.sales_total)} {data.currency}
            </span>
          }
        />
        <Field label="Nakit" value={fmt(data.cash_sales)} />
        <Field label="Kredi Kartı" value={fmt(data.credit_card_total)} />
        <Field label="Kartuş Puan" value={fmt(data.loyalty_points_total)} />
      </div>
    </div>
  );
}

export function BankReceiptDetails({ data }: { data: BankReceipt }) {
  return (
    <div className="border-t bg-muted/30">
      <div className="px-5 py-3 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3">
        <Field label="Banka" value={data.bank_name ?? "—"} />
        <Field label="Tarih" value={fmtDate(data.deposit_date)} />
        <Field label="IBAN" value={data.iban ?? "—"} />
        <Field
          label="Tutar"
          value={
            <span className="text-emerald-700 font-semibold">
              {fmt(data.amount)} {data.currency}
            </span>
          }
        />
      </div>
    </div>
  );
}

export function ExpenseDetails({ data }: { data: Expense }) {
  return (
    <div className="border-t bg-muted/30">
      <div className="px-5 py-3 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3">
        <Field label="Kategori" value={data.category} />
        <Field label="Tedarikçi" value={data.vendor ?? "—"} />
        <Field label="Tarih" value={fmtDate(data.expense_date)} />
        <Field
          label="Tutar"
          value={
            <span className="text-rose-700 font-semibold">
              {fmt(data.amount)} {data.currency}
            </span>
          }
        />
      </div>
    </div>
  );
}
