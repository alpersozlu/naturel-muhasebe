"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { dateNum, dayLong } from "./format";
import { Notice } from "./staff-home";

/**
 * SAHİBİ AYARLARI: resmi tatil / bayram takvimi (bu günlerde çalışan 1 hak
 * günü kazanır) ve personel ↔ giriş hesabı eşleştirmesi. Kolay İK'dan veri
 * aktarımı burada YOK — sahibi talimat verene kadar.
 */
export function HrSettings() {
  return (
    <div className="space-y-8">
      <Holidays />
      <Accounts />
    </div>
  );
}

function Holidays() {
  const utils = trpc.useUtils();
  const me = trpc.hr.me.useQuery();
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const save = trpc.hr.saveHoliday.useMutation({
    onSuccess: () => {
      toast.success("Kaydedildi");
      setDate("");
      setName("");
      void utils.hr.me.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const del = trpc.hr.deleteHoliday.useMutation({ onSuccess: () => void utils.hr.me.invalidate(), onError: (e) => toast.error(e.message) });

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-xl font-semibold">Resmi tatil ve bayramlar</h2>
        <p className="text-sm text-muted-foreground">Bu günlerde çalışan personel 1 hak günü kazanır; bu günler yıllık izinden düşmez.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <input type="date" className="h-10 rounded-lg border px-3" value={date} onChange={(e) => setDate(e.target.value)} />
        <input className="h-10 min-w-48 flex-1 rounded-lg border px-3" placeholder="Adı (örn. 1 Mayıs Emek ve Dayanışma Günü)" value={name} onChange={(e) => setName(e.target.value)} />
        <Button disabled={!date || name.trim().length < 2 || save.isPending} onClick={() => save.mutate({ date, name })}>
          Ekle
        </Button>
      </div>
      {me.data && me.data.holidays.length === 0 && <Notice tone="amber" title="Takvim boş" text="Henüz resmi tatil girilmedi. Bayramda çalışan personel bildirim yapamaz." />}
      <ul className="divide-y rounded-xl border bg-white">
        {me.data?.holidays.map((h) => (
          <li key={h.id} className="flex items-center justify-between gap-2 p-2.5 text-sm">
            <span>
              <b>{dayLong(h.date)}</b> {h.date.slice(0, 4)} — {h.name}
            </span>
            <Button size="icon" variant="ghost" onClick={() => del.mutate({ id: h.id })}>
              <Trash2 />
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Accounts() {
  const utils = trpc.useUtils();
  const q = trpc.hr.accounts.useQuery();
  const link = trpc.hr.linkUser.useMutation({
    onSuccess: () => {
      toast.success("Eşleştirildi");
      void utils.hr.accounts.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  if (q.isLoading) return <Loader2 className="h-5 w-5 animate-spin" />;
  if (!q.data) return null;
  const { employees, users } = q.data;
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-xl font-semibold">Personel hesapları</h2>
        <p className="text-sm text-muted-foreground">
          Personel kendi e-posta ve şifresiyle girer. Hesabı Yönetici Portalı › Kullanıcılar'da “Personel (İK)” rolüyle açın, sonra burada kişiyle eşleştirin.
        </p>
      </div>
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="p-2">Personel</th>
              <th className="p-2">İşe giriş</th>
              <th className="p-2">Giriş hesabı</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {employees.map((e) => (
              <tr key={e.id}>
                <td className="p-2">
                  <div className="font-medium">{e.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {e.brand} {e.store}
                  </div>
                </td>
                <td className="p-2 whitespace-nowrap">{e.hireDate ? dateNum(e.hireDate) : <span className="text-red-700">yok</span>}</td>
                <td className="p-2">
                  <select
                    className="h-9 w-full max-w-72 rounded-lg border px-2"
                    value={e.user?.id ?? ""}
                    disabled={link.isPending}
                    onChange={(ev) => link.mutate({ employeeId: e.id, userId: ev.target.value || null })}
                  >
                    <option value="">— bağlı değil —</option>
                    {users
                      .filter((u) => !u.linkedTo || u.linkedTo === e.id)
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name ? `${u.name} · ` : ""}
                          {u.email}
                        </option>
                      ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
