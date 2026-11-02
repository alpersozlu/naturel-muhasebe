/**
 * BEKLEYEN BELGELER — ayın primi için mağaza mağaza neyin geldiği, neyin
 * beklendiği (sahibi, 02.11.2026: "bekledigimiz belgeler hakkinda bir sisteme
 * baglayalim"). Saf hesap: dönem görünümü + performans belgeleri girer,
 * kontrol listesi ve gönderilebilir "eksikler" metni çıkar.
 *
 * Mavi: BI raporunun satış sayfası (Net TL, UPT, tekli) ve kategori sayfası
 * (adet), Personel KPI (denim), günlük bayi dosyaları (bağımsız kişi cirosu).
 * IT POS raporu isteğe bağlıdır (BI varken mağaza cirosu BI'dan gelir).
 * Derimod: belge yok — ciro Nebim'den gelir; yalnız hedefler beklenir.
 * Mağaza hedefi müdürü / müdür yardımcısı olan mağazada, kişisel hedef her
 * satış asistanında beklenir. Ayrılan (left) ve bu ay çalışmayan (inactive)
 * personel listeye girmez.
 */

export type PendingLine = {
  full_name: string;
  commission_profile: string;
  employee_status: "active" | "inactive" | "left";
  own_target: number | null;
};

export type PendingStore = {
  store_id: string;
  store_name: string;
  is_mavi: boolean;
  revenue: number | null;
  target: number | null;
  lines: PendingLine[];
};

export type PendingPerf = {
  store_id: string;
  docs: Array<{ kind: string; file_name: string; pages?: { sales: boolean; category: boolean } | null }>;
  /** days_missing: ISO tarihler (YYYY-MM-DD) */
  daily: { days_expected: number; days_present: number; days_missing: string[] } | null;
};

export type PendingItem = {
  key: "bi_sales" | "bi_category" | "kpi" | "itpos" | "daily" | "nebim" | "store_target" | "person_targets";
  label: string;
  /** ok = geldi · missing = bekleniyor · partial = kısmen · optional = isteğe bağlı, gelmedi */
  status: "ok" | "missing" | "partial" | "optional";
  detail: string | null;
};

export type PendingStoreResult = {
  store_id: string;
  store_name: string;
  is_mavi: boolean;
  items: PendingItem[];
  /** Bekleyen (missing + partial) kalem sayısı; isteğe bağlılar sayılmaz. */
  open: number;
};

const STORE_TARGET_PROFILES = new Set(["mavi_mudur", "mavi_vice", "deri_mudur"]);
const PERSON_TARGET_PROFILES = new Set(["mavi_asistan", "deri_asistan"]);

const dayRange = (days: string[]): string => {
  // ISO günler ["2026-10-01","2026-10-02","2026-10-03","2026-10-05"] → "1–3, 5"
  const n = days.map((x) => Number(x.slice(8, 10))).filter(Number.isFinite).sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < n.length; ) {
    let j = i;
    while (j + 1 < n.length && n[j + 1] === n[j]! + 1) j++;
    out.push(i === j ? `${n[i]}` : `${n[i]}–${n[j]}`);
    i = j + 1;
  }
  return out.join(", ");
};

export function pendingFor(stores: PendingStore[], perf: PendingPerf[]): PendingStoreResult[] {
  return stores.map((s) => {
    const items: PendingItem[] = [];
    const working = s.lines.filter((l) => l.employee_status === "active");
    if (s.is_mavi) {
      const p = perf.find((x) => x.store_id === s.store_id);
      const docs = p?.docs ?? [];
      const bi = docs.filter((d) => d.kind === "bi_pdf");
      const biSales = bi.some((d) => d.pages?.sales ?? true);
      const biCategory = bi.some((d) => d.pages?.category ?? true);
      items.push({ key: "bi_sales", label: "BI raporu — satış sayfası", status: biSales ? "ok" : "missing", detail: biSales ? null : "Net TL, UPT, tekli işlem" });
      items.push({ key: "bi_category", label: "BI raporu — kategori sayfası", status: biCategory ? "ok" : "missing", detail: biCategory ? null : "kategori adetleri" });
      const kpi = docs.some((d) => d.kind === "kpi_xlsx");
      items.push({ key: "kpi", label: "Personel KPI", status: kpi ? "ok" : "missing", detail: kpi ? null : "erkek / kadın denim" });
      const itpos = docs.some((d) => d.kind === "itpos_kpi" || d.kind === "itpos_reps");
      items.push({ key: "itpos", label: "IT POS Performans", status: itpos ? "ok" : "optional", detail: itpos ? null : "isteğe bağlı" });
      const d = p?.daily ?? null;
      if (!d || d.days_present === 0) {
        items.push({ key: "daily", label: "Günlük bayi dosyaları", status: "missing", detail: "hiç yüklenmedi" });
      } else if (d.days_missing.length > 0) {
        items.push({
          key: "daily",
          label: "Günlük bayi dosyaları",
          status: "partial",
          detail: `${d.days_present} / ${d.days_expected} gün · eksik: ${dayRange(d.days_missing)}`,
        });
      } else {
        items.push({ key: "daily", label: "Günlük bayi dosyaları", status: "ok", detail: `${d.days_present} / ${d.days_expected} gün` });
      }
    } else {
      const has = s.revenue != null && s.revenue > 0;
      items.push({ key: "nebim", label: "Ciro (Nebim)", status: has ? "ok" : "missing", detail: has ? null : '"Derimod cirolarını Nebim\'den al"' });
    }
    if (working.some((l) => STORE_TARGET_PROFILES.has(l.commission_profile))) {
      const ok = s.target != null && s.target > 0;
      items.push({ key: "store_target", label: "Mağaza hedefi", status: ok ? "ok" : "missing", detail: null });
    }
    const needs = working.filter((l) => PERSON_TARGET_PROFILES.has(l.commission_profile));
    if (needs.length > 0) {
      const without = needs.filter((l) => !(l.own_target != null && l.own_target > 0));
      items.push({
        key: "person_targets",
        label: "Kişisel hedefler",
        status: without.length === 0 ? "ok" : without.length === needs.length ? "missing" : "partial",
        detail: without.length === 0 ? `${needs.length} / ${needs.length} kişi` : `${needs.length - without.length} / ${needs.length} kişi · bekleyen: ${without.map((l) => l.full_name).join(", ")}`,
      });
    }
    const open = items.filter((i) => i.status === "missing" || i.status === "partial").length;
    return { store_id: s.store_id, store_name: s.store_name, is_mavi: s.is_mavi, items, open };
  });
}

/** Mert'e / mağazalara gönderilecek düz metin — yalnız bekleyenler. */
export function pendingText(periodLabel: string, rows: PendingStoreResult[]): string {
  const open = rows.filter((r) => r.open > 0);
  if (open.length === 0) return `${periodLabel} primi için bekleyen belge yok.`;
  const lines = [`${periodLabel} primi için bekleyenler:`];
  for (const r of open) {
    lines.push("", `${r.store_name}:`);
    for (const i of r.items) {
      if (i.status !== "missing" && i.status !== "partial") continue;
      lines.push(`- ${i.label}${i.detail ? ` (${i.detail})` : ""}`);
    }
  }
  return lines.join("\n");
}
