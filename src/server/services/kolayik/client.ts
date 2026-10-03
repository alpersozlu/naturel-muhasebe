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

async function kfetch<T>(
  path: string,
  opts: { method?: "GET" | "POST"; query?: Record<string, string | number | undefined>; form?: Record<string, string> } = {}
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

/** İzin kayıtları — tarih aralığında (YYYY-MM-DD), tüm durumlar. */
export async function listLeaves(fromIso: string, toIso: string): Promise<KLeave[]> {
  // "status" ZORUNLU (canlıda HTTP 422: "The status field is required", 03.10.2026).
  // Onaylılar şart; bekleyenler ayrıca sorulur, o sorgu başarısız olursa atlanır.
  const out = new Map<string, KLeave>();
  for (const status of ["approved", "waiting"] as const) {
    try {
      const d = await kfetch<KLeave[] | { items?: KLeave[] }>("/v2/leave/list", {
        query: { status, startDate: dayStart(fromIso), endDate: dayEnd(toIso), limit: 100, include_inactive_employees: "true" },
      });
      for (const l of Array.isArray(d) ? d : (d.items ?? [])) out.set(l.id, { ...l, status: l.status ?? status });
    } catch (e) {
      if (status === "approved") throw e;
    }
  }
  return Array.from(out.values());
}

/** Mesai kayıtları (type=overtime) — tarih aralığında, tüm durumlar, sayfalı. */
export async function listOvertime(fromIso: string, toIso: string): Promise<KTimelog[]> {
  const out: KTimelog[] = [];
  const limit = 100;
  for (let page = 1; page <= 10; page++) {
    const d = await kfetch<{ items?: KTimelog[]; totalCount?: number; searchCount?: number }>("/v2/timelog/list", {
      method: "POST",
      query: { type: "overtime", startDate: dayStart(fromIso), endDate: dayEnd(toIso), limit, page, sortType: "startDate", sortOrder: "asc" },
    });
    const items = d.items ?? [];
    out.push(...items);
    const total = d.searchCount ?? d.totalCount ?? 0;
    if (items.length < limit || out.length >= total) break;
  }
  return out;
}

/** Kişinin izin bakiyeleri (izin türü bazında). */
export async function leaveStatus(personId: string): Promise<KLeaveStatus[]> {
  const d = await kfetch<KLeaveStatus[]>(`/v2/person/leave-status/${encodeURIComponent(personId)}`);
  return Array.isArray(d) ? d : [];
}
