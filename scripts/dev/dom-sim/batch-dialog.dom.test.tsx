// TEMPORARY, NOT COMMITTED: drives the real BatchDialog in a simulated browser (jsdom lives in the session
// scratchpad, not in this project) to check the store-by-store flow that cannot be opened without a login.
import { createRequire } from "node:module";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const SCRATCH = "/private/tmp/claude-501/-Users-alpersozlu/88a06dc9-7bb2-4c5f-935d-dcc9ad5dd828/scratchpad/domtest/node_modules/jsdom";

const h = vi.hoisted(() => ({
  rows: [] as any[],
  prepareCalls: [] as any[],
  createCalls: [] as any[],
  failNext: false,
  toastSuccess: [] as string[],
  toastError: [] as string[],
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    payroll: {
      batches: {
        prepare: {
          useMutation: (opts: any) => ({
            mutate: (vars: any) => {
              h.prepareCalls.push(vars);
              setTimeout(() => opts.onSuccess({ id: vars.period_id, rows: h.rows }), 0);
            },
            isError: false,
            error: null,
            isPending: false,
          }),
        },
        create: {
          useMutation: (opts: any) => {
            const run = async (vars: any) => {
              h.createCalls.push(vars);
              if (h.failNext) {
                h.failNext = false;
                const e = new Error("Sunucu hatası");
                opts?.onError?.(e);
                throw e;
              }
              const total = Math.round(vars.items.reduce((s: number, i: any) => s + i.amount, 0) * 100) / 100;
              return { id: `batch-${h.createCalls.length}`, file_name: null, file_base64: null, total, count: vars.items.length };
            };
            return {
              mutate: (vars: any) => {
                run(vars).then((r) => opts?.onSuccess?.(r)).catch(() => {});
              },
              mutateAsync: run,
              isPending: false,
            };
          },
        },
      },
    },
  },
}));
vi.mock("sonner", () => ({ toast: { success: (m: string) => h.toastSuccess.push(m), error: (m: string) => h.toastError.push(m) } }));
vi.mock("@/components/ui/dialog", () => {
  const pass = (tag: string) => (p: any) => {
    const React = require("react");
    return React.createElement(tag, { "data-part": p["data-part"] }, p.children);
  };
  return {
    Dialog: pass("div"),
    DialogContent: pass("div"),
    DialogHeader: pass("div"),
    DialogTitle: pass("h2"),
    DialogDescription: pass("p"),
    DialogFooter: (p: any) => {
      const React = require("react");
      return React.createElement("footer", null, p.children);
    },
  };
});

const row = (line_id: string, full_name: string, store_name: string, due: number, pending_note: string | null = null) => ({
  line_id,
  full_name,
  bank_name: full_name,
  store_name,
  base: 61_677,
  advances: 0,
  extras: due,
  deductions: 0,
  net_remaining: due,
  due,
  has_bank_details: true,
  note: null,
  for_next_month: false,
  pending_prepared: pending_note ? due : 0,
  pending_note,
});
const PENDING = "Hazırlanmış, gönderilmemiş Garanti talimatı var: 10.000,00 ₺.";
const SEPT = [
  row("g1", "Adile Yılmaz Gülderen", "Mavi Girne", 10_142.52),
  row("g2", "Emre Atılgan", "Mavi Girne", 21_452.45),
  row("l1", "Sonuç Baloğlu", "Mavi Lefkosa", 8_537.4),
  row("l2", "Hakan Kokur", "Mavi Lefkosa", 10_000, PENDING),
  row("m1", "Vedat Sönmez", "DERIMOD MAGUSA", 3_196.64),
];

let act: (cb: () => unknown) => Promise<void>;
let createRoot: any;
let React: any;
let BatchDialog: any;
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 5)); });
const all = (sel: string) => Array.from(document.querySelectorAll(sel)) as HTMLElement[];
const text = () => (document.body.textContent ?? "").replace(/\s+/g, " ");
const buttons = (t: string) => all("button").filter((b) => (b.textContent ?? "").includes(t)) as HTMLButtonElement[];
const tr = (t: string) => all("tbody tr").find((x) => (x.textContent ?? "").includes(t))!;
const click = async (el: HTMLElement) => { await act(async () => { el.click(); }); await flush(); };

async function open(choice: { kind: string; channel: string }, rows: any[]) {
  h.rows = rows;
  document.body.innerHTML = '<div id="root"></div>';
  const onCreated = vi.fn();
  const onClose = vi.fn();
  const root = createRoot(document.getElementById("root"));
  await act(async () => {
    root.render(React.createElement(BatchDialog, { periodId: "11111111-1111-4111-8111-111111111111", periodLabel: "Eylül 2026", choice, onClose, onCreated }));
  });
  await flush();
  return { onCreated, onClose, root };
}

beforeAll(async () => {
  const { JSDOM } = createRequire(import.meta.url)(SCRATCH);
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/", pretendToBeVisual: true });
  const g = globalThis as any;
  g.window = dom.window;
  g.document = dom.window.document;
  for (const k of ["navigator", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "Element", "Node", "Event", "MouseEvent", "KeyboardEvent", "MutationObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "DocumentFragment", "CustomEvent"]) {
    try { Object.defineProperty(g, k, { value: (dom.window as any)[k], configurable: true, writable: true }); } catch { /* read-only global */ }
  }
  g.IS_REACT_ACT_ENVIRONMENT = true;
  React = await import("react");
  act = React.act;
  ({ createRoot } = await import("react-dom/client"));
  ({ BatchDialog } = await import("@/components/payroll/batch-dialog"));
});
beforeEach(() => {
  h.prepareCalls.length = 0;
  h.createCalls.length = 0;
  h.toastSuccess.length = 0;
  h.toastError.length = 0;
  h.failNext = false;
});

describe("Ödeme 2 nakit penceresi — mağaza mağaza (benzetim)", () => {
  it("tam akış: mağaza düğmesi yalnız o mağazayı kaydeder, satırlar kalkar, uyarılı kişi seçili gelmez", async () => {
    const { onCreated } = await open({ kind: "payment2", channel: "cash" }, SEPT.map((r) => ({ ...r })));
    expect(h.prepareCalls).toEqual([{ period_id: "11111111-1111-4111-8111-111111111111", kind: "payment2", channel: "cash" }]);

    // three stores, a button each, in list order
    expect(buttons("Bu mağaza ödendi")).toHaveLength(3);
    const heads = all("tbody tr").filter((x) => x.querySelector("button"));
    expect(heads.map((x) => x.querySelector("span")!.textContent)).toEqual(["Mavi Girne", "Mavi Lefkosa", "DERIMOD MAGUSA"]);
    expect(tr("Bu mağaza ödendi").textContent).toContain("2 kişi · 31.594,97 ₺");
    expect(heads[1].textContent).toContain("1 kişi · 8.537,40 ₺"); // Hakan not ticked
    expect((tr("Hakan Kokur").querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(false);
    expect(tr("Hakan Kokur").textContent).toContain(PENDING);
    expect(text()).toContain("ödenecek 4 kişi · 43.329,01 ₺");
    expect(buttons("Seçili herkesi ödendi olarak işle")).toHaveLength(1);
    expect(buttons("Vazgeç")).toHaveLength(1);

    // pay Girne
    await click(heads[0].querySelector("button")!);
    expect(h.createCalls).toHaveLength(1);
    expect(h.createCalls[0]).toMatchObject({ kind: "payment2", channel: "cash", mark_sent: true });
    expect(h.createCalls[0].pay_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(h.createCalls[0].items).toEqual([{ line_id: "g1", amount: 10_142.52 }, { line_id: "g2", amount: 21_452.45 }]);
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(text()).not.toContain("Adile Yılmaz Gülderen");
    expect(text()).not.toContain("Emre Atılgan");
    expect(text()).toContain("ödendi olarak işlendi: 2 kişi · 31.594,97 ₺");
    expect(text()).toContain("ödenecek 2 kişi · 11.734,04 ₺");
    expect(text()).toContain("işlenen 2 kişi · 31.594,97 ₺");
    expect(buttons("Bu mağaza ödendi")).toHaveLength(2);
    expect(buttons("Kapat")).toHaveLength(1); // no longer "Vazgeç": something was recorded
    expect(h.toastSuccess.at(-1)).toBe("Mavi Girne: 2 kişi · 31.594,97 ₺ — ödendi olarak işlendi");

    // a failing save leaves the store as it was
    h.failNext = true;
    await click(tr("DERIMOD MAGUSA").querySelector("button")!);
    expect(h.createCalls).toHaveLength(2);
    expect(h.toastError).toEqual(["Sunucu hatası"]);
    expect(text()).toContain("Vedat Sönmez");
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(tr("DERIMOD MAGUSA").textContent).toContain("Bu mağaza ödendi");
    expect((tr("DERIMOD MAGUSA").querySelector("button") as HTMLButtonElement).disabled).toBe(false);

    // retry works
    await click(tr("DERIMOD MAGUSA").querySelector("button")!);
    expect(h.createCalls[2].items).toEqual([{ line_id: "m1", amount: 3_196.64 }]);
    expect(text()).not.toContain("Vedat Sönmez");
    expect(onCreated).toHaveBeenCalledTimes(2);

    // Lefkoşa: only the ticked person is recorded, the warned one stays
    await click(all("tbody tr").filter((x) => x.querySelector("button")).find((x) => x.textContent!.includes("Mavi Lefkosa"))!.querySelector("button")!);
    expect(h.createCalls[3].items).toEqual([{ line_id: "l1", amount: 8_537.4 }]);
    expect(text()).toContain("Hakan Kokur");
    expect(text()).not.toContain("Sonuç Baloğlu");
    const lef = all("tbody tr").find((x) => x.textContent!.includes("Mavi Lefkosa") && x.querySelector("button"))!;
    expect(lef.textContent).toContain("0 kişi · 0,00 ₺");
    expect(lef.textContent).toContain("ödendi olarak işlendi: 1 kişi · 8.537,40 ₺");
    expect((lef.querySelector("button") as HTMLButtonElement).disabled).toBe(true);
    expect((buttons("Seçili herkesi ödendi olarak işle")[0] as HTMLButtonElement).disabled).toBe(true);

    // tick Hakan deliberately, then the store button records him
    await click(tr("Hakan Kokur").querySelector('input[type="checkbox"]') as HTMLElement);
    const lef2 = all("tbody tr").find((x) => x.textContent!.includes("Mavi Lefkosa") && x.querySelector("button"))!;
    expect(lef2.textContent).toContain("1 kişi · 10.000,00 ₺");
    expect((lef2.querySelector("button") as HTMLButtonElement).disabled).toBe(false);
    await click(lef2.querySelector("button")!);
    expect(h.createCalls[4].items).toEqual([{ line_id: "l2", amount: 10_000 }]);

    // everything recorded
    expect(all("table")).toHaveLength(0);
    expect(text()).toContain("Listedeki herkes ödendi olarak işlendi");
    expect(text()).toContain("5 kişi · toplam 53.329,01 ₺");
    expect(text()).toContain("Mavi Girne: 2 kişi · 31.594,97 ₺");
    expect(text()).toContain("Mavi Lefkosa: 2 kişi · 18.537,40 ₺");
    expect(text()).toContain("DERIMOD MAGUSA: 1 kişi · 3.196,64 ₺");
    expect(buttons("Seçili herkesi")).toHaveLength(0);
    expect(buttons("Kapat")).toHaveLength(1);
    expect(onCreated).toHaveBeenCalledTimes(4);
    // every person recorded exactly once
    expect(h.createCalls.filter((_, i) => i !== 1).flatMap((c) => c.items.map((i: any) => i.line_id)).sort()).toEqual(["g1", "g2", "l1", "l2", "m1"]);
  });

  it("mağaza seçim kutusu o mağazanın herkesini seçer / bırakır; tek düğmeyle hepsi de işlenir", async () => {
    await open({ kind: "payment2", channel: "cash" }, SEPT.map((r) => ({ ...r })));
    const girne = all("tbody tr").filter((x) => x.querySelector("button"))[0];
    await click(girne.querySelector('input[type="checkbox"]') as HTMLElement); // untick Girne
    expect(all("tbody tr").filter((x) => x.querySelector("button"))[0].textContent).toContain("0 kişi · 0,00 ₺");
    expect(text()).toContain("ödenecek 2 kişi · 11.734,04 ₺");
    await click(all("tbody tr").filter((x) => x.querySelector("button"))[0].querySelector('input[type="checkbox"]') as HTMLElement); // tick again
    expect(text()).toContain("ödenecek 4 kişi · 43.329,01 ₺");

    await click(buttons("Seçili herkesi ödendi olarak işle")[0]);
    expect(h.createCalls).toHaveLength(1);
    expect(h.createCalls[0].items.map((i: any) => i.line_id)).toEqual(["g1", "g2", "l1", "m1"]);
    expect(h.createCalls[0]).toMatchObject({ kind: "payment2", channel: "cash", mark_sent: true });
    expect(text()).toContain("Ödendi olarak işlendi");
    expect(text()).toContain("4 kişi · toplam 43.329,01 ₺");
  });

  it("Ödeme 1 nakit: mağaza düğmesi yok, eski düzen (rozetler + tek düğme)", async () => {
    await open({ kind: "payment1", channel: "cash" }, [row("a", "Şükran Ubuz", "Mavi Girne", 61_677), row("b", "Batuhan Kuru", "Mavi Lefkosa", 42_109)]);
    expect(buttons("Bu mağaza ödendi")).toHaveLength(0);
    expect(text()).toContain("Mavi Girne: 1 kişi · 61.677,00 ₺");
    expect(text()).toContain("Mavi Lefkosa: 1 kişi · 42.109,00 ₺");
    expect(text()).toContain("2 kişi · 103.786,00 ₺");
    expect(text()).not.toContain("ödenecek 2 kişi");
    expect(buttons("Ödendi olarak işle")).toHaveLength(1);
    await click(buttons("Ödendi olarak işle")[0]);
    expect(h.createCalls[0]).toMatchObject({ kind: "payment1", channel: "cash", mark_sent: true });
    expect(h.createCalls[0].items).toHaveLength(2);
  });

  it("Garanti: mağaza düğmesi ve rozet yok, dosya düğmesi var", async () => {
    await open({ kind: "payment1", channel: "garanti" }, [row("a", "Adile Yılmaz Gülderen", "Mavi Girne", 61_677), row("b", "Sonuç Baloğlu", "Mavi Lefkosa", 80_000)]);
    expect(buttons("Bu mağaza ödendi")).toHaveLength(0);
    expect(text()).not.toContain("Mavi Girne: 1 kişi");
    expect(buttons("Dosyayı oluştur ve indir")).toHaveLength(1);
    expect(all("tbody tr")).toHaveLength(2);
  });

  it("boş liste: 'Ödeme 2'si bekleyen kimse yok' ve kayıt düğmesi yok", async () => {
    await open({ kind: "payment2", channel: "cash" }, []);
    expect(text()).toContain("Ödeme 2'si bekleyen kimse yok.");
    expect(buttons("Seçili herkesi")).toHaveLength(0);
    expect(buttons("Vazgeç")).toHaveLength(1);
  });
});
