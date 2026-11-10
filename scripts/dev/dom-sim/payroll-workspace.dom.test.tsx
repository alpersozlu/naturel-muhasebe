// GEÇİCİ, commit EDİLMEZ: yeni Maaşlar sayfasını jsdom'da gerçek veriyle sürer (giriş gerektiren ekran).
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const SP = "/SCRATCH"; // oturumun scratchpad klasörü: vpreview/data.json (Ekim görünümü dökümü) + domtest/node_modules/jsdom
const DATA = JSON.parse(readFileSync(`${SP}/vpreview/data.json`, "utf8"));
const calls = vi.hoisted(() => ({ list: [] as Array<{ path: string; vars: any }>, confirm: [] as any[] }));

vi.mock("@/lib/trpc", () => {
  const dataFor = (path: string) =>
    path === "payroll.periods.list" ? DATA.periods : path === "payroll.periods.get" ? DATA[10].view : path === "payroll.performance.get" ? DATA[10].perf : path === "payroll.cashAdvances.suggest" || path === "payroll.loans.list" || path === "payroll.stores" ? [] : undefined;
  const make = (path: string[]): any =>
    new Proxy(function () {}, {
      get(_t, k) {
        const p = path.join(".");
        if (k === "useQuery") return () => ({ data: dataFor(p), isLoading: false, isFetching: false, isError: false, error: null, refetch: async () => {} });
        if (k === "useMutation")
          return (opts: any) => {
            const run = async (vars: any) => {
              calls.list.push({ path: p, vars });
              const r = { id: vars?.id ?? "x", amount: 0, to_label: "Kasım 2026", count: 0, total: 0, added: 0 };
              opts?.onSuccess?.(r, vars);
              return r;
            };
            return { mutate: (v: any) => void run(v), mutateAsync: run, isPending: false };
          };
        if (k === "useUtils") return () => make(["utils"]);
        return make([...path, String(k)]);
      },
      apply() {
        return undefined;
      },
    });
  return { trpc: make([]) };
});
vi.mock("sonner", () => ({ toast: { success() {}, error() {}, warning() {}, info() {} } }));
vi.mock("@/components/ui/confirm-dialog", () => ({ useConfirm: () => async (o: any) => (calls.confirm.push(o), true) }));
vi.mock("@/i18n/navigation", async () => {
  const React = await import("react");
  return { Link: ({ href, children, ...p }: any) => React.createElement("a", { href, ...p }, children) };
});

let React: any, act: any, createRoot: any;
let root: any, host: HTMLElement;
const text = () => (document.body.innerHTML ?? "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
const q = (sel: string) => Array.from(document.body.querySelectorAll(sel)) as HTMLElement[];
const byText = (sel: string, t: string) => q(sel).find((e) => (e.textContent ?? "").replace(/\s+/g, " ").trim().includes(t));
const click = async (el: HTMLElement | undefined) => {
  if (!el) throw new Error("öğe yok");
  await act(async () => {
    el.dispatchEvent(new (window as any).MouseEvent("pointerdown", { bubbles: true }));
    el.dispatchEvent(new (window as any).MouseEvent("click", { bubbles: true }));
  });
};
const type = async (el: HTMLInputElement | undefined, value: string) => {
  if (!el) throw new Error("alan yok");
  const setter = Object.getOwnPropertyDescriptor((window as any).HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new (window as any).Event("input", { bubbles: true }));
  });
};
const mount = async (node: any) => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(node));
  await act(async () => {});
};
const find = (name: string) => {
  for (const s of DATA[10].view.stores) for (const l of s.lines) if (l.full_name.includes(name)) return { line: l, store: s };
  throw new Error("yok " + name);
};
const noop = () => {};

describe("yeni Maaşlar sayfası (jsdom)", () => {
  beforeAll(async () => {
    const { JSDOM } = createRequire(import.meta.url)(`${SP}/domtest/node_modules/jsdom`);
    const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/", pretendToBeVisual: true });
    const g = globalThis as any;
    g.window = dom.window;
    g.document = dom.window.document;
    for (const k of ["navigator", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "Element", "Node", "Event", "MouseEvent", "KeyboardEvent", "MutationObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "DocumentFragment", "CustomEvent", "NodeFilter"]) {
      try { Object.defineProperty(g, k, { value: (dom.window as any)[k], configurable: true, writable: true }); } catch { /* salt okunur */ }
    }
    g.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    (dom.window as any).ResizeObserver = g.ResizeObserver;
    (dom.window as any).HTMLElement.prototype.scrollIntoView = () => {};
    (dom.window as any).HTMLElement.prototype.hasPointerCapture = () => false;
    (dom.window as any).HTMLElement.prototype.releasePointerCapture = () => {};
    g.IS_REACT_ACT_ENVIRONMENT = true;
    React = await import("react");
    act = React.act;
    ({ createRoot } = await import("react-dom/client"));
  });
  beforeEach(async () => {
    if (root) await act(async () => root.unmount());
    document.body.innerHTML = "";
    calls.list.length = 0;
    calls.confirm.length = 0;
  });

  it("kişi paneli: mesai yazınca hesap güncellenir, Kaydet yalnız değişen alanı gönderir", async () => {
    const { PersonSheet } = await import("@/components/payroll/v2/person-sheet");
    const { line, store } = find("Emre At");
    await mount(React.createElement(PersonSheet, { line, store, period: DATA[10].view.period, closed: false, nextLabel: "Kasım 2026", onClose: noop, onChanged: noop }));
    expect(text()).toContain("Emre Atılgan");
    expect(text()).toContain("Maaş — Ödeme 1");
    const save = byText("button", "Kaydet") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await type(q('input[aria-label="Mesai saati"]')[0] as HTMLInputElement, "4");
    expect(text()).toContain("1.186,10"); // 4 saat × (61.677 ÷ 208)
    expect(text()).toContain("Mesai (4 saat)");
    expect(text()).toContain("Kaydedilmemiş değişiklik");
    expect((byText("button", "Kaydet") as HTMLButtonElement).disabled).toBe(false);
    await click(byText("button", "Kaydet"));
    const u = calls.list.find((c) => c.path === "payroll.lines.update")!;
    expect(Object.keys(u.vars).filter((k) => u.vars[k] !== undefined).sort()).toEqual(["id", "overtime_hours"]);
    expect(u.vars).toMatchObject({ id: line.id, overtime_hours: 4 });
  });

  it("kişi paneli: Kesinti düğmesi kayıt penceresini açar; iptal nedeni yazılmadan iptal edilemez", async () => {
    const { PersonSheet } = await import("@/components/payroll/v2/person-sheet");
    const { line, store } = find("Halit Ozan");
    await mount(React.createElement(PersonSheet, { line, store, period: DATA[10].view.period, closed: false, nextLabel: "Kasım 2026", onClose: noop, onChanged: noop }));
    expect(text()).toContain("Kasım 2026 maaşına devredildi");
    expect(text()).toContain("Fiyat farkı");
    await click(byText("button", "İptal et"));
    expect(text()).toContain("Bu bir devir kaydı");
    const confirmBtn = q("button").filter((b) => b.textContent?.trim() === "İptal et" && b.className.includes("destructive"))[0] as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(true);
    await type(q('input[aria-label="İptal nedeni"]')[0] as HTMLInputElement, "yanlış girildi");
    await click(q("button").filter((b) => b.textContent?.trim() === "İptal et" && b.className.includes("destructive"))[0]);
    expect(calls.list.find((c) => c.path === "payroll.entries.void")!.vars.note).toBe("yanlış girildi");
    await click(q("button").find((b) => b.textContent?.trim() === "Kesinti"));
    expect(text()).toContain("Kesinti — Halit Ozan Koçoğlu");
  });

  it("kapalı ayda panel salt okunur", async () => {
    const { PersonSheet } = await import("@/components/payroll/v2/person-sheet");
    const { line, store } = find("Emre At");
    await mount(React.createElement(PersonSheet, { line, store, period: DATA[10].view.period, closed: true, nextLabel: "Kasım 2026", onClose: noop, onChanged: noop }));
    expect((q('input[aria-label="Mesai saati"]')[0] as HTMLInputElement).disabled).toBe(true);
    expect(text()).toContain("Kapalı ay: değişiklik yapılamaz");
    expect(q("button").some((b) => b.textContent?.trim() === "İptal et")).toBe(false);
  });

  it("prim adımı: satır kişiyi açar; toplu kesinti seçili herkese ayrı kayıt yazar", async () => {
    const { StepExtras } = await import("@/components/payroll/v2/step-extras");
    const opened: string[] = [];
    await mount(React.createElement(StepExtras, { data: DATA[10].view, closed: false, kolay: { data: undefined, loading: false, error: null, refetch: noop }, onOpenLine: (id: string) => opened.push(id), onBatch: noop, onChanged: noop }));
    const { line } = find("Enes Demir");
    await click(byText("tr", "Enes Demir"));
    expect(opened).toEqual([line.id]);

    await click(byText("button", "Toplu kesinti / ekleme"));
    expect(text()).toContain("Toplu kesinti / ekleme · Ekim 2026");
    const magusa = DATA[10].view.stores.find((s: any) => s.store_name === "Mavi Magusa");
    const active = magusa.lines.filter((l: any) => l.employee_status !== "inactive");
    const storeBox = byText("label", "Mavi Magusa")!.querySelector("input") as HTMLInputElement;
    await click(storeBox);
    expect(text()).toContain(`${active.length} / ${active.length} seçili`);
    await type(document.getElementById("bulk-amount") as HTMLInputElement, "720");
    await type(document.getElementById("bulk-note") as HTMLInputElement, "Etiket farkı deneme");
    expect(text()).toContain(`${active.length} kişi · toplam`);
    await click(byText("button", `${active.length} kişiden kes`));
    await act(async () => {});
    const created = calls.list.filter((c) => c.path === "payroll.entries.create");
    expect(created.length).toBe(active.length);
    expect(created.every((c) => c.vars.kind === "deduction" && c.vars.category === "price_difference" && c.vars.amount === 720 && c.vars.note === "Etiket farkı deneme")).toBe(true);
    expect(new Set(created.map((c) => c.vars.line_id))).toEqual(new Set(active.map((l: any) => l.id)));
  });

  it("ciro ve hedefler: hedef değişince yalnız o kişinin hedefi gider", async () => {
    const { StoreTargetsDialog } = await import("@/components/payroll/v2/store-targets-dialog");
    const store = DATA[10].view.stores[0];
    await mount(React.createElement(StoreTargetsDialog, { store, periodId: DATA[10].view.period.id, periodLabel: "Ekim 2026", closed: false, onClose: noop, onChanged: noop }));
    expect(text()).toContain("Ciro ve hedefler · Mavi Girne");
    await type(q('input[aria-label="Enes Demir hedefi"]')[0] as HTMLInputElement, "2.000.000");
    expect(text()).toContain("1 değişiklik kaydedilmedi");
    await click(byText("button", "Kaydet"));
    await act(async () => {});
    const ups = calls.list.filter((c) => c.path === "payroll.lines.update");
    expect(ups.length).toBe(1);
    expect(Object.keys(ups[0]!.vars).filter((k) => ups[0]!.vars[k] !== undefined).sort()).toEqual(["id", "own_target"]);
    expect(ups[0]!.vars.own_target).toBe(2000000);
    expect(calls.list.some((c) => c.path === "payroll.storeMonth.upsert")).toBe(false);
  });

  it("ana sayfa: ayın geldiği adımda açılır, adımlar arasında geçilir, satırdan panel açılıp gezilir", async () => {
    const { PayrollWorkspace } = await import("@/components/payroll/v2/workspace");
    await mount(React.createElement(PayrollWorkspace));
    expect(text()).toContain("Ekim 2026");
    expect(text()).toContain("Herkesin kalanı sıfır. Ay kapatılabilir."); // Ekim: herkes kapandı → Kapanış
    await click(byText('nav[aria-label="Ayın adımları"] button', "Prim"));
    expect(text()).toContain("Prim — Ödeme 2");
    await click(byText('nav[aria-label="Ayın adımları"] button', "Maaş"));
    expect(text()).toContain("Maaş — Ödeme 1");
    expect(text()).toContain("tüm maaşlar ödendi");
    await click(byText('nav[aria-label="Ayın adımları"] button', "Avans"));
    expect(text()).toContain("Bu ay avans alanlar");
    await click(byText('nav[aria-label="Ayın adımları"] button', "Tüm tablo"));
    expect(text()).toContain("Ayın bütün kalemleri kişi kişi");
    await click(byText("tr", "Adile Yılmaz"));
    expect(q('[role="dialog"]').length).toBe(1);
    expect(q('[role="dialog"]')[0]!.textContent).toContain("Adile Yılmaz Gülderen");
    await click(q('button[aria-label="Sonraki kişi"]')[0]);
    expect(q('[role="dialog"]')[0]!.textContent).toContain("Emre Atılgan");
    expect((q('button[aria-label="Önceki kişi"]')[0] as HTMLButtonElement).disabled).toBe(false);
    await click(q('button[aria-label="Kapat"]')[0]);
    expect(q('[role="dialog"]').length).toBe(0);
  });
});
