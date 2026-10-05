import "server-only";

/**
 * Kolay İK Public API v2 — SALT OKUNUR istemci.
 *
 * Kimlik: Ayarlar → Geliştirici Ayarları'nda üretilen API anahtarı,
 * `Authorization: Bearer <token>`; anahtar yalnız ortam değişkeninde durur
 * (KOLAYIK_API_TOKEN — sahibi Vercel'e kendisi girdi, 03.10.2026). Şifreyle
 * giriş yapılmaz. Anahtarın kapsamları yalnız görüntüleme/listeleme:
 * person:*view/list, leave:list/view, timelog:list/view, transaction:list/view,
 * unit:show-unit-tree. Bu dosyada create/update/delete çağrısı YOKTUR.
 *
 * Uç noktalar (OpenAPI: api-evangelist/kolayik):
 *   POST /v2/person/list            (multipart: status, page)
 *   GET  /v2/person/leave-status/{id}
 *   GET  /v2/leave/list             (query: status, startDate, endDate, limit, personId)
 *   POST /v2/timelog/list           (query: type, status, startDate, endDate, limit, page)
 *   POST /v2/transaction/list       (query: type, status, startDate, endDate, limit, page)
 */
const BASE = "https://api.kolayik.com";

export function kolayikConfigured(): boolean {
  return !!process.env.KOLAYIK_API_TOKEN;
}

export class KolayikError extends Error {
  constructor(
    message: string,
    public status: number | null = null
  ) {
    super(message);
  }
}

export type KolayikCall = { method?: "GET" | "POST"; query?: Record<string, string | number | undefined>; form?: Record<string, string> };

/**
 * Ham, SALT OKUNUR çağrı — yalnız liste / görüntüleme uçları (api/jobs/kolayik
 * imzalı denetim ucu kullanır). Yazma ucu çağrılamaz: yol burada süzülür,
 * anahtarın kapsamları da yalnız görüntülemedir.
 */
const READ_ONLY_PATH = /^\/v2\/(person|leave|timelog|transaction|unit)\/(list|view\/[\w-]+|leave-status\/[\w-]+|show-unit-tree)$/;
export async function kolayikRead<T = unknown>(path: string, opts: KolayikCall = {}): Promise<T> {
  if (!READ_ONLY_PATH.test(path)) throw new KolayikError(`İzin verilmeyen Kolay İK yolu: ${path}`);
  return kfetch<T>(path, opts);
}

async function kfetch<T>(
  path: string,
  opts: KolayikCall = {}
): Promise<T> {
  const token = process.env.KOLAYIK_API_TOKEN;
  if (!token) throw new KolayikError("KOLAYIK_API_TOKEN tanımlı değil");
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  let body: FormData | undefined;
  if (opts.form) {
    body = new FormData();
    for (const [k, v] of Object.entries(opts.form)) body.set(k, v);
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8_000); // Vercel işlev süresi içinde kal
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      body,
      signal: ctrl.signal,
      cache: "no-store",
    });
  } catch (e) {
    throw new KolayikError(`Kolay İK'ya ulaşılamadı: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let json: { error?: boolean; data?: unknown; message?: unknown; code?: unknown } | null = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  if (!res.ok || !json || json.error) {
    const msg = json && (json.message ?? json.code) ? String(json.message ?? json.code) : text.slice(0, 200);
    throw new KolayikError(`Kolay İK ${path} → HTTP ${res.status}: ${msg}`, res.status);
  }
  return json.data as T;
}

export type KPerson = { id: string; firstName: string; lastName: string };
export type KLeave = {
  id: string;
  startDate: string;
  endDate: string;
  returnDate?: string | null;
  comment?: string | null;
  type?: { id: string; name: string } | null;
  person?: { id: string; name: string } | null;
  status: string;
  usedDays?: number | null;
};
export type KTimelog = {
  id: string;
  startDate: string;
  endDate: string;
  usedMinute: number;
  personId: string;
  description?: string | null;
  status: string;
  type: string;
  convertType?: string | null;
  createdAt?: string | null;
};
export type KLeaveStatus = {
  id: string;
  name: string;
  primary?: boolean;
  total?: number;
  used?: number;
  unused?: number;
  currentEarned?: number;
  currentUsed?: number;
  carriedOver?: number;
  /** Yıl içinde elle eklenen gün (pazar / tatil çalışması karşılığı hak günleri) */
  leaveBonus?: number;
  active?: boolean;
};

/** Aktif (ve istenirse pasif) personel — sayfalı. */
export async function listPersons(status: "active" | "inactive" = "active"): Promise<KPerson[]> {
  const out: KPerson[] = [];
  for (let page = 1; page <= 20; page++) {
    const d = await kfetch<{ items?: KPerson[]; lastPage?: number }>("/v2/person/list", {
      method: "POST",
      form: { status, page: String(page) },
    });
    out.push(...(d.items ?? []));
    if (!d.lastPage || page >= d.lastPage) break;
  }
  return out;
}

const dayStart = (iso: string) => `${iso} 00:00:00`;
const dayEnd = (iso: string) => `${iso} 23:59:59`;

/** İşleri sırayı koruyarak, aynı anda en çok `n` tanesi çalışacak şekilde yürütür. */
export async function pooled<T>(tasks: Array<() => Promise<T>>, n = 5): Promise<T[]> {
  const out: T[] = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= tasks.length) return;
      out[i] = await tasks[i]!();
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, worker));
  return out;
}

/** [from, to] aralığını 7 günlük dilimlere böler (uçlar dahil). */
function weeklyWindows(fromIso: string, toIso: string): Array<{ from: string; to: string }> {
  const out: Array<{ from: string; to: string }> = [];
  const end = new Date(`${toIso}T00:00:00.000Z`).getTime();
  for (let t = new Date(`${fromIso}T00:00:00.000Z`).getTime(); t <= end; t += 7 * 86_400_000) {
    const last = Math.min(t + 6 * 86_400_000, end);
    out.push({ from: new Date(t).toISOString().slice(0, 10), to: new Date(last).toISOString().slice(0, 10) });
  }
  return out;
}

/**
 * İzin kayıtları — tarih aralığında (YYYY-MM-DD), onaylı + bekleyen.
 *
 * Liste en çok 100 kayıt döner ve sayfalanmaz (ölçüldü 05.10.2026: yedi
 * haftalık aralık tam 100 kayıtta kesildi, eski tarihliler yoktu). Bu yüzden
 * aralık haftalık dilimlerle okunur; iki dilime taşan izin kimliğiyle tekilleşir.
 */
export async function listLeaves(fromIso: string, toIso: string): Promise<KLeave[]> {
  // "status" ZORUNLU (canlıda HTTP 422: "The status field is required", 03.10.2026).
  // include_inactive_employees: "true" metni reddedilir (HTTP 422 "must be true or
  // false" — doğrulama 1/0 bekler); "1" de reddedilirse parametresiz denenir.
  const call = async (status: string, from: string, to: string, inactive: string | undefined) =>
    kfetch<KLeave[] | { items?: KLeave[] }>("/v2/leave/list", {
      query: { status, startDate: dayStart(from), endDate: dayEnd(to), limit: 100, include_inactive_employees: inactive },
    });
  const out = new Map<string, KLeave>();
  const tasks = weeklyWindows(fromIso, toIso).flatMap((w) =>
    (["approved", "waiting"] as const).map((status) => async () => {
      try {
        let d: KLeave[] | { items?: KLeave[] };
        try {
          d = await call(status, w.from, w.to, "1");
        } catch (e) {
          if (e instanceof KolayikError && e.status === 422) d = await call(status, w.from, w.to, undefined);
          else throw e;
        }
        return (Array.isArray(d) ? d : (d.items ?? [])).map((l) => ({ ...l, status: l.status ?? status }));
      } catch (e) {
        // Onaylılar şart; bekleyenler okunamazsa atlanır.
        if (status === "approved") throw e;
        return [] as KLeave[];
      }
    })
  );
  for (const list of await pooled(tasks)) for (const l of list) out.set(l.id, l);
  return Array.from(out.values());
}

/**
 * Mesai kayıtları (type=overtime) — tarih aralığında, tüm durumlar.
 *
 * Kolay İK "limit" ne gönderilirse gönderilsin sayfa başına 15 kayıt döner ve
 * totalCount / searchCount o sayfadaki sayıyı verir (ölçüldü 05.10.2026:
 * Eylül'ün 70+ kaydından yalnız ilk 15'i geliyordu — prim ekranındaki mesai
 * önerisi 3.10–5.10 arasında bu yüzden EKSİKTİ). Boş sayfa gelene dek okunur;
 * hız için aralık haftalık dilimlere bölünüp koşut okunur.
 */
export async function listOvertime(fromIso: string, toIso: string): Promise<KTimelog[]> {
  const readWindow = async (from: string, to: string) => {
    const seen = new Map<string, KTimelog>();
    for (let page = 1; page <= 40; page++) {
      const d = await kfetch<{ items?: KTimelog[] }>("/v2/timelog/list", {
        method: "POST",
        query: { type: "overtime", startDate: dayStart(from), endDate: dayEnd(to), limit: 100, page, sortType: "startDate", sortOrder: "asc" },
      });
      const items = d.items ?? [];
      let fresh = 0;
      for (const t of items) {
        if (!seen.has(t.id)) {
          seen.set(t.id, t);
          fresh += 1;
        }
      }
      if (items.length === 0 || fresh === 0) break; // bitti (ya da sayfa numarası yok sayılıyor)
    }
    return Array.from(seen.values());
  };
  const out = new Map<string, KTimelog>();
  const lists = await pooled(weeklyWindows(fromIso, toIso).map((w) => () => readWindow(w.from, w.to)), 5);
  for (const list of lists) for (const t of list) out.set(t.id, t);
  return Array.from(out.values()).sort((x, y) => x.startDate.localeCompare(y.startDate));
}

/** Kişinin izin bakiyeleri (izin türü bazında). */
export async function leaveStatus(personId: string): Promise<KLeaveStatus[]> {
  const d = await kfetch<KLeaveStatus[]>(`/v2/person/leave-status/${encodeURIComponent(personId)}`);
  return Array.isArray(d) ? d : [];
}
