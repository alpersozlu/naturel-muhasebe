"use client";

import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoneyInput } from "@/components/ui/money-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ADDITION_CATEGORIES, CHANNEL_LABEL, DEDUCTION_CATEGORIES, PAYMENT_CATEGORIES } from "@/server/services/payroll/rules";
import { KIND_LABEL, money, todayIso } from "./format";

export type EntryKind = "advance" | "payment" | "deduction" | "addition";

const HELP: Record<EntryKind, string> = {
  advance: "Kişiye ödenen avans; bu ayın maaşından düşer. Toplu talimatla verildiyse talimat ekranını kullan.",
  payment: "Talimat dışı yapılan ödeme (tekil talimat, Ziraat, nakit, erken ödenen maaş).",
  deduction: "Hak edişten düşülen tutar: devir, kasa farkı, borç taksidi, çalışma izni, çift ödeme tahsili. Not zorunlu.",
  addition: "Hak edişe eklenen tutar: izin ödemesi, bonus, düzeltme. Not zorunlu.",
};

export function EntryDialog({
  lineId,
  employeeId,
  fullName,
  kind,
  onClose,
  onCreated,
}: {
  lineId: string;
  employeeId: string;
  fullName: string;
  kind: EntryKind;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [date, setDate] = useState(todayIso());
  const [amount, setAmount] = useState<number | undefined>(undefined);
  const [category, setCategory] = useState<string>(kind === "payment" ? "single" : kind === "deduction" ? "carry_over" : kind === "addition" ? "bonus" : "");
  const [channel, setChannel] = useState<string>(kind === "advance" || kind === "payment" ? "cash" : "");
  const [note, setNote] = useState("");
  const [reference, setReference] = useState("");
  const [loanId, setLoanId] = useState<string>("");

  const loans = trpc.payroll.loans.list.useQuery(undefined, { enabled: kind === "deduction" });
  const myLoans = (loans.data ?? []).filter((l) => l.employee_id === employeeId && !l.closed_at);

  const create = trpc.payroll.entries.create.useMutation({
    onSuccess: () => {
      toast.success(`${KIND_LABEL[kind]} kaydedildi`);
      onCreated();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const categories =
    kind === "deduction" ? DEDUCTION_CATEGORIES : kind === "addition" ? ADDITION_CATEGORIES : kind === "payment" ? PAYMENT_CATEGORIES : null;

  const submit = () => {
    if (!amount || amount <= 0) {
      toast.error("Tutar gir");
      return;
    }
    create.mutate({
      line_id: lineId,
      kind,
      category: category || null,
      channel: channel ? (channel as "garanti" | "ziraat" | "cash" | "other") : null,
      entry_date: date,
      amount,
      note: note || null,
      reference: reference || null,
      loan_id: kind === "deduction" && category === "loan" && loanId ? loanId : null,
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {KIND_LABEL[kind]} — {fullName}
          </DialogTitle>
          <DialogDescription>{HELP[kind]}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Tarih</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Tutar (₺)</Label>
            <MoneyInput value={amount} onChange={setAmount} autoFocus />
          </div>
          {categories ? (
            <div className="space-y-1 col-span-2">
              <Label className="text-xs text-muted-foreground">Tür</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(categories).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          {kind === "deduction" && category === "loan" ? (
            <div className="space-y-1 col-span-2">
              <Label className="text-xs text-muted-foreground">Hangi borç</Label>
              <Select value={loanId} onValueChange={setLoanId}>
                <SelectTrigger>
                  <SelectValue placeholder={myLoans.length ? "Borç seç" : "Bu kişide açık borç yok"} />
                </SelectTrigger>
                <SelectContent>
                  {myLoans.map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {money(l.principal)} ₺ — kalan {money(l.outstanding)} ₺{l.note ? ` (${l.note})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          {kind === "advance" || kind === "payment" ? (
            <div className="space-y-1 col-span-2">
              <Label className="text-xs text-muted-foreground">Kanal</Label>
              <Select value={channel} onValueChange={setChannel}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(CHANNEL_LABEL).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <div className="space-y-1 col-span-2">
            <Label className="text-xs text-muted-foreground">Not {kind === "deduction" || kind === "addition" ? "(zorunlu)" : ""}</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ne, kim karar verdi, ne zaman" />
          </div>
          <div className="space-y-1 col-span-2">
            <Label className="text-xs text-muted-foreground">Referans (talimat dosyası, dekont…)</Label>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
          <Button onClick={submit} disabled={create.isPending}>
            Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
