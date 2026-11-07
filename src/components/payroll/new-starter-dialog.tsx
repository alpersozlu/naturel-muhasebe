"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, UserPlus } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoneyInput } from "@/components/ui/money-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  COMMISSION_PROFILES,
  MIN_WAGE,
  PAY_METHODS,
  PAY_METHOD_LABEL,
  POSITIONS,
  PROFILE_LABEL,
  dayPaidBase,
  dayRate,
  workedDaysInPeriod,
  type CommissionProfile,
} from "@/server/services/payroll/rules";
import { money } from "./format";

/**
 * Yeni başlayan (sahibi, 07.11.2026): ay ortasında işe girene ad + mağaza + giriş tarihi
 * yazılır, çalıştığı gün kendiliğinden çıkar (pazar hariç), o ayın maaşı baz ÷ 26 ile
 * hesaplanır; "Ekle" deyince personel kartı ve bu ayın satırı birlikte oluşur.
 */
export function NewStarterDialog({
  period,
  onClose,
  onCreated,
}: {
  period: { id: string; year: number; month: number };
  onClose: () => void;
  onCreated: () => void;
}) {
  const stores = trpc.payroll.stores.useQuery();
  const first = `${period.year}-${String(period.month).padStart(2, "0")}-01`;
  const [storeId, setStoreId] = useState("");
  const [name, setName] = useState("");
  const [position, setPosition] = useState<string>("Satış Asistanı");
  const [profile, setProfile] = useState<CommissionProfile | "">("");
  const [base, setBase] = useState<number | undefined>(MIN_WAGE.gross);
  const [payMethod, setPayMethod] = useState<(typeof PAY_METHODS)[number]>("cash");
  const [startDate, setStartDate] = useState(first);
  const [daysText, setDaysText] = useState("");

  const store = stores.data?.find((s) => s.id === storeId);
  const isMavi = /mavi/i.test(store?.brand_name ?? "");
  // Pozisyona ve markaya göre varsayılan prim profili; elle değiştirilebilir.
  const suggestedProfile: CommissionProfile = /asistan|danışman/i.test(position) ? (isMavi ? "mavi_asistan" : "deri_asistan") : "none";
  const effProfile: CommissionProfile = profile || suggestedProfile;

  const autoDays = useMemo(() => workedDaysInPeriod(period.year, period.month, startDate, null), [period.year, period.month, startDate]);
  const days = daysText.trim() === "" ? autoDays : Number(daysText.replace(",", ".")) || 0;
  const salary = base == null ? 0 : days == null ? base : dayPaidBase(base, days);

  const create = trpc.payroll.employees.createStarter.useMutation({
    onSuccess: (r) => {
      toast.success(`${name.trim()} eklendi — bu ay ${r.worked_days ?? "tam"} gün, maaş ${money(r.base_salary)} ₺`);
      onCreated();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const canSave = !!storeId && name.trim().length >= 2 && !!base && base > 0 && /^\d{4}-\d{2}-\d{2}$/.test(startDate) && !create.isPending;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            Yeni başlayan
          </DialogTitle>
          <DialogDescription>
            Ad, mağaza ve işe giriş tarihini yaz; bu ayın maaşı çalıştığı gün × (baz ÷ 26) ile hesaplanır. Personel kartı ve bu ayın satırı birlikte açılır.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1.5">
            <Label className="text-xs">Ad soyad</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ad Soyad" autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Mağaza</Label>
            <Select value={storeId} onValueChange={setStoreId}>
              <SelectTrigger><SelectValue placeholder="Mağaza seç" /></SelectTrigger>
              <SelectContent>
                {(stores.data ?? []).map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Pozisyon</Label>
            <Select value={position} onValueChange={(v) => { setPosition(v); setProfile(""); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {POSITIONS.map((p) => (
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">İşe giriş</Label>
            <Input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); setDaysText(""); }} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Bu ay çalıştığı gün</Label>
            <div className="flex items-center gap-2">
              <Input type="number" inputMode="numeric" min={0} max={31} step="1" value={daysText} onChange={(e) => setDaysText(e.target.value)} placeholder={autoDays == null ? "tam ay" : String(autoDays)} className="w-24 text-right" />
              <span className="text-xs text-muted-foreground">{autoDays != null ? `öneri ${autoDays} gün (pazar hariç)` : "ay başından beri: tam ay"}</span>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Aylık baz (brüt asgari {money(MIN_WAGE.gross)})</Label>
            <MoneyInput value={base} onChange={setBase} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Ödeme</Label>
            <Select value={payMethod} onValueChange={(v) => setPayMethod(v as (typeof PAY_METHODS)[number])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PAY_METHODS.map((m) => (
                  <SelectItem key={m} value={m}>{PAY_METHOD_LABEL[m]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label className="text-xs">Prim profili</Label>
            <Select value={effProfile} onValueChange={(v) => setProfile(v as CommissionProfile)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {COMMISSION_PROFILES.map((p) => (
                  <SelectItem key={p} value={p}>{PROFILE_LABEL[p]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm">
          <div className="flex items-baseline justify-between">
            <span className="text-muted-foreground">Bu ayın maaşı</span>
            <span className="text-lg font-bold tabular-nums">{money(salary)} ₺</span>
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">
            {base && days != null ? `${days} gün × ${money(dayRate(base))} (${money(base)} ÷ 26)` : base ? `tam ay ${money(base)}` : "baz maaş gir"}
            {" · "}satış primi ve mesai bordroda ayrıca hesaplanır
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Vazgeç</Button>
          <Button
            disabled={!canSave}
            onClick={() =>
              create.mutate({
                period_id: period.id,
                store_id: storeId,
                full_name: name.trim(),
                position,
                commission_profile: effProfile,
                base_salary: base ?? 0,
                pay_method: payMethod,
                is_gross_minimum: base === MIN_WAGE.gross,
                start_date: startDate,
                worked_days: daysText.trim() === "" ? undefined : days,
              })
            }
          >
            {create.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <UserPlus className="h-4 w-4 mr-2" />}
            Ekle
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
