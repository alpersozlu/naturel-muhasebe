"use client";

import { AlertTriangle, Check, XCircle } from "lucide-react";
import type {
  PosSlip,
  StoreSummary,
  BankReceipt,
  Expense,
  ZReport,
} from "@prisma/client";

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

export function PosSlipDetails({
  data,
  dateMismatch,
  expectedDate,
}: {
  data: PosSlip;
  dateMismatch?: boolean;
  expectedDate?: Date | string;
}) {
  return (
    <div className="border-t bg-muted/30">
      {dateMismatch ? (
        <div className="px-5 py-2 bg-amber-50 border-b border-amber-200 flex items-start gap-2 text-xs text-amber-800">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <div>
            <strong>Tarih uyuşmazlığı:</strong> Slip{" "}
            {fmtDate(data.slip_date)} tarihli, ama bu güne yüklenmiş
            {expectedDate ? ` (${fmtDate(new Date(expectedDate))})` : ""}.
            Yanlış güne yüklenmiş olabilir — kontrol edin.
          </div>
        </div>
      ) : null}
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

export function ZReportDetails({
  data,
  dateMismatch,
  expectedDate,
  approval,
}: {
  data: ZReport;
  dateMismatch?: boolean;
  expectedDate?: Date | string;
  approval?: {
    passed: boolean;
    reasons: string[];
    combined: number;
    cc_threshold: number | null;
    total_sales: number | null;
  } | null;
}) {
  return (
    <div className="border-t bg-muted/30">
      {dateMismatch ? (
        <div className="px-5 py-2 bg-amber-50 border-b border-amber-200 flex items-start gap-2 text-xs text-amber-800">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <div>
            <strong>Tarih uyuşmazlığı:</strong> Z raporu{" "}
            {fmtDate(data.report_date)} tarihli, ama bu güne yüklenmiş
            {expectedDate ? ` (${fmtDate(new Date(expectedDate))})` : ""}.
          </div>
        </div>
      ) : null}

      <div className="px-5 py-3 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3">
        <Field label="Z No" value={data.report_no ?? "—"} />
        <Field label="Tarih" value={fmtDate(data.report_date)} />
        <Field
          label="Brüt Satış"
          value={`${fmt(data.gross_sales)} ${data.currency}`}
        />
        <Field
          label="Net Satış"
          value={
            <span className="text-emerald-700 font-semibold">
              {fmt(data.net_sales)} {data.currency}
            </span>
          }
        />
        <Field label="Nakit" value={fmt(data.cash_sales)} />
        <Field label="Kredi Kartı" value={fmt(data.credit_card_sales)} />
        <Field label="İade" value={fmt(data.refund_amount ?? 0)} />
        <Field label="KDV Toplam" value={fmt(data.vat_total)} />
      </div>

      {approval ? (
        <div
          className={`px-5 py-3 border-t flex items-start gap-2 text-xs ${
            approval.passed
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : "bg-rose-50 border-rose-200 text-rose-800"
          }`}
        >
          {approval.passed ? (
            <Check className="h-4 w-4 mt-0.5 shrink-0" />
          ) : (
            <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
          )}
          <div className="flex-1">
            <div className="font-semibold mb-1">
              {approval.passed
                ? "Onay kuralı sağlanıyor — Onayla butonu aktif"
                : "Onay kuralı sağlanmıyor"}
            </div>
            {approval.reasons.length > 0 ? (
              <ul className="space-y-0.5 list-disc list-inside">
                {approval.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            ) : (
              <div className="text-emerald-700/80">
                Z + El faturaları {fmt(approval.combined)} ₺ · KK eşiği{" "}
                {fmt(approval.cc_threshold ?? 0)} ₺ · Toplam satış{" "}
                {fmt(approval.total_sales ?? 0)} ₺
              </div>
            )}
          </div>
        </div>
      ) : null}
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
