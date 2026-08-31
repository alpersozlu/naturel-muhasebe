"""NEBIM KEŞİF v32 — ÇEK TİPİNİ HANGİ SORGU TAŞIYOR (salt-okunur).

qry_GetActiveDiscountOffers çek tipini bilmiyor. POS'un çek penceresini
besleyen gerçek kaynağı buluyoruz: MS/GS varyantları + çek fonksiyonları.
Cikti: KESIF32-CIKTI.txt
"""
from __future__ import annotations

import traceback
from satis_kopru import load_config, connect

OUT = []
URUN = "26PFD510410"
SERI = "2900500099956"
PROCLAR = ["qry_GetActiveDiscountOffers", "qry_MS_GetActiveDiscountOffers",
           "qry_GS_GetActiveDiscountOffers",
           "qry_GetDiscountVouchersByDiscountOfferCode"]


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


def tanim(cur, ad):
    cur.execute("SELECT OBJECT_DEFINITION(OBJECT_ID(?))", ad)
    r = cur.fetchone()
    return (r[0] or "") if r else ""


def parametreler(cur, ad):
    cur.execute("""
        SELECT PARAMETER_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.PARAMETERS
        WHERE SPECIFIC_NAME = ? ORDER BY ORDINAL_POSITION
        """, ad)
    return [(r[0], r[1]) for r in cur.fetchall() if r[0]]


def deger(pad, tip):
    a = pad.lower()
    if "processcode" in a:
        return "R"
    if "storecode" in a:
        return "S01"
    if "curracctypecode" in a:
        return 4
    if "curracccode" in a:
        return ""
    if "itemcode" in a:
        return URUN
    if "langcode" in a:
        return "TR"
    if "discountoffercode" in a:
        return "HCKMP"
    if "vouchertypecode" in a:
        return "HC"
    if "serial" in a:
        return SERI
    if tip in ("int", "tinyint", "smallint", "bigint", "bit", "decimal",
               "numeric", "money", "float"):
        return 0
    if tip in ("datetime", "date", "datetime2", "smalldatetime"):
        return None
    return ""


@bolum("A) SORGULAR: SATIR / 'VOUCHER' GEÇİŞİ / PARAMETRE")
def a_tarama(cur):
    for p in PROCLAR:
        t = tanim(cur, p)
        if not t:
            log(f"  {p}: (bulunamadı)")
            continue
        n = t.lower().count("voucher")
        par = parametreler(cur, p)
        log(f"  {p}: {len(t.splitlines())} satır | 'Voucher' x{n}")
        log(f"     par: {[x[0] for x in par]}")


@bolum("B) POS GİBİ ÇALIŞTIR — HCKMP VE ÇEK TİPİ VAR MI")
def b_calistir(cur):
    for p in PROCLAR:
        par = parametreler(cur, p)
        if not par:
            log(f"  {p}: parametre okunamadı, atlandı")
            continue
        adlar = [x[0] for x in par]
        degerler = [deger(a, t) for a, t in par]
        sql = f"EXEC {p} " + ", ".join(f"{a}=?" for a in adlar)
        try:
            cur.execute(sql, *degerler)
            bulundu = False
            while True:
                if cur.description:
                    kols = [d[0] for d in cur.description]
                    satir = cur.fetchall()
                    cekkol = [k for k in kols if "voucher" in k.lower()]
                    duz = [" | ".join(str(x).strip() for x in r if x is not None)
                           for r in satir]
                    hckmp = any("HCKMP" in s for s in duz)
                    log(f"  {p}: {len(satir)} satır | HCKMP:"
                        f" {'VAR ***' if hckmp else 'yok'}")
                    log(f"     kolonlar: {kols[:9]}")
                    if cekkol:
                        log(f"     >>> ÇEK KOLONU: {cekkol}")
                    for s in duz[:4]:
                        log(f"     · {s[:120]}")
                    bulundu = True
                if not cur.nextset():
                    break
            if not bulundu:
                log(f"  {p}: sonuç kümesi dönmedi")
        except Exception as e:
            log(f"  {p}: HATA {str(e)[:120]}")


@bolum("C) ÇEK TABLO FONKSİYONLARININ MANTIĞI")
def c_tvf(cur):
    for f in ("DiscountVoucherType", "DiscountVouchers", "DiscountVoucherBase"):
        t = tanim(cur, f)
        if not t:
            log(f"  {f}: (yok)")
            continue
        satirlar = [s.strip() for s in t.replace("\r", "").split("\n")]
        onemli = [s for s in satirlar
                  if any(k in s.upper() for k in
                         ("FROM ", "JOIN ", "WHERE", "AND ", "OR "))]
        log(f"  -- {f} ({len(satirlar)} satır):")
        for s in onemli[:12]:
            log(f"     {s[:118]}")
        if len(onemli) > 12:
            log("     ... (kesildi)")


@bolum("D) ÇEKİMİZ FONKSİYONDAN GÖRÜNÜYOR MU")
def d_gorunur(cur):
    for sorgu, ad in (
            (f"SELECT TOP 3 * FROM DiscountVouchers "
             f"WHERE SerialNumber = N'{SERI}'", "DiscountVouchers"),
            ("SELECT TOP 5 * FROM DiscountVoucherType", "DiscountVoucherType")):
        try:
            cur.execute(sorgu)
            kols = [d[0] for d in cur.description]
            satir = cur.fetchall()
            log(f"  {ad}: {len(satir)} satır | kolonlar: {kols[:8]}")
            for r in satir[:3]:
                log("     · " + " | ".join(
                    str(x).strip() for x in r[:8] if x is not None)[:120])
        except Exception as e:
            log(f"  {ad}: HATA {str(e)[:110]}")


def main():
    cfg = load_config()
    log(">>> KEŞİF v32 — çek tipini hangi sorgu taşıyor (salt-okunur)")
    conn = connect(cfg)
    cur = conn.cursor()
    a_tarama(cur)
    b_calistir(cur)
    c_tvf(cur)
    d_gorunur(cur)
    log("\n>>> KEŞİF v32 TAMAM. Çıktının TAMAMINI yapıştır/fotoğrafla.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log(traceback.format_exc())
    try:
        with open("KESIF32-CIKTI.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(OUT))
        print("\n>>> KESIF32-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
