"""NEBIM KEŞİF v34 — CustomerCode ENGELİ VE HAMİLİNE YOLU (salt-okunur).

A) Prosedürün kesilmemiş EXISTS satırı
B) Prosedürü DOĞRU sözdizimiyle çalıştır (cari kodlu / kodsuz)
C) CustomerCode filtresi olmadan kaç çek görünürdü
D) Kodda IsBearerVoucher'ı dikkate alan başka yol var mı
E) cdDiscountVoucher'a dokunan tüm prosedürler
Cikti: KESIF34-CIKTI.txt
"""
from __future__ import annotations

import traceback
from satis_kopru import load_config, connect

OUT = []
PROC = "qry_GetDiscountVouchersByDiscountOfferCode"


def log(*a):
    s = " ".join(str(x) for x in a)
    print(s)
    OUT.append(s)


def bolum(ad):
    def dekore(f):
        def sarili(*a, **kw):
            log(f"\n=== {ad} ===")
            try:
                return f(*a, **kw)
            except Exception as e:
                log(f"  HATA: {type(e).__name__}: {str(e)[:200]}")
        return sarili
    return dekore


@bolum("A) KESİLMEMİŞ EXISTS SATIRI")
def a_exists(cur):
    cur.execute("SELECT OBJECT_DEFINITION(OBJECT_ID(?))", PROC)
    t = (cur.fetchone() or [""])[0] or ""
    for s in t.replace("\r", "").split("\n"):
        if "EXISTS" in s.upper() or "@DiscountOfferCodes" in s:
            s = s.strip()
            for i in range(0, len(s), 118):
                log("  " + s[i:i + 118])


@bolum("B) PROSEDÜRÜ DOĞRU ÇAĞIR")
def b_dogru(cur):
    for cari, tip in (("", 4), ("12-4-10", 4), ("12-4-10", 0), ("", 0)):
        try:
            cur.execute(
                "DECLARE @d date = CAST(GETDATE() AS date); "
                f"EXEC {PROC} @DiscountOfferCodes=?, @CurrAccTypeCode=?, "
                "@CurrAccCode=?, @CurrentDate=@d",
                "HCKMP", tip, cari)
            satir = cur.fetchall()
            ornek = ""
            if satir:
                ornek = " | ".join(str(x).strip() for x in satir[0][:4]
                                   if x is not None)[:70]
            log(f"  cari='{cari}' tip={tip} -> {len(satir)} satır "
                f"{'*** ' + ornek if satir else ''}")
        except Exception as e:
            log(f"  cari='{cari}' tip={tip} -> HATA {str(e)[:100]}")


@bolum("C) CustomerCode FİLTRESİ OLMADAN")
def c_filtresiz(cur):
    cur.execute("""
        SELECT COUNT(*) FROM cdDiscountVoucher v WITH(NOLOCK)
        WHERE EXISTS (SELECT * FROM cdDiscountOffer o WITH(NOLOCK)
                      WHERE o.DiscountVoucherTypeCode = v.DiscountVoucherTypeCode)
          AND v.CustomerTypeCode = 4
          AND v.IsCanceled = 0 AND v.IsBlocked = 0 AND v.IsUsed = 0
          AND v.FirstValidDate <= CAST(GETDATE() AS date)
        """)
    log(f"  CustomerCode koşulu ÇIKARILINCA görünen çek: {cur.fetchone()[0]}")
    cur.execute("""
        SELECT COUNT(*) FROM cdDiscountVoucher v WITH(NOLOCK)
        WHERE EXISTS (SELECT * FROM cdDiscountOffer o WITH(NOLOCK)
                      WHERE o.DiscountVoucherTypeCode = v.DiscountVoucherTypeCode)
          AND v.CustomerTypeCode = 4 AND v.CustomerCode = N'12-4-10'
          AND v.IsCanceled = 0 AND v.IsBlocked = 0 AND v.IsUsed = 0
        """)
    log(f"  CustomerCode='12-4-10' iken: {cur.fetchone()[0]}")


@bolum("D) HAMİLİNE (IsBearerVoucher) KODDA GEÇİYOR MU")
def d_hamiline(cur):
    for ara in ("IsBearerVoucher", "CustomerCode = @CurrAccCode"):
        cur.execute("""
            SELECT o.name, o.type_desc FROM sys.sql_modules m
            JOIN sys.objects o ON o.object_id = m.object_id
            WHERE m.definition LIKE ? ORDER BY o.name
            """, f"%{ara}%")
        r = [str(x[0]).strip() for x in cur.fetchall()]
        log(f"  '{ara}' geçen nesneler ({len(r)}): {r[:12]}")


@bolum("E) cdDiscountVoucher'A DOKUNAN NESNELER")
def e_dokunan(cur):
    cur.execute("""
        SELECT o.name FROM sys.sql_modules m
        JOIN sys.objects o ON o.object_id = m.object_id
        WHERE m.definition LIKE '%cdDiscountVoucher%' ORDER BY o.name
        """)
    r = [str(x[0]).strip() for x in cur.fetchall()]
    log(f"  ({len(r)}): {r}")


def main():
    cfg = load_config()
    log(">>> KEŞİF v34 — CustomerCode engeli ve hamiline yolu (salt-okunur)")
    conn = connect(cfg)
    cur = conn.cursor()
    a_exists(cur)
    b_dogru(cur)
    c_filtresiz(cur)
    d_hamiline(cur)
    e_dokunan(cur)
    log("\n>>> KEŞİF v34 TAMAM. Çıktının TAMAMINI yapıştır/fotoğrafla.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log(traceback.format_exc())
    try:
        with open("KESIF34-CIKTI.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(OUT))
        print("\n>>> KESIF34-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
