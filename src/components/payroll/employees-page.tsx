"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Landmark, Pencil, Plus, Upload, UserMinus } from "lucide-react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/trpc/routers/_app";
import { trpc } from "@/lib/trpc";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoneyInput } from "@/components/ui/money-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  COMMISSION_PROFILES,
  PAY_METHODS,
  PAY_METHOD_LABEL,
  PAY_METHOD_SHORT,
  POSITIONS,
  PROFILE_LABEL,
  PROFILE_SHORT,
} from "@/server/services/payroll/rules";
import { STATUS_LABEL, dmy, money, todayIso } from "./format";

type Emp = inferRouterOutputs<AppRouter>["payroll"]["employees"]["list"][number];
type Loan = inferRouterOutputs<AppRouter>["payroll"]["loans"]["list"][number];

export function EmployeesPage() {
  const utils = trpc.useUtils();
  const list = trpc.payroll.employees.list.useQuery();
  const loans = trpc.payroll.loans.list.useQuery();
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState<Emp | null | "new">(null);
  const [leaving, setLeaving] = useState<Emp | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [loanOpen, setLoanOpen] = useState(false);
  const [editingLoan, setEditingLoan] = useState<Loan | null>(null);

  const invalidate = () => {
    void utils.payroll.employees.list.invalidate();
    void utils.payroll.loans.list.invalidate();
    void utils.payroll.periods.get.invalidate();
  };

  const rows = (list.data ?? []).filter((e) => showAll || e.status === "active");
  const groups = useMemo(() => {
    const m = new Map<string, Emp[]>();
    for (const e of rows) {
      const k = e.store_name;
      m.set(k, [...(m.get(k) ?? []), e]);
    }
    return Array.from(m.entries()).sort((a, b) => {
      const am = /mavi/i.test(a[1][0]?.brand_name ?? "") ? 0 : 1;
      const bm = /mavi/i.test(b[1][0]?.brand_name ?? "") ? 0 : 1;
      return am - bm || a[0].localeCompare(b[0], "tr");
    });
  }, [rows]);

  const total = rows.reduce((s, e) => s + e.base_salary, 0);
  const missingBank = rows.filter((e) => e.pay_method === "garanti" && !e.has_bank_details).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeader
          title="Personel"
          description="Bordroya giren herkes: mağaza, pozisyon, NET baz maaş, ödeme şekli, komisyon profili ve banka bilgisi."
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline">
            <Link href="/payroll">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Maaşlar
            </Link>
          </Button>
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4 mr-2" />
            Hesapları talimattan aktar
          </Button>
          <Button variant="outline" onClick={() => setLoanOpen(true)}>
            <Landmark className="h-4 w-4 mr-2" />
            Borç ekle
          </Button>
          <Button onClick={() => setEditing("new")}>
            <Plus className="h-4 w-4 mr-2" />
            Yeni personel
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-sm">
        <span>
          <b>{rows.length}</b> kişi · aylık baz toplamı <b className="tabular-nums">{money(total)} ₺</b>
        </span>
        {missingBank > 0 ? (
          <span className="text-rose-700">{missingBank} Garanti personelinin şube/hesap bilgisi eksik</span>
        ) : null}
        <label className="ml-auto flex items-center gap-2">
          <input type="checkbox" className="h-4 w-4" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          Pasif ve ayrılanları göster
        </label>
      </div>

      {groups.map(([store, emps]) => (
        <section key={store} className="rounded-2xl border bg-card shadow-xs overflow-hidden">
          <header className="flex items-center justify-between border-b bg-muted/30 px-4 py-2.5">
            <div className="font-semibold tracking-tight">{store}</div>
            <div className="text-xs text-muted-foreground">
              {emps.length} kişi · {money(emps.reduce((s, e) => s + e.base_salary, 0), { cents: false })} ₺
            </div>
          </header>
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr className="border-b">
                <th className="px-4 py-2 text-left font-medium">Çalışan</th>
                <th className="px-3 py-2 text-left font-medium">Pozisyon</th>
                <th className="px-3 py-2 text-left font-medium">Komisyon</th>
                <th className="px-3 py-2 text-right font-medium">Baz (NET)</th>
                <th className="px-3 py-2 text-left font-medium">Ödeme</th>
                <th className="px-3 py-2 text-left font-medium">Banka</th>
                <th className="px-3 py-2 text-left font-medium">Durum</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {emps.map((e) => (
                <tr key={e.id} className={cn("border-b last:border-0", e.status !== "active" && "opacity-60")}>
                  <td className="px-4 py-2">
                    <div className="font-medium">{e.full_name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {[
                        e.paid_month_early ? "bir ay önceden ödenir" : null,
                        !e.is_registered ? "kayıtsız" : null,
                        e.is_gross_minimum ? "brüt asgari" : null,
                        e.perfume_eligible ? "parfüm primi" : null,
                        e.garment_eligible ? "giysi primi" : null,
                        e.nebim_name ? `Nebim: ${e.nebim_name}` : null,
                        e.loan_outstanding > 0.5 ? `borç ${money(e.loan_outstanding)} ₺` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </td>
                  <td className="px-3 py-2">{e.position}</td>
                  <td className="px-3 py-2 text-muted-foreground">{PROFILE_SHORT[e.commission_profile]}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(e.base_salary)}</td>
                  <td className="px-3 py-2">{PAY_METHOD_SHORT[e.pay_method]}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {e.pay_method === "garanti" ? (
                      e.has_bank_details ? (
                        <>
                          {e.bank_account_name}
                          <div>şube {e.bank_branch_code} · hesap {e.bank_account_no}</div>
                        </>
                      ) : (
                        <span className="text-rose-700">eksik</span>
                      )
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[11px] font-medium ring-1",
                        e.status === "active"
                          ? "bg-emerald-50 text-emerald-700 ring-emerald-200/70"
                          : e.status === "left"
                            ? "bg-slate-100 text-slate-600 ring-slate-200"
                            : "bg-amber-50 text-amber-800 ring-amber-200/70"
                      )}
                    >
                      {STATUS_LABEL[e.status]}
                      {e.end_date ? ` ${dmy(e.end_date)}` : ""}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(e)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    {e.status !== "left" ? (
                      <Button size="sm" variant="ghost" className="text-rose-700" onClick={() => setLeaving(e)} title="İşten çıkış">
                        <UserMinus className="h-3.5 w-3.5" />
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      {loans.data && loans.data.length > 0 ? (
        <section className="rounded-2xl border bg-card shadow-xs">
          <header className="border-b px-4 py-3">
            <div className="font-semibold tracking-tight">Borçlar — şirket borcu ve çalışma izni</div>
            <div className="text-xs text-muted-foreground">
              Otomatik taksitli borçlar her ayın bordrosuna kesinti olarak kendiliğinden düşer; borç bitince durur.
            </div>
          </header>
          <ul className="divide-y text-sm">
            {loans.data.map((l) => {
              const done = l.outstanding <= 0.5;
              return (
                <li key={l.id} className={cn("flex flex-wrap items-center gap-3 px-4 py-2.5", (l.closed_at || done) && "opacity-60")}>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[11px] font-medium ring-1",
                      l.category === "work_permit" ? "bg-sky-50 text-sky-800 ring-sky-200/70" : "bg-slate-100 text-slate-700 ring-slate-200"
                    )}
                  >
                    {l.category === "work_permit" ? "Çalışma izni" : "Şirket borcu"}
                  </span>
                  <span className="font-medium">{l.full_name}</span>
                  <span className="text-muted-foreground">
                    {money(l.principal)} ₺{l.loan_date ? ` (${dmy(l.loan_date)})` : ""} · ödenen {money(l.opening_repaid + l.repaid)} ₺
                  </span>
                  <span className={cn("tabular-nums font-medium", done ? "text-emerald-700" : "text-rose-700")}>
                    {done ? "bitti" : `kalan ${money(l.outstanding)} ₺`}
                  </span>
                  {l.installment ? (
                    <span className="text-xs text-muted-foreground">
                      taksit {money(l.installment)} ₺/ay{l.auto_deduct ? " · otomatik" : " · elle"}
                      {l.start_year && l.start_month ? ` · ${String(l.start_month).padStart(2, "0")}.${l.start_year}'den` : ""}
                    </span>
                  ) : null}
                  {l.note ? <span className="text-xs text-muted-foreground">{l.note}</span> : null}
                  {l.repayments.length ? (
                    <span className="text-xs text-muted-foreground">
                      kesilen: {l.repayments.map((r) => `${r.period} ${money(r.amount)}${r.voided ? " (iptal)" : ""}`).join(", ")}
                    </span>
                  ) : null}
                  {l.closed_at ? <span className="text-xs">kapalı</span> : null}
                  <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setEditingLoan(l)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {editing ? (
        <EmployeeDialog employee={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={invalidate} />
      ) : null}
      {leaving ? <LeaveDialog employee={leaving} onClose={() => setLeaving(null)} onSaved={invalidate} /> : null}
      {importOpen ? <ImportDialog onClose={() => setImportOpen(false)} onDone={invalidate} /> : null}
      {loanOpen ? <LoanDialog employees={list.data ?? []} onClose={() => setLoanOpen(false)} onSaved={invalidate} /> : null}
      {editingLoan ? <LoanEditDialog loan={editingLoan} onClose={() => setEditingLoan(null)} onSaved={invalidate} /> : null}
    </div>
  );
}

type EmpForm = {
  store_id: string;
  full_name: string;
  position: string;
  commission_profile: (typeof COMMISSION_PROFILES)[number];
  base_salary: number | undefined;
  pay_method: (typeof PAY_METHODS)[number];
  bank_account_name: string;
  bank_branch_code: string;
  bank_account_no: string;
  iban: string;
  is_registered: boolean;
  is_gross_minimum: boolean;
  perfume_eligible: boolean;
  garment_eligible: boolean;
  paid_month_early: boolean;
  nebim_name: string;
  aliases: string;
  start_date: string;
  status: "active" | "inactive" | "left";
  notes: string;
};

function EmployeeDialog({ employee, onClose, onSaved }: { employee: Emp | null; onClose: () => void; onSaved: () => void }) {
  const stores = trpc.payroll.stores.useQuery();
  const [f, setF] = useState<EmpForm>(() =>
    employee
      ? {
          store_id: employee.store_id,
          full_name: employee.full_name,
          position: employee.position,
          commission_profile: employee.commission_profile,
          base_salary: employee.base_salary,
          pay_method: employee.pay_method,
          bank_account_name: employee.bank_account_name ?? "",
          bank_branch_code: employee.bank_branch_code ?? "",
          bank_account_no: employee.bank_account_no ?? "",
          iban: employee.iban ?? "",
          is_registered: employee.is_registered,
          is_gross_minimum: employee.is_gross_minimum,
          perfume_eligible: employee.perfume_eligible,
          garment_eligible: employee.garment_eligible,
          paid_month_early: employee.paid_month_early,
          nebim_name: employee.nebim_name ?? "",
          aliases: employee.aliases.join(", "),
          start_date: employee.start_date ?? "",
          status: employee.status,
          notes: employee.notes ?? "",
        }
      : {
          store_id: "",
          full_name: "",
          position: "Satış Asistanı",
          commission_profile: "mavi_asistan",
          base_salary: undefined,
          pay_method: "garanti",
          bank_account_name: "",
          bank_branch_code: "",
          bank_account_no: "",
          iban: "",
          is_registered: true,
          is_gross_minimum: false,
          perfume_eligible: false,
          garment_eligible: false,
          paid_month_early: false,
          nebim_name: "",
          aliases: "",
          start_date: "",
          status: "active",
          notes: "",
        }
  );
  const set = <K extends keyof EmpForm>(k: K, v: EmpForm[K]) => setF((x) => ({ ...x, [k]: v }));

  const create = trpc.payroll.employees.create.useMutation({
    onSuccess: () => {
      toast.success("Personel eklendi — açık dönemlere satırı eklendi");
      onSaved();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });
  const update = trpc.payroll.employees.update.useMutation({
    onSuccess: () => {
      toast.success("Kaydedildi");
      onSaved();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const submit = () => {
    const payload = {
      store_id: f.store_id,
      full_name: f.full_name,
      position: f.position,
      commission_profile: f.commission_profile,
      base_salary: f.base_salary ?? 0,
      pay_method: f.pay_method,
      bank_account_name: f.bank_account_name || null,
      bank_branch_code: f.bank_branch_code || null,
      bank_account_no: f.bank_account_no || null,
      iban: f.iban || null,
      is_registered: f.is_registered,
      is_gross_minimum: f.is_gross_minimum,
      perfume_eligible: f.perfume_eligible,
      garment_eligible: f.garment_eligible,
      paid_month_early: f.paid_month_early,
      nebim_name: f.nebim_name || null,
      aliases: f.aliases
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      start_date: f.start_date || null,
      status: f.status,
      notes: f.notes || null,
    };
    if (employee) update.mutate({ id: employee.id, ...payload });
    else create.mutate(payload);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{employee ? employee.full_name : "Yeni personel"}</DialogTitle>
          <DialogDescription>Baz maaş NET'tir. Ödeme şekli talimata girip girmeyeceğini belirler.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <F label="Ad soyad" wide>
            <Input value={f.full_name} onChange={(e) => set("full_name", e.target.value)} />
          </F>
          <F label="Mağaza">
            <Select value={f.store_id} onValueChange={(v) => set("store_id", v)}>
              <SelectTrigger>
                <SelectValue placeholder="Mağaza seç" />
              </SelectTrigger>
              <SelectContent>
                {(stores.data ?? []).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </F>
          <F label="Pozisyon">
            <Input list="payroll-positions" value={f.position} onChange={(e) => set("position", e.target.value)} />
            <datalist id="payroll-positions">
              {POSITIONS.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </F>
          <F label="Komisyon profili" wide>
            <Select value={f.commission_profile} onValueChange={(v) => set("commission_profile", v as EmpForm["commission_profile"])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COMMISSION_PROFILES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {PROFILE_LABEL[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </F>
          <F label="Baz maaş (NET, aylık)">
            <MoneyInput value={f.base_salary} onChange={(v) => set("base_salary", v)} />
          </F>
          <F label="Ödeme şekli">
            <Select value={f.pay_method} onValueChange={(v) => set("pay_method", v as EmpForm["pay_method"])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAY_METHODS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {PAY_METHOD_LABEL[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </F>
          <F label="Talimattaki isim (banka)">
            <Input value={f.bank_account_name} onChange={(e) => set("bank_account_name", e.target.value)} placeholder="BÜYÜK HARF" />
          </F>
          <F label="Şube kodu">
            <Input value={f.bank_branch_code} onChange={(e) => set("bank_branch_code", e.target.value)} />
          </F>
          <F label="Hesap no">
            <Input value={f.bank_account_no} onChange={(e) => set("bank_account_no", e.target.value)} />
          </F>
          <F label="IBAN (isteğe bağlı)">
            <Input value={f.iban} onChange={(e) => set("iban", e.target.value)} placeholder="TR…" />
          </F>
          <F label="Nebim satıcı adı (Derimod ciro eşlemesi)">
            <Input value={f.nebim_name} onChange={(e) => set("nebim_name", e.target.value)} />
          </F>
          <F label="Takma adlar (SAP / KPI / HR; virgülle)">
            <Input value={f.aliases} onChange={(e) => set("aliases", e.target.value)} />
          </F>
          <F label="İşe başlama">
            <Input type="date" value={f.start_date} onChange={(e) => set("start_date", e.target.value)} />
          </F>
          <F label="Durum">
            <Select value={f.status} onValueChange={(v) => set("status", v as EmpForm["status"])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Aktif</SelectItem>
                <SelectItem value="inactive">Pasif (bu ay ödenmez)</SelectItem>
                <SelectItem value="left">Ayrıldı</SelectItem>
              </SelectContent>
            </Select>
          </F>
          <div className="col-span-2 grid grid-cols-2 gap-2 text-sm">
            <Check label="Kayıtlı personel" v={f.is_registered} on={(v) => set("is_registered", v)} />
            <Check label="Brüt asgari üzerinden nakit" v={f.is_gross_minimum} on={(v) => set("is_gross_minimum", v)} />
            <Check label="Parfüm primi alır (Mavi kasiyer)" v={f.perfume_eligible} on={(v) => set("perfume_eligible", v)} />
            <Check label="Giysi primi alır (Derimod)" v={f.garment_eligible} on={(v) => set("garment_eligible", v)} />
            <Check label="Maaşı bir ay önceden ödenir" v={f.paid_month_early} on={(v) => set("paid_month_early", v)} />
          </div>
          <F label="Kalıcı notlar" wide>
            <textarea className="w-full min-h-[64px] rounded-md border bg-background px-3 py-2 text-sm" value={f.notes} onChange={(e) => set("notes", e.target.value)} />
          </F>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
          <Button onClick={submit} disabled={create.isPending || update.isPending || !f.store_id || !f.full_name.trim()}>
            Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LeaveDialog({ employee, onClose, onSaved }: { employee: Emp; onClose: () => void; onSaved: () => void }) {
  const [date, setDate] = useState(todayIso());
  const [note, setNote] = useState("");
  const leave = trpc.payroll.employees.leave.useMutation({
    onSuccess: () => {
      toast.success(`${employee.full_name} ayrıldı olarak işaretlendi`);
      onSaved();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>İşten çıkış — {employee.full_name}</DialogTitle>
          <DialogDescription>
            Son ayın satırı kalır; çıkış mutabakatını (izin ödemesi, borç bakiyesi, çalışma izni) o satıra ek hak ediş / kesinti olarak gir.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <F label="Ayrılış tarihi">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </F>
          <F label="Not">
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </F>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
          <Button variant="destructive" onClick={() => leave.mutate({ id: employee.id, end_date: date, note: note || null })} disabled={leave.isPending}>
            Ayrıldı olarak işaretle
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [result, setResult] = useState<{ matched: string[]; unmatched: string[]; rows: number } | null>(null);
  const imp = trpc.payroll.employees.importAccounts.useMutation({
    onSuccess: (r) => {
      setResult(r);
      onDone();
    },
    onError: (e) => toast.error(e.message),
  });
  const onFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const b64 = String(reader.result).split(",")[1] ?? "";
      imp.mutate({ file_base64: b64 });
    };
    reader.readAsDataURL(file);
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Hesapları talimattan aktar</DialogTitle>
          <DialogDescription>
            Daha önce bankaya gönderilmiş bir Garanti talimat dosyasını (TGB Yeni Maaş Dosyası) seç. 13. satırdan itibaren isim, şube, hesap ve IBAN okunur;
            isim eşleşen personelin BOŞ alanları doldurulur.
          </DialogDescription>
        </DialogHeader>
        <Input type="file" accept=".xlsx" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} disabled={imp.isPending} />
        {result ? (
          <div className="text-sm space-y-2">
            <div>
              {result.rows} satır okundu · <b>{result.matched.length}</b> eşleşti
            </div>
            {result.unmatched.length ? (
              <div className="text-rose-700">Eşleşmeyen: {result.unmatched.join(", ")} — personel kartına &quot;talimattaki isim&quot; veya takma ad ekleyip tekrar dene.</div>
            ) : null}
            <ul className="max-h-48 overflow-y-auto text-xs text-muted-foreground">
              {result.matched.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Kapat
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function nextMonthValue(): string {
  const d = new Date();
  const m = d.getMonth() + 2; // gelecek ay
  const y = d.getFullYear() + (m > 12 ? 1 : 0);
  return `${y}-${String(((m - 1) % 12) + 1).padStart(2, "0")}`;
}

function LoanDialog({ employees, onClose, onSaved }: { employees: Emp[]; onClose: () => void; onSaved: () => void }) {
  const [employeeId, setEmployeeId] = useState("");
  const [category, setCategory] = useState<"loan" | "work_permit">("work_permit");
  const [principal, setPrincipal] = useState<number | undefined>(undefined);
  const [repaid, setRepaid] = useState<number | undefined>(undefined);
  const [months, setMonths] = useState("12");
  const [installment, setInstallment] = useState<number | undefined>(undefined);
  const [auto, setAuto] = useState(true);
  const [start, setStart] = useState(nextMonthValue());
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const create = trpc.payroll.loans.create.useMutation({
    onSuccess: () => {
      toast.success("Borç kaydedildi — taksitler açık aylara işlendi");
      onSaved();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });
  const base = (principal ?? 0) - (repaid ?? 0);
  const m = Math.max(1, Math.round(Number(months) || 0));
  const suggested = base > 0 ? Math.round((base / m) * 100) / 100 : undefined;
  const effInstallment = installment ?? suggested;
  const [sy, sm] = start.split("-").map(Number);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Borç ekle</DialogTitle>
          <DialogDescription>
            Çalışma izni veya şirket borcu. Otomatik taksit açıksa her ayın bordrosuna kesinti olarak kendiliğinden düşer, borç bitince durur.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <F label="Çalışan">
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger>
                <SelectValue placeholder="Seç" />
              </SelectTrigger>
              <SelectContent>
                {employees
                  .filter((e) => e.status !== "left")
                  .map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.full_name} — {e.store_name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </F>
          <F label="Tür">
            <Select value={category} onValueChange={(v) => setCategory(v as "loan" | "work_permit")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="work_permit">Çalışma izni borcu</SelectItem>
                <SelectItem value="loan">Şirket borcu (kredi)</SelectItem>
              </SelectContent>
            </Select>
          </F>
          <div className="grid grid-cols-2 gap-3">
            <F label="Borç tutarı">
              <MoneyInput value={principal} onChange={setPrincipal} />
            </F>
            <F label="Daha önce ödenen">
              <MoneyInput value={repaid} onChange={setRepaid} />
            </F>
            <F label="Kaç taksit">
              <Input type="number" inputMode="numeric" min={1} max={60} value={months} onChange={(e) => setMonths(e.target.value)} />
            </F>
            <F label={`Aylık taksit${suggested ? ` (öneri ${money(suggested)})` : ""}`}>
              <MoneyInput value={installment} onChange={setInstallment} placeholder={suggested ? money(suggested) : ""} />
            </F>
            <F label="İlk kesinti ayı">
              <Input type="month" value={start} onChange={(e) => setStart(e.target.value)} />
            </F>
            <F label="Borç tarihi">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </F>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
            Taksitleri maaştan otomatik kes
          </label>
          <F label="Not">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="örn. çalışma izni ücreti şirketçe ödendi (02.10.2026)" />
          </F>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
          <Button
            onClick={() =>
              create.mutate({
                employee_id: employeeId,
                category,
                principal: principal ?? 0,
                opening_repaid: repaid ?? 0,
                installment: effInstallment ?? null,
                auto_deduct: auto && !!effInstallment,
                start_year: sy || null,
                start_month: sm || null,
                loan_date: date || null,
                note: note || null,
              })
            }
            disabled={create.isPending || !employeeId || !principal}
          >
            Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LoanEditDialog({ loan, onClose, onSaved }: { loan: Loan; onClose: () => void; onSaved: () => void }) {
  const [installment, setInstallment] = useState<number | undefined>(loan.installment ?? undefined);
  const [auto, setAuto] = useState(loan.auto_deduct);
  const [start, setStart] = useState(loan.start_year && loan.start_month ? `${loan.start_year}-${String(loan.start_month).padStart(2, "0")}` : "");
  const [note, setNote] = useState(loan.note ?? "");
  const [closed, setClosed] = useState(!!loan.closed_at);
  const update = trpc.payroll.loans.update.useMutation({
    onSuccess: () => {
      toast.success("Borç güncellendi");
      onSaved();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });
  const [sy, sm] = start ? start.split("-").map(Number) : [null, null];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Borç — {loan.full_name}</DialogTitle>
          <DialogDescription>
            {money(loan.principal)} ₺ · kalan {money(loan.outstanding)} ₺. Taksit ve otomatik kesinti ayarı; geçmiş kesintiler değişmez.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <F label="Aylık taksit">
              <MoneyInput value={installment} onChange={setInstallment} />
            </F>
            <F label="İlk kesinti ayı">
              <Input type="month" value={start} onChange={(e) => setStart(e.target.value)} />
            </F>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
            Taksitleri maaştan otomatik kes
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={closed} onChange={(e) => setClosed(e.target.checked)} />
            Borcu kapat (artık kesilmesin)
          </label>
          <F label="Not">
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </F>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
          <Button
            onClick={() =>
              update.mutate({ id: loan.id, installment: installment ?? null, auto_deduct: auto, start_year: sy, start_month: sm, note: note || null, closed })
            }
            disabled={update.isPending}
          >
            Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function F({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={cn("space-y-1", wide && "col-span-2")}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
function Check({ label, v, on }: { label: string; v: boolean; on: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2">
      <input type="checkbox" className="h-4 w-4" checked={v} onChange={(e) => on(e.target.checked)} />
      {label}
    </label>
  );
}
