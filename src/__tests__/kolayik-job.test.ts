import { createHmac } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { POST } from "@/app/api/jobs/kolayik/route";

/**
 * İmzalı, salt okunur Kolay İK denetim ucu: imzasız / süresi geçmiş istek
 * içeri giremez; yazma yolları çağrılamaz.
 */
const KEY = "test-service-role-key";
const sign = (body: string, key = KEY) => createHmac("sha256", key).update(body).digest("hex");
const call = (body: string, signature: string) =>
  POST(new Request("http://localhost/api/jobs/kolayik", { method: "POST", body, headers: { "x-signature": signature } }));
const now = () => Math.floor(Date.now() / 1000);

beforeAll(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = KEY;
  delete process.env.KOLAYIK_API_TOKEN; // dışarıya gerçek çağrı yapılmasın
});

describe("api/jobs/kolayik — imzalı salt okunur uç", () => {
  it("imzasız ya da yanlış anahtarla imzalı istek reddedilir", async () => {
    const body = JSON.stringify({ exp: now() + 60, calls: [] });
    expect((await call(body, "")).status).toBe(401);
    expect((await call(body, "zz")).status).toBe(401);
    expect((await call(body, sign(body, "baska-anahtar"))).status).toBe(401);
    // gövde imzadan sonra değiştirilirse de reddedilir
    expect((await call(body.replace("[]", '[{"path":"/v2/person/list"}]'), sign(body))).status).toBe(401);
  });

  it("süresi geçmiş ya da çok ileri tarihli istek reddedilir", async () => {
    const old = JSON.stringify({ exp: now() - 5, calls: [] });
    expect((await call(old, sign(old))).status).toBe(401);
    const far = JSON.stringify({ exp: now() + 3600, calls: [] });
    expect((await call(far, sign(far))).status).toBe(401);
  });

  it("geçerli imzayla çalışır; yazma yolları ve bilinmeyen yollar çağrılamaz", async () => {
    const body = JSON.stringify({
      exp: now() + 60,
      calls: [
        { path: "/v2/leave/create", method: "POST" },
        { path: "/v2/person/delete/abc", method: "POST" },
        { path: "/v2/leave/list/../../person/update", method: "POST" },
        { path: "https://evil.example/v2/person/list" },
        { path: "/v2/person/list", method: "POST", form: { status: "active", page: "1" } },
      ],
    });
    const res = await call(body, sign(body));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const { results } = (await res.json()) as { results: Array<{ ok: boolean; error?: string }> };
    expect(results).toHaveLength(5);
    for (const r of results.slice(0, 4)) {
      expect(r.ok).toBe(false);
      expect(r.error).toContain("İzin verilmeyen Kolay İK yolu");
    }
    // izinli yol süzgeçten geçer; burada anahtar olmadığı için Kolay İK'ya gidilmez
    expect(results[4]!.ok).toBe(false);
    expect(results[4]!.error).toContain("KOLAYIK_API_TOKEN");
  });
});
