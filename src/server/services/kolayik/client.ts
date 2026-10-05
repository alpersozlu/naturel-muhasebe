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
 *
 * LİSTELERİN GERÇEK DAVRANIŞI (canlıda ölçüldü, 05.10.2026) — belgede yazmaz:
 *   • timelog/list  sayfa başına 15 kayıt döner ("limit" yok sayılır); tarih
 *     süzgeci KAPSAMA ister: kayıt pencerenin içinde başlayıp içinde BİTMELİ.
 *     Akşam girilip gece yarısından sonra biten kayıt (243 kaydın 71'i böyle)
 *     pencerenin son gününe denk gelirse hiçbir pencerede görünmez.
 *   • leave/list    en çok 100 kayıt, sayfalama yok; tarih süzgeci izinin
 *     BAŞLANGICINA bakar: pencereden önce başlayıp içine uzanan izin gelmez.
 *   • İstek sınırı var: kısa sürede ~150 çağrıdan sonra HTTP 429 "Too Many
 *     Attempts". Çağrılar bu yüzden az tutulur, sıraya sokulur ve 429'da
 *     beklenip yeniden denenir.
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

/** İnce ayar — sınamalar bekleme sürelerini kısaltabilsin diye dışa açık. */
export const kolayikTuning = {
  /** İşlem genelinde aynı anda en çok bu kadar çağrı */
  maxParallel: 4,
  /** HTTP 429'da yeniden denemeden önce beklenecek süreler (deneme başına) */
  retryWaitsMs: [3_000, 8_000],
  /** Retry-After başlığı en çok bu kadar bekletir (işlev süresi 60 sn) */
  maxRetryAfterMs: 12_000,
};

/** Son yanıtta görülen istek sınırı başlıkları — yalnız tanı için. */
export type KolayikRateInfo = { status: number; limit: number | null; remaining: number | null; retry_after_s: number | null; at: string };
let lastRate: KolayikRateInfo | null = null;
export function kolayikRateInfo(): KolayikRateInfo | null {
  return lastRate;
}
function noteRate(res: Response) {
  const n = (name: string) => {
    const v = res.headers.get(name);
    return v != null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null;
  };
  const limit = n("x-ratelimit-limit");
  const remaining = n("x-ratelimit-remaining");
  const retry = n("retry-after");
  if (limit != null || remaining != null || retry != null || res.status === 429) {
    lastRate = { status: res.status, limit, remaining, retry_after_s: retry, at: new Date().toISOString() };
  }
}

// İşlem genelinde sıra: Kolay İK'ya aynı anda en çok `maxParallel` çağrı gider.
let running = 0;
const waiters: Array<() => void> = [];
async function acquire(): Promise<void> {
  if (running < kolayikTuning.maxParallel) {
    running += 1;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve)); // yer, release() ile elden devredilir
}
function release(): void {
  const next = waiters.shift();
  if (next) next();
  else running -= 1;
}
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function kfetch<T>(
  path: string,
  opts: KolayikCall = {}
): Promise<T> {
  const token = process.env.KOLAYIK_API_TOKEN;
  if (!token) throw new KolayikError("KOLAYIK_API_TOKEN tanımlı değil");
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  await acquire();
  try {
    for (let attempt = 0; ; attempt++) {
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
      noteRate(res);
      const text = await res.text();
      if (res.status === 429) {
        // İstek sınırı: bekle, yeniden dene (sıradaki yer bırakılmaz — diğer çağrılar da beklesin).
        if (attempt < kolayikTuning.retryWaitsMs.length) {
          const after = Number(res.headers.get("retry-after"));
          const wait =
            Number.isFinite(after) && after > 0 ? Math.min(after * 1000 + 250, kolayikTuning.maxRetryAfterMs) : kolayikTuning.retryWaitsMs[attempt]!;
          await sleep(wait);
          continue;
        }
        throw new KolayikError(`Kolay İK istek sınırı doldu (${path} → HTTP 429). Bir dakika sonra yeniden deneyin.`, 429);
      }
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
  } finally {
    release();
  }
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

const DAY_MS = 86_400_000;
const shiftDay = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
const daySpan = (fromIso: string, toIso: string) => Math.round((Date.parse(`${toIso}T00:00:00.000Z`) - Date.parse(`${fromIso}T00:00:00.000Z`)) / DAY_MS);

/** [from, to] aralığını en çok `days` günlük dilimlere böler (uçlar dahil). */
function chunkWindows(fromIso: string, toIso: string, days: number): Array<{ from: string; to: string }> {
  const out: Array<{ from: string; to: string }> = [];
  for (let a = fromIso; a <= toIso; a = shiftDay(a, days)) {
    const b = shiftDay(a, days - 1);
    out.push({ from: a, to: b < toIso ? b : toIso });
  }
  return out;
}

/**
 * İznin [from, to] aralığına düşen gün sayısı. Kolay İK izin gününü takvim
 * günü olarak sayar (31.08–05.09 = 6, 21.08–01.09 = 12); sınırı aşan izinde
 * gün sayısı, aralıkta kalan takvim günleriyle orantılanır.
 */
export function leaveDaysWithin(leave: { start: string; end: string; days: number }, fromIso: string, toIso: string): number {
  const span = Math.max(1, daySpan(leave.start, leave.end) + 1);
  const a = leave.start < fromIso ? fromIso : leave.start;
  const b = leave.end > toIso ? toIso : leave.end;
  const inside = Math.max(0, daySpan(a, b) + 1);
  return inside >= span ? leave.days : Math.round(((leave.days * inside) / span) * 100) / 100;
}

/** Bundan uzun süredir devam eden izin (aralıktan önce başlamış) görülmez. */
export const LEAVE_LOOKBACK_DAYS = 31;
const LEAVE_WINDOW_DAYS = 14;
const LEAVE_CAP = 100;

/**
 * [from, to] aralığına DEĞEN izinler (YYYY-MM-DD), onaylı + bekleyen.
 *
 * Kolay İK süzgeci izinin BAŞLANGIÇ tarihine bakar (ölçüldü 05.10.2026:
 * 07–12.09 izni, 09–10.09 ve 11–14.09 pencerelerinde gelmedi; 05–08.09'da
 * geldi). Önceki ayda başlayıp bu aya uzanan izin (ör. 31.08–05.09) yalnız
 * başladığı pencerede görünür — bu yüzden okuma `lookbackDays` gün geriden
 * başlar, sonra aralığa değmeyenler atılır.
 *
 * Liste en çok 100 kayıt döner ve sayfalanmaz: tam 100 gelen dilim ikiye
 * bölünüp yeniden okunur. İki dilimde de gelen izin kimliğiyle tekilleşir.
 */
export async function listLeaves(fromIso: string, toIso: string, opts: { lookbackDays?: number } = {}): Promise<KLeave[]> {
  // "status" ZORUNLU (canlıda HTTP 422: "The status field is required", 03.10.2026).
  // include_inactive_employees: "true" metni reddedilir (HTTP 422 "must be true or
  // false" — doğrulama 1/0 bekler); "1" de reddedilirse parametresiz denenir.
  const call = async (status: string, from: string, to: string, inactive: string | undefined) =>
    kfetch<KLeave[] | { items?: KLeave[] }>("/v2/leave/list", {
      query: { status, startDate: dayStart(from), endDate: dayEnd(to), limit: LEAVE_CAP, include_inactive_employees: inactive },
    });
  const read = async (status: "approved" | "waiting", from: string, to: string): Promise<KLeave[]> => {
    let d: KLeave[] | { items?: KLeave[] };
    try {
      d = await call(status, from, to, "1");
    } catch (e) {
      if (e instanceof KolayikError && e.status === 422) d = await call(status, from, to, undefined);
      else throw e;
    }
    const items = (Array.isArray(d) ? d : (d.items ?? [])).map((l) => ({ ...l, status: l.status ?? status }));
    if (items.length < LEAVE_CAP) return items;
    if (from >= to) throw new KolayikError(`Kolay İK izin listesi ${from} günü için ${LEAVE_CAP} kayıtta kesildi — liste eksik olabilir`);
    const mid = shiftDay(from, Math.floor(daySpan(from, to) / 2));
    const halves = await Promise.all([read(status, from, mid), read(status, shiftDay(mid, 1), to)]);
    return halves.flat();
  };
  const readFrom = shiftDay(fromIso, -Math.max(0, opts.lookbackDays ?? LEAVE_LOOKBACK_DAYS));
  const lists = await Promise.all(
    chunkWindows(readFrom, toIso, LEAVE_WINDOW_DAYS).flatMap((w) => (["approved", "waiting"] as const).map((status) => read(status, w.from, w.to)))
  );
  const out = new Map<string, KLeave>();
  for (const list of lists) {
    for (const l of list) {
      if (l.endDate.slice(0, 10) >= fromIso && l.startDate.slice(0, 10) <= toIso) out.set(l.id, l);
    }
  }
  return Array.from(out.values()).sort((x, y) => x.startDate.localeCompare(y.startDate));
}

const OVERTIME_CHUNK_DAYS = 14;

/**
 * [from, to] günlerinde BAŞLAYAN mesai kayıtları (type=overtime), tüm durumlar.
 *
 * İki tuzak (ikisi de ölçüldü, 05.10.2026):
 *  1. "limit" ne gönderilirse gönderilsin sayfa başına 15 kayıt gelir ve
 *     totalCount / searchCount o sayfadaki sayıyı verir (prim ekranı 3–5.10
 *     arasında Eylül'ün yalnız ilk 15 kaydını görüyordu) → boş sayfa gelene
 *     dek okunur.
 *  2. Tarih süzgeci kaydın pencere içinde BİTMESİNİ de ister. Kayıtlar çoğu
 *     kez akşam girilir, bitişi gece yarısını aşar (21.09 22:34 → 22.09 01:34);
 *     pencerenin son gününde başlayan böyle bir kayıt ne o pencerede ne
 *     sonrakinde görünür (Eylül'de 4 kayıt, 20 saat eksik okundu) → her dilim
 *     bitişi BİR GÜN ileri alınarak sorulur, sonra başlangıç gününe göre
 *     süzülür. (Varsayım: tek mesai kaydı 24 saatten kısadır.)
 */
export async function listOvertime(fromIso: string, toIso: string): Promise<KTimelog[]> {
  const readChunk = async (from: string, to: string) => {
    const seen = new Map<string, KTimelog>();
    for (let page = 1; page <= 60; page++) {
      const d = await kfetch<{ items?: KTimelog[] }>("/v2/timelog/list", {
        method: "POST",
        query: { type: "overtime", startDate: dayStart(from), endDate: dayEnd(shiftDay(to, 1)), limit: 100, page, sortType: "startDate", sortOrder: "asc" },
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
  const lists = await Promise.all(chunkWindows(fromIso, toIso, OVERTIME_CHUNK_DAYS).map((w) => readChunk(w.from, w.to)));
  const out = new Map<string, KTimelog>();
  for (const list of lists) {
    for (const t of list) {
      const day = t.startDate.slice(0, 10);
      if (day >= fromIso && day <= toIso) out.set(t.id, t);
    }
  }
  return Array.from(out.values()).sort((x, y) => x.startDate.localeCompare(y.startDate));
}

/** Kişinin izin bakiyeleri (izin türü bazında). */
export async function leaveStatus(personId: string): Promise<KLeaveStatus[]> {
  const d = await kfetch<KLeaveStatus[]>(`/v2/person/leave-status/${encodeURIComponent(personId)}`);
  return Array.isArray(d) ? d : [];
}
