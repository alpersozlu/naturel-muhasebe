"use client";

import { useMemo, useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import { CalendarHeart, ChevronRight, Hourglass, Loader2, Palmtree, Search, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import type { AppRouter } from "@/server/trpc/routers/_app";
import { cn } from "@/lib/utils";
import { Avatar } from "./avatar";
import { Notice } from "./staff-home";
import { PersonCard } from "./person-card";

type Data = inferRouterOutputs<AppRouter>["hr"]["people"];
type Person = Data["stores"][number]["people"][number];

const LEAVE_SHORT: Record<string, string> = { annual: "Yıllık izinde", lieu: "Hak gününde", sick: "Hastalık izninde", bereavement: "Vefat izninde", unpaid: "Ücretsiz izinde" };

/**
 * PERSONEL — mağaza mağaza. Kolay İK'da 38 kişi tek uzun listede, mağaza
 * ayrımı yok (sahibi: "karmaşık"). Burada her mağaza ayrı başlık, müdür en
 * üstte; sahibi tüm mağazaları (marka süzgeci + arama), müdür kendi mağazasını görür.
 */
export function HrPeople() {
  const q = trpc.hr.people.useQuery();
  const [search, setSearch] = useState("");
  const [brand, setBrand] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const brands = useMemo(() => Array.from(new Set(q.data?.stores.map((s) => s.brand) ?? [])), [q.data]);
  if (q.isLoading) return <Loader2 className="mx-auto mt-20 h-6 w-6 animate-spin text-muted-foreground" />;
  if (q.error || !q.data) return <Notice tone="red" title="Açılamadı" text={q.error?.message ?? ""} />;
  if (open) return <PersonCard id={open} onClose={() => setOpen(null)} />;

  const needle = search.trim().toLocaleLowerCase("tr-TR");
  const stores = q.data.stores
    .filter((s) => !brand || s.brand === brand)
    .map((s) => ({ ...s, people: needle ? s.people.filter((p) => p.name.toLocaleLowerCase("tr-TR").includes(needle)) : s.people }))
    .filter((s) => s.people.length > 0);
  const everyone = stores.flatMap((s) => s.people);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Personel</h1>
        <p className="text-sm text-muted-foreground">
          {everyone.length} kişi · {stores.length} mağaza
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat icon={<Palmtree className="h-4 w-4" />} label="Bugün izinde" value={everyone.filter((p) => p.onLeaveToday).length} cls="bg-emerald-50 text-emerald-900" />
        <Stat icon={<CalendarHeart className="h-4 w-4" />} label="Hak günü açık" value={everyone.filter((p) => p.lieuOpen > 0).length} cls="bg-amber-50 text-amber-900" />
        <Stat icon={<Hourglass className="h-4 w-4" />} label="Bekleyen talep" value={everyone.reduce((a, p) => a + p.pending, 0)} cls="bg-slate-100 text-slate-800" />
      </div>

      <div className="space-y-2">
        <label className="flex h-11 items-center gap-2 rounded-xl border bg-white px-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input className="flex-1 bg-transparent text-base outline-none" placeholder="İsimle ara" value={search} onChange={(e) => setSearch(e.target.value)} />
          {search && (
            <button type="button" onClick={() => setSearch("")} aria-label="Temizle">
              <X className="h-4 w-4" />
            </button>
          )}
        </label>
        {brands.length > 1 && (
          <div className="flex gap-1.5">
            {[null, ...brands].map((b) => (
              <button
                key={b ?? "all"}
                type="button"
                onClick={() => setBrand(b)}
                className={cn("rounded-full px-3.5 py-1.5 text-sm font-medium", brand === b ? "bg-slate-900 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200")}
              >
                {b ?? "Tümü"}
              </button>
            ))}
          </div>
        )}
      </div>

      {stores.length === 0 && <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">Kimse bulunamadı.</p>}

      {stores.map((s) => (
        <details key={s.id} open className="group overflow-hidden rounded-2xl border bg-white">
          <summary className="flex cursor-pointer list-none items-center gap-2 bg-slate-50 px-4 py-3">
            <ChevronRight className="h-4 w-4 transition group-open:rotate-90" />
            <span className="font-semibold">
              {s.brand} · {s.store}
            </span>
            <span className="text-sm text-muted-foreground">{s.people.length} kişi</span>
            <span className="ml-auto flex gap-1">
              {s.people.some((p) => p.onLeaveToday) && <Chip cls="bg-emerald-100 text-emerald-800">{s.people.filter((p) => p.onLeaveToday).length} izinde</Chip>}
              {s.people.some((p) => p.lieuTone === "red") && <Chip cls="bg-red-100 text-red-800">hak günü!</Chip>}
            </span>
          </summary>
          <ul className="divide-y">
            {s.people.map((p) => (
              <PersonRow key={p.id} p={p} onOpen={() => setOpen(p.id)} />
            ))}
          </ul>
        </details>
      ))}
    </div>
  );
}

function Stat({ icon, label, value, cls }: { icon: React.ReactNode; label: string; value: number; cls: string }) {
  return (
    <div className={cn("rounded-2xl p-3", cls)}>
      <div className="flex items-center justify-center gap-1 text-xs font-medium opacity-80">
        {icon}
        {label}
      </div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}

const Chip = ({ cls, children }: { cls: string; children: React.ReactNode }) => (
  <span className={cn("whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", cls)}>{children}</span>
);

function PersonRow({ p, onOpen }: { p: Person; onOpen: () => void }) {
  return (
    <li>
      <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50">
        <Avatar name={p.name} small />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">
            {p.name}
            {p.manager && <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-xs font-normal">Müdür</span>}
          </div>
          <div className="truncate text-sm text-muted-foreground">{p.position}</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {p.onLeaveToday && <Chip cls="bg-emerald-100 text-emerald-800">🌴 {LEAVE_SHORT[p.onLeaveToday] ?? "İzinde"}</Chip>}
            {p.lieuOpen > 0 && (
              <Chip cls={p.lieuTone === "red" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}>{p.lieuOpen} hak günü açık</Chip>
            )}
            {p.pending > 0 && <Chip cls="bg-slate-100 text-slate-700">{p.pending} bekleyen</Chip>}
            {!p.hasAccount && <Chip cls="bg-white text-slate-500 ring-1 ring-slate-200">hesap yok</Chip>}
          </div>
        </div>
        <div className="text-right text-sm">
          <div className="font-semibold">{p.annualWhole === null ? "—" : `${p.annualWhole} gün`}</div>
          <div className="text-xs text-muted-foreground">yıllık izin</div>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>
    </li>
  );
}
