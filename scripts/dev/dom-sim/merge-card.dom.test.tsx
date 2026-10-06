// TEMPORARY, NOT COMMITTED: drives the real "Kasa Birleşmesi" card in a simulated browser (jsdom lives in the
// session scratchpad) to check the new "this day has no summary — closes with the next day" flow.
import { createRequire } from "node:module";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const SCRATCH = "/private/tmp/claude-501/-Users-alpersozlu/88a06dc9-7bb2-4c5f-935d-dcc9ad5dd828/scratchpad/domtest/node_modules/jsdom";

const h = vi.hoisted(() => ({
  group: null as any,
  cumulativePrev: null as string | null,
  probe: (_input: any): any => ({ mode: "group", days: 2, prev_has_summary: false, blocker: null }),
  probeCalls: [] as any[],
  createCalls: [] as any[],
  cumulativeCalls: [] as any[],
  deleteCalls: [] as any[],
  toastSuccess: [] as string[],
  toastError: [] as string[],
  invalidations: 0,
}));

vi.mock("@/lib/trpc", () => {
  const inv = { invalidate: () => { h.invalidations++; } };
  const mutation = (calls: any[], result: () => any) => ({
    useMutation: (opts: any) => ({
      mutate: (vars: any) => { calls.push(vars); opts?.onSuccess?.(result(), vars); },
      isPending: false,
    }),
  });
  return {
    trpc: {
      useUtils: () => ({
        dailyRecord: { getCumulativePrev: inv, reconciliation: inv },
        mergeGroup: { getForStoreDate: inv, getOpenForStore: inv },
        upload: { listForStoreDate: inv },
      }),
      dailyRecord: {
        getCumulativePrev: { useQuery: () => ({ data: { prev_date: h.cumulativePrev }, isLoading: false }) },
        setCumulativePrev: mutation(h.cumulativeCalls, () => ({ ok: true })),
        clearCumulativePrev: mutation([], () => ({ ok: true })),
      },
      mergeGroup: {
        getForStoreDate: { useQuery: () => ({ data: h.group }) },
        probe: {
          useQuery: (input: any, opts: any) => {
            if (!opts?.enabled) return { data: undefined, isLoading: false };
            h.probeCalls.push(input);
            return { data: h.probe(input), isLoading: false };
          },
        },
        create: mutation(h.createCalls, () => ({ id: "g1" })),
        delete: mutation(h.deleteCalls, () => ({ ok: true })),
      },
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: (m: string) => h.toastSuccess.push(m), error: (m: string) => h.toastError.push(m) } }));
vi.mock("@/components/ui/confirm-dialog", () => ({ useConfirm: () => async () => true }));

let act: (cb: () => unknown) => Promise<void>;
let createRoot: any;
let React: any;
let Card: any;
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 5)); });
const all = (sel: string) => Array.from(document.querySelectorAll(sel)) as HTMLElement[];
const text = () => (document.body.textContent ?? "").replace(/\s+/g, " ");
const button = (t: string) => all("button").find((b) => (b.textContent ?? "").replace(/\s+/g, " ").includes(t)) as HTMLButtonElement;
const click = async (el: HTMLElement) => { await act(async () => { el.click(); }); await flush(); };
const type = async (el: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor((window as any).HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new (window as any).Event("input", { bubbles: true }));
    el.dispatchEvent(new (window as any).Event("change", { bubbles: true }));
  });
  await flush();
};
const STORE = "22222222-2222-4222-8222-222222222222";
async function open(date: string) {
  document.body.innerHTML = '<div id="root"></div>';
  const onJump = vi.fn();
  const root = createRoot(document.getElementById("root"));
  await act(async () => { root.render(React.createElement(Card, { storeId: STORE, date, onJump })); });
  await flush();
  return { onJump };
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
  Card = (await import("@/components/upload/cumulative-merge-card")).CumulativeMergeCard;
});
beforeEach(() => {
  h.group = null;
  h.cumulativePrev = null;
  h.probe = () => ({ mode: "group", days: 2, prev_has_summary: false, blocker: null });
  for (const k of ["probeCalls", "createCalls", "cumulativeCalls", "deleteCalls", "toastSuccess", "toastError"] as const) h[k].length = 0;
});

describe("Kasa Birleşmesi kartı — ilk günün sayfasından (benzetim)", () => {
  it("özeti olmayacak günün sayfasından ertesi günle birlikte kapanış kurulur", async () => {
    await open("2026-10-01");
    expect(button("Önceki günle birleşti")).toBeTruthy();
    expect(button("Bu günün özeti yok — ertesi günle kapanacak")).toBeTruthy();
    expect(h.probeCalls).toHaveLength(0); // nothing asked before the user chooses

    await click(button("Bu günün özeti yok — ertesi günle kapanacak"));
    const input = document.getElementById("next-date") as HTMLInputElement;
    expect(input.value).toBe("2026-10-02");
    expect(input.min).toBe("2026-10-02");
    expect(input.max).toBe("2026-10-03");
    expect(h.probeCalls.at(-1)).toEqual({ store_id: STORE, date: "2026-10-02", prev_date: "2026-10-01" });
    expect(text()).toContain("01 Ekim 2026 için mağaza özeti istenmez");
    expect(text()).toContain("2 gün birlikte kapatılır:");
    expect(text()).toContain("yalnız 02 Ekim gününe yüklenir");
    expect(button("Onayla").disabled).toBe(false);

    await click(button("Onayla"));
    expect(h.createCalls).toEqual([{ store_id: STORE, start_date: "2026-10-01", end_date: "2026-10-02" }]);
    expect(h.cumulativeCalls).toHaveLength(0);
    expect(h.toastSuccess).toEqual(["Günler birleştirildi — mağaza özeti ve bayi dosyası 02 Ekim gününe yüklenir"]);
  });

  it("üç gün: kapanış günü bir gün ileri alınabilir; geçersiz gün onaylanamaz", async () => {
    h.probe = (i) => ({ mode: "group", days: i.date === "2026-10-03" ? 3 : 2, prev_has_summary: false, blocker: null });
    await open("2026-10-01");
    await click(button("Bu günün özeti yok — ertesi günle kapanacak"));
    await type(document.getElementById("next-date") as HTMLInputElement, "2026-10-03");
    expect(h.probeCalls.at(-1)).toEqual({ store_id: STORE, date: "2026-10-03", prev_date: "2026-10-01" });
    expect(text()).toContain("3 gün birlikte kapatılır:");
    expect(text()).toContain("yalnız 03 Ekim gününe yüklenir");
    await type(document.getElementById("next-date") as HTMLInputElement, "2026-10-01");
    expect(text()).toContain("Kapanış günü bu günden SONRA olmalı.");
    expect(button("Onayla").disabled).toBe(true);
    await type(document.getElementById("next-date") as HTMLInputElement, "2026-10-03");
    await click(button("Onayla"));
    expect(h.createCalls).toEqual([{ store_id: STORE, start_date: "2026-10-01", end_date: "2026-10-03" }]);
  });

  it("bu günün kendi özeti varsa ya da engel varsa ileriye doğru kurulamaz", async () => {
    h.probe = () => ({ mode: "cumulative", days: 2, prev_has_summary: true, blocker: null });
    await open("2026-10-01");
    await click(button("Bu günün özeti yok — ertesi günle kapanacak"));
    expect(text()).toContain("01 Ekim 2026 gününün mağaza özeti sistemde var; bu gün özetsiz sayılamaz.");
    expect(button("Onayla").disabled).toBe(true);
    await click(button("Vazgeç"));
    expect(button("Bu günün özeti yok — ertesi günle kapanacak")).toBeTruthy();

    h.probe = () => ({ mode: "group", days: 2, prev_has_summary: false, blocker: "02.10.2026 kilitli — birleşmeye dahil edilemez." });
    await click(button("Bu günün özeti yok — ertesi günle kapanacak"));
    expect(text()).toContain("02.10.2026 kilitli — birleşmeye dahil edilemez.");
    expect(button("Onayla").disabled).toBe(true);
    expect(h.createCalls).toHaveLength(0);
  });

  it("geriye doğru eski akış aynen çalışır (kümülatif ve birlikte kapanış)", async () => {
    h.probe = () => ({ mode: "cumulative", days: 2, prev_has_summary: true, blocker: null });
    await open("2026-10-02");
    await click(button("Önceki günle birleşti"));
    expect((document.getElementById("prev-date") as HTMLInputElement).value).toBe("2026-10-01");
    expect(document.getElementById("next-date")).toBeNull();
    expect(h.probeCalls.at(-1)).toEqual({ store_id: STORE, date: "2026-10-02", prev_date: "2026-10-01" });
    expect(text()).toContain("gününün mağaza özeti sistemde var. Bu günün özeti kümülatif sayılır");
    await click(button("Onayla"));
    expect(h.cumulativeCalls).toEqual([{ store_id: STORE, date: "2026-10-02", prev_date: "2026-10-01" }]);
    expect(h.createCalls).toHaveLength(0);

    h.probe = () => ({ mode: "group", days: 2, prev_has_summary: false, blocker: null });
    await open("2026-10-02");
    await click(button("Önceki günle birleşti"));
    expect(text()).toContain("gününün mağaza özeti yok (kasa o gün kapatılamadı).");
    await click(button("Onayla"));
    expect(h.createCalls).toEqual([{ store_id: STORE, start_date: "2026-10-01", end_date: "2026-10-02" }]);
    expect(h.toastSuccess.at(-1)).toBe("Günler birleştirildi — mağaza özeti ve bayi dosyası 02 Ekim gününe yüklenir");
  });

  it("birleşme kuruluyken ilk günün kartı durumu ve günler arası geçişi gösterir", async () => {
    h.group = { id: "g1", daily_records: [{ date: "2026-10-01T00:00:00.000Z", merge_index: 1 }, { date: "2026-10-02T00:00:00.000Z", merge_index: 2 }] };
    const { onJump } = await open("2026-10-01");
    expect(text()).toContain("Aktif: 01 Ekim – 02 Ekim 2026 birlikte kapatılıyor.");
    expect(text()).toContain("mağaza özeti ve bayi gün sonu dosyası 02 Ekim gününe yüklenir");
    expect(button("Önceki günle birleşti")).toBeUndefined();
    await click(button("02 Ekim · özet"));
    expect(onJump).toHaveBeenCalledWith("2026-10-02");
    await click(button("Birleşmeyi Kaldır"));
    expect(h.deleteCalls).toEqual([{ id: "g1" }]);
  });
});
