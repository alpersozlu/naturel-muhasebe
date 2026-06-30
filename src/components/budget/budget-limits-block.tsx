"use client";

import { useState } from "react";
import { Target, Plus, AlertTriangle, AlertCircle, CheckCircle2, Trash2, Pencil, Store as StoreIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import type { BudgetLimitStatus } from "@/server/services/budget/status";

const TRY = new Intl.NumberFormat("tr-TR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const fmtMoneyShort = (n: number) => {
  if (Math.abs(n) >= 1_000_000) return `${TRY.format(n / 1_000_000)}M`;
  if (Math.abs(n) >= 1_000) return `${TRY.format(n / 1_000)}K`;
  return TRY.format(n);
};

const CATEGORY_LABEL: Record<string, string> = {
  rent: "Kira",
  electricity: "Elektrik",
  water: "Su",
  internet: "İnternet",
  stationery: "Kırtasiye",
  cleaning: "Temizlik",
  maintenance: "Bakım",
  salary: "Maaş",
  bonus: "Prim/Avans",
  supplies: "Sarf Malzeme",
  food: "Yemek",
  marketing: "Pazarlama",
  other: "Diğer",
};

const PERIOD_LABEL: Record<string, string> = {
  monthly: "Aylık",
  yearly: "Yıllık",
  custom: "Özel Dönem",
};

function statusTone(status: BudgetLimitStatus["alert_status"]) {
  if (status === "exceeded") {
    return {
      card: "border-rose-200 bg-gradient-to-br from-rose-50 to-white",
      bar: "bg-rose-500",
      text: "text-rose-700",
      pill: "bg-rose-50 text-rose-700 border-rose-200",
      icon: AlertCircle,
      label: "Aşıldı",
    };
  }
  if (status === "warning") {
    return {
      card: "border-amber-200 bg-gradient-to-br from-amber-50 to-white",
      bar: "bg-amber-500",
      text: "text-amber-700",
      pill: "bg-amber-50 text-amber-700 border-amber-200",
      icon: AlertTriangle,
      label: "Uyarı",
    };
  }
  return {
    card: "border-emerald-200/60 bg-white",
    bar: "bg-emerald-500",
    text: "text-emerald-700",
    pill: "bg-emerald-50 text-emerald-700 border-emerald-200",
    icon: CheckCircle2,
    label: "Sağlıklı",
  };
}

function defaultName(b: BudgetLimitStatus): string {
  if (b.name) return b.name;
  const storeBit = b.store_name ?? "Tüm Mağazalar";
  const scopeBit = b.scope === "category" && b.category
    ? CATEGORY_LABEL[b.category] ?? b.category
    : "Toplam";
  const periodBit = PERIOD_LABEL[b.period] ?? b.period;
  return `${storeBit} — ${scopeBit} (${periodBit})`;
}

export function BudgetAlertBanner() {
  const { data } = trpc.budget.list.useQuery();
  if (!data) return null;
  const alerts = data.filter((b) => b.alert_status !== "ok");
  if (alerts.length === 0) return null;

  const exceeded = alerts.filter((b) => b.alert_status === "exceeded");
  const warnings = alerts.filter((b) => b.alert_status === "warning");

  return (
    <div className="space-y-2 mb-4">
      {exceeded.length > 0 && (
        <div className="rounded-2xl border border-rose-200 bg-gradient-to-r from-rose-50 to-white px-4 py-3 flex items-start gap-3 animate-fade-in">
          <AlertCircle className="h-5 w-5 text-rose-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-rose-900 text-sm">
              {exceeded.length} bütçe limiti aşıldı
            </div>
            <div className="text-xs text-rose-700/80 mt-0.5">
              {exceeded
                .slice(0, 3)
                .map((b) => `${defaultName(b)} (%${b.usage_pct.toFixed(0)})`)
                .join(" · ")}
              {exceeded.length > 3 ? ` · +${exceeded.length - 3} daha` : ""}
            </div>
          </div>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 to-white px-4 py-3 flex items-start gap-3 animate-fade-in">
          <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-amber-900 text-sm">
              {warnings.length} limit uyarı eşiğinde
            </div>
            <div className="text-xs text-amber-700/80 mt-0.5">
              {warnings
                .slice(0, 3)
                .map((b) => `${defaultName(b)} (%${b.usage_pct.toFixed(0)})`)
                .join(" · ")}
              {warnings.length > 3 ? ` · +${warnings.length - 3} daha` : ""}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function BudgetLimitsBlock() {
  const { data, isLoading } = trpc.budget.list.useQuery();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<BudgetLimitStatus | null>(null);

  const handleNew = () => {
    setEditing(null);
    setOpen(true);
  };
  const handleEdit = (limit: BudgetLimitStatus) => {
    setEditing(limit);
    setOpen(true);
  };

  return (
    <Card className="animate-fade-in">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
          <div>
            <div className="font-semibold flex items-center gap-2">
              <Target className="h-4 w-4 text-indigo-600" />
              Bütçe Limitleri
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Mağaza, kategori ve dönem bazlı gider sınırları — limite yaklaşınca uyarı, aşılınca alert
            </div>
          </div>
          <Button size="sm" onClick={handleNew}>
            <Plus className="h-4 w-4 mr-1.5" /> Yeni Limit
          </Button>
        </div>

        {isLoading ? (
          <div className="text-sm text-muted-foreground py-6 text-center">
            Yükleniyor…
          </div>
        ) : !data || data.length === 0 ? (
          <div className="text-center py-10 border-2 border-dashed border-slate-200 rounded-2xl">
            <Target className="h-10 w-10 text-slate-300 mx-auto mb-2" />
            <div className="font-medium text-slate-700">Henüz limit yok</div>
            <div className="text-xs text-muted-foreground mt-1 mb-3">
              Mağazaların aylık/yıllık gider sınırlarını belirleyin
            </div>
            <Button size="sm" variant="outline" onClick={handleNew}>
              <Plus className="h-4 w-4 mr-1.5" /> İlk Limiti Ekle
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {data.map((limit) => (
              <BudgetLimitCard
                key={limit.id}
                limit={limit}
                onEdit={() => handleEdit(limit)}
              />
            ))}
          </div>
        )}

        <BudgetLimitDialog
          open={open}
          onOpenChange={setOpen}
          editing={editing}
        />
      </CardContent>
    </Card>
  );
}

function BudgetLimitCard({
  limit,
  onEdit,
}: {
  limit: BudgetLimitStatus;
  onEdit: () => void;
}) {
  const tone = statusTone(limit.alert_status);
  const Icon = tone.icon;
  const utils = trpc.useUtils();
  const del = trpc.budget.delete.useMutation({
    onSuccess: () => {
      toast.success("Limit silindi");
      utils.budget.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const usageDisplay = Math.min(limit.usage_pct, 200); // 200% üzeri bar'da görsel kap
  const barWidth = Math.min(usageDisplay, 100); // bar kendisi max %100

  return (
    <div className={`rounded-2xl border ${tone.card} p-4 transition-all hover:shadow-sm`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0 flex-1">
          <div className="font-medium text-slate-900 truncate">{defaultName(limit)}</div>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <Badge variant="outline" className="text-[10px] font-normal">
              {PERIOD_LABEL[limit.period] ?? limit.period}
            </Badge>
            <span className="text-[10px] text-slate-500">· {limit.period_label}</span>
          </div>
        </div>
        <div className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${tone.pill}`}>
          <Icon className="h-3 w-3" /> {tone.label}
        </div>
      </div>

      <div className="flex items-baseline gap-1.5 mt-3">
        <span className={`text-2xl font-semibold tabular-nums ${tone.text}`}>
          %{limit.usage_pct.toFixed(0)}
        </span>
        <span className="text-xs text-slate-500">
          {fmtMoneyShort(limit.spent_try)} / {fmtMoneyShort(limit.limit_try)} ₺
        </span>
      </div>

      <div className="mt-2 h-2 rounded-full bg-slate-100 overflow-hidden">
        <div
          className={`h-full ${tone.bar} transition-all duration-300`}
          style={{ width: `${barWidth}%` }}
        />
      </div>

      <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-slate-100">
        <div className="text-[10px] text-slate-500 flex flex-wrap gap-x-2 gap-y-0.5">
          <span className="inline-flex items-center gap-1">
            <StoreIcon className="h-3 w-3" />
            {limit.store_name ?? "Tüm Mağazalar"}
          </span>
          <span>· Uyarı: %{limit.alert_pct}</span>
          {limit.mode === "ratio" && (
            <span className="block w-full">
              Ciro: {fmtMoneyShort(limit.revenue_base)} ₺ (kilitli günler)
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0"
            onClick={onEdit}
            title="Düzenle"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0 text-rose-600 hover:text-rose-700 hover:bg-rose-50"
            onClick={() => {
              if (confirm("Bu limit silinsin mi?")) {
                del.mutate({ id: limit.id });
              }
            }}
            title="Sil"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Form modal — yeni / düzenle
// ─────────────────────────────────────────────────────────────

type FormState = {
  name: string;
  store_id: string; // "" = global
  scope: "total" | "category";
  category: string; // ExpenseCategory | ""
  mode: "amount" | "ratio";
  amount_try: string;
  ratio_pct: string;
  period: "monthly" | "yearly" | "custom";
  period_start: string;
  period_end: string;
  alert_pct: string;
  notes: string;
};

const emptyForm: FormState = {
  name: "",
  store_id: "",
  scope: "total",
  category: "",
  mode: "amount",
  amount_try: "",
  ratio_pct: "",
  period: "monthly",
  period_start: "",
  period_end: "",
  alert_pct: "80",
  notes: "",
};

function BudgetLimitDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: BudgetLimitStatus | null;
}) {
  const [form, setForm] = useState<FormState>(emptyForm);

  // editing değişince form'u doldur
  const [lastEditingId, setLastEditingId] = useState<string | null>(null);
  if (open && editing && editing.id !== lastEditingId) {
    setForm({
      name: editing.name ?? "",
      store_id: editing.store_id ?? "",
      scope: editing.scope,
      category: editing.category ?? "",
      mode: editing.mode,
      amount_try: editing.amount_try ? String(editing.amount_try) : "",
      ratio_pct: editing.ratio_pct ? String(editing.ratio_pct) : "",
      period: editing.period,
      period_start: editing.period === "custom" ? editing.period_start : "",
      period_end: editing.period === "custom" ? editing.period_end : "",
      alert_pct: String(editing.alert_pct),
      notes: editing.notes ?? "",
    });
    setLastEditingId(editing.id);
  } else if (open && !editing && lastEditingId !== null) {
    setForm(emptyForm);
    setLastEditingId(null);
  }

  const { data: stores } = trpc.store.listAll.useQuery();
  const utils = trpc.useUtils();
  const create = trpc.budget.create.useMutation({
    onSuccess: () => {
      toast.success("Limit oluşturuldu");
      utils.budget.list.invalidate();
      onOpenChange(false);
    },
    onError: (e) => handleErr(e.message),
  });
  const update = trpc.budget.update.useMutation({
    onSuccess: () => {
      toast.success("Limit güncellendi");
      utils.budget.list.invalidate();
      onOpenChange(false);
    },
    onError: (e) => handleErr(e.message),
  });

  function handleErr(msg: string) {
    try {
      const parsed = JSON.parse(msg);
      if (Array.isArray(parsed) && parsed.length > 0) {
        toast.error(parsed.map((i: { message: string }) => i.message).join(" · "));
        return;
      }
    } catch {
      /* düz mesaj */
    }
    toast.error(msg);
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const category =
      form.scope === "category" && form.category
        ? (form.category as
            | "rent"
            | "electricity"
            | "water"
            | "internet"
            | "stationery"
            | "cleaning"
            | "maintenance"
            | "salary"
            | "bonus"
            | "supplies"
            | "food"
            | "marketing"
            | "other")
        : undefined;
    const payload = {
      name: form.name || undefined,
      store_id: form.store_id || undefined,
      scope: form.scope,
      category,
      mode: form.mode,
      amount_try: form.mode === "amount" ? form.amount_try : undefined,
      ratio_pct: form.mode === "ratio" ? form.ratio_pct : undefined,
      period: form.period,
      period_start: form.period === "custom" ? form.period_start : undefined,
      period_end: form.period === "custom" ? form.period_end : undefined,
      alert_pct: form.alert_pct,
      notes: form.notes || undefined,
    };
    if (editing) {
      update.mutate({ id: editing.id, ...payload });
    } else {
      create.mutate(payload);
    }
  };

  const submitting = create.isPending || update.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Limiti Düzenle" : "Yeni Bütçe Limiti"}</DialogTitle>
          <DialogDescription>
            Mağaza, kategori ve dönem belirleyerek sabit tutar veya ciro yüzdesi olarak sınır koy.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Mağaza */}
          <div className="space-y-1.5">
            <Label htmlFor="store">Mağaza</Label>
            <Select
              value={form.store_id || "_all"}
              onValueChange={(v) => setForm({ ...form, store_id: v === "_all" ? "" : v })}
            >
              <SelectTrigger id="store">
                <SelectValue placeholder="Mağaza seç" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">Tüm Mağazalar (global)</SelectItem>
                {(stores ?? []).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.brand.name} — {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Scope + Category */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="scope">Kapsam</Label>
              <Select
                value={form.scope}
                onValueChange={(v) =>
                  setForm({ ...form, scope: v as "total" | "category" })
                }
              >
                <SelectTrigger id="scope">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="total">Toplam gider</SelectItem>
                  <SelectItem value="category">Belirli kategori</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.scope === "category" && (
              <div className="space-y-1.5">
                <Label htmlFor="category">Kategori</Label>
                <Select
                  value={form.category}
                  onValueChange={(v) => setForm({ ...form, category: v })}
                >
                  <SelectTrigger id="category">
                    <SelectValue placeholder="Seç" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
                      <SelectItem key={k} value={k}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* Mode + Value */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="mode">Limit Türü</Label>
              <Select
                value={form.mode}
                onValueChange={(v) =>
                  setForm({ ...form, mode: v as "amount" | "ratio" })
                }
              >
                <SelectTrigger id="mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="amount">Sabit tutar (₺)</SelectItem>
                  <SelectItem value="ratio">Ciro yüzdesi (%)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              {form.mode === "amount" ? (
                <>
                  <Label htmlFor="amount">Tutar (₺)</Label>
                  <Input
                    id="amount"
                    type="number"
                    inputMode="decimal"
                    step="100"
                    min="0"
                    placeholder="örn 50000"
                    value={form.amount_try}
                    onChange={(e) =>
                      setForm({ ...form, amount_try: e.target.value })
                    }
                  />
                </>
              ) : (
                <>
                  <Label htmlFor="ratio">Yüzde (%)</Label>
                  <Input
                    id="ratio"
                    type="number"
                    inputMode="decimal"
                    step="0.5"
                    min="0"
                    max="100"
                    placeholder="örn 15"
                    value={form.ratio_pct}
                    onChange={(e) =>
                      setForm({ ...form, ratio_pct: e.target.value })
                    }
                  />
                </>
              )}
            </div>
          </div>

          {/* Period */}
          <div className="space-y-1.5">
            <Label htmlFor="period">Dönem</Label>
            <Select
              value={form.period}
              onValueChange={(v) =>
                setForm({
                  ...form,
                  period: v as "monthly" | "yearly" | "custom",
                })
              }
            >
              <SelectTrigger id="period">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="monthly">Aylık (her ay sıfırlanır)</SelectItem>
                <SelectItem value="yearly">Yıllık (her yıl sıfırlanır)</SelectItem>
                <SelectItem value="custom">Özel Dönem (iki tarih arası)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {form.period === "custom" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ps">Başlangıç</Label>
                <Input
                  id="ps"
                  type="date"
                  value={form.period_start}
                  onChange={(e) =>
                    setForm({ ...form, period_start: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pe">Bitiş</Label>
                <Input
                  id="pe"
                  type="date"
                  value={form.period_end}
                  onChange={(e) =>
                    setForm({ ...form, period_end: e.target.value })
                  }
                />
              </div>
            </div>
          )}

          {/* Alert pct */}
          <div className="space-y-1.5">
            <Label htmlFor="alert">Uyarı Eşiği (%)</Label>
            <Input
              id="alert"
              type="number"
              inputMode="decimal"
              step="5"
              min="1"
              max="100"
              value={form.alert_pct}
              onChange={(e) => setForm({ ...form, alert_pct: e.target.value })}
            />
            <div className="text-[11px] text-muted-foreground">
              Harcama bu yüzdeye ulaşınca sarı uyarı verilir (varsayılan %80).
            </div>
          </div>

          {/* Optional name + notes */}
          <div className="space-y-1.5">
            <Label htmlFor="name">İsim (opsiyonel)</Label>
            <Input
              id="name"
              placeholder="örn 'Lefkoşa kira limiti'"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              İptal
            </Button>
            <Button type="submit" disabled={submitting}>
              {editing ? "Kaydet" : "Limiti Oluştur"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
