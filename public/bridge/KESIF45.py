# -*- coding: utf-8 -*-
"""NEBIM KEŞİF v45 — MOTOR İZİ + ÇEK TABANI (salt-okunur).

KESIF44 (DLL taraması) gösterdi: kampanya motorunun iz (trace) mekanizması
ve çek tipinde 'DiscountVoucherBaseCode' alanı var. İkisine de bakıyoruz.

A) İz tabloları (%DiscountOfferTrace%, %OfferTrace%): var mı, son kayıtlar
B) bsDiscountVoucherBase (+Desc): çek tabanları ne demek
C) cdDiscountVoucherType 'HC' — TÜM kolonlar (taban kodu dahil)
D) dfGlobalDefault / parametre tablolarında Trace / DiscountOffer / Voucher alanları
E) prDiscountOfferProduct: ProcessCode='R' için aşama→prosedür eşlemesi
Cikti: KESIF45-CIKTI.txt
"""
from __future__ import annotations

import traceback
from satis_kopru import load_config, connect

OUT = []


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
                log(f"  HATA: {type(e).__name__}: {str(e)[:220]}")
        return sarili
    return dekore


def k(v, n=60):
    if v is None:
        return "NULL"
    if hasattr(v, "strftime"):
        return v.strftime("%Y-%m-%d %H:%M")
    return str(v).strip()[:n]


def tablolar(cur, desen):
    cur.execute("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES "
                "WHERE TABLE_NAME LIKE ? AND TABLE_TYPE='BASE TABLE' "
                "ORDER BY TABLE_NAME", desen)
    return [r[0] for r in cur.fetchall()]


@bolum("A) MOTOR İZ TABLOLARI")
def a_iz(cur):
    adlar = []
    for d in ("%DiscountOfferTrace%", "%OfferTrace%", "%DiscountOfferLog%",
              "%DiscountVoucherTrace%"):
        for t in tablolar(cur, d):
            if t not in adlar:
                adlar.append(t)
    log(f"  bulunan: {adlar or 'YOK'}")
    for t in adlar[:6]:
        cur.execute(f"SELECT COUNT(*) FROM [{t}] WITH(NOLOCK)")
        n = cur.fetchone()[0]
        cur.execute("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS "
                    "WHERE TABLE_NAME=? ORDER BY ORDINAL_POSITION", t)
        kols = [r[0] for r in cur.fetchall()]
        log(f"  --- {t}: {n} satır | kolonlar: {kols[:14]}")
        if n == 0:
            continue
        tarih = next((c for c in kols if "Date" in c), None)
        sira = f"ORDER BY [{tarih}] DESC" if tarih else ""
        cur.execute(f"SELECT TOP 12 * FROM [{t}] WITH(NOLOCK) {sira}")
        for r in cur.fetchall():
            log("     · " + " | ".join(k(v, 70) for v in r[:9]))
        # HCKMP geçen kayıt var mı
        metin_kols = [c for c in kols]
        try:
            kosul = " OR ".join(f"CAST([{c}] AS nvarchar(max)) LIKE N'%HCKMP%'"
                                for c in metin_kols[:20])
            cur.execute(f"SELECT COUNT(*) FROM [{t}] WITH(NOLOCK) WHERE {kosul}")
            log(f"     HCKMP geçen kayıt: {cur.fetchone()[0]}")
        except Exception as e:
            log(f"     (HCKMP araması: {str(e)[:60]})")


@bolum("B) ÇEK TABANLARI (bsDiscountVoucherBase)")
def b_taban(cur):
    for t in ("bsDiscountVoucherBase", "bsDiscountVoucherBaseDesc"):
        try:
            cur.execute(f"SELECT * FROM {t} WITH(NOLOCK)")
            kols = [d[0] for d in cur.description]
            log(f"  --- {t}: {kols}")
            for r in cur.fetchall():
                log("     · " + " | ".join(k(v, 50) for v in r))
        except Exception as e:
            log(f"  {t}: HATA {str(e)[:80]}")


@bolum("C) HC ÇEK TİPİ — TÜM KOLONLAR")
def c_tip(cur):
    cur.execute("SELECT * FROM cdDiscountVoucherType WITH(NOLOCK) "
                "WHERE DiscountVoucherTypeCode = N'HC'")
    kols = [d[0] for d in cur.description]
    r = cur.fetchone()
    if not r:
        log("  HC tipi YOK")
        return
    for c, v in zip(kols, r):
        if c in ("RowGuid",):
            continue
        log(f"  {c:<34} = {k(v, 60)}")
    # diğer tip ('' kodlu varsayılan) ile kıyas
    cur.execute("SELECT * FROM cdDiscountVoucherType WITH(NOLOCK) "
                "WHERE DiscountVoucherTypeCode <> N'HC'")
    for r2 in cur.fetchall():
        log("  --- diğer tip (farklı alanlar):")
        for c, v1, v2 in zip(kols, r, r2):
            if c in ("RowGuid", "CreatedDate", "LastUpdatedDate",
                     "CreatedUserName", "LastUpdatedUserName"):
                continue
            if k(v1) != k(v2):
                log(f"     {c:<32} HC={k(v1,30)}   diğer={k(v2,30)}")


@bolum("D) GLOBAL / PARAMETRE ALANLARI (Trace, DiscountOffer, Voucher)")
def d_param(cur):
    cur.execute("""
        SELECT TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE (TABLE_NAME LIKE 'df%' OR TABLE_NAME LIKE 'bsGlobal%'
               OR TABLE_NAME LIKE '%Parameter%' OR TABLE_NAME LIKE '%Setting%')
          AND (COLUMN_NAME LIKE '%Trace%' OR COLUMN_NAME LIKE '%DiscountOffer%'
               OR COLUMN_NAME LIKE '%Voucher%')
        ORDER BY TABLE_NAME, COLUMN_NAME
        """)
    r = cur.fetchall()
    log(f"  {len(r)} alan")
    gruplar = {}
    for t, c in r:
        gruplar.setdefault(t, []).append(c)
    for t, cs in list(gruplar.items())[:12]:
        try:
            cur.execute(f"SELECT TOP 1 {', '.join('['+c+']' for c in cs[:12])} "
                        f"FROM [{t}] WITH(NOLOCK)")
            row = cur.fetchone()
            log(f"  --- {t}")
            if row:
                for c, v in zip(cs[:12], row):
                    log(f"     {c:<40} = {k(v, 40)}")
        except Exception as e:
            log(f"  --- {t}: HATA {str(e)[:60]}")


@bolum("E) prDiscountOfferProduct — AŞAMA → PROSEDÜR (ProcessCode R)")
def e_urun(cur):
    cur.execute("SELECT * FROM prDiscountOfferProduct WITH(NOLOCK) "
                "WHERE ProcessCode = N'R'")
    kols = [d[0] for d in cur.description]
    log(f"  kolonlar: {kols}")
    for r in cur.fetchall():
        log("   · " + " | ".join(k(v, 40) for v in r))


def main():
    cfg = load_config()
    log(">>> KEŞİF v45 — motor izi + çek tabanı (salt-okunur)")
    conn = connect(cfg)
    cur = conn.cursor()
    a_iz(cur)
    b_taban(cur)
    c_tip(cur)
    d_param(cur)
    e_urun(cur)
    log("\n>>> KEŞİF v45 TAMAM. Çıktının TAMAMINI yapıştır.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log(traceback.format_exc())
    try:
        with open("KESIF45-CIKTI.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(OUT))
        print("\n>>> KESIF45-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
