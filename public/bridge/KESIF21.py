"""NEBIM KEŞİF v21 — MOTORUN ARAMA SORGUSUNU BUL (salt-okunur).

A) Hata metnini içeren prosedür/fonksiyon/view VAR MI? Varsa TANIMINI DÖK
   ('CannotFindActiveDiscountOffer' / 'ActiveDiscountOffer' araması)
B) 'DiscountOffer/DiscountVoucher' geçen view+proc adları
C) DefV01/DefV02 metod parametre TANIMLARI (zorunlu parametre var mı?)
D) HCKMP vs UNI2054 — cdDiscountOffer alan alan FARK listesi
E) HCKMP(aşama1) vs UNI2054(aşama1) — kural FARK listesi
HİÇBİR YAZMA YAPMAZ. Cikti: KESIF21-CIKTI.txt
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
                f(*a, **kw)
            except Exception:
                log("BÖLÜM HATASI:\n" + traceback.format_exc())
        return sarili
    return dekore


@bolum("A) HATA METNİNİ İÇEREN SQL MODÜLLERİ")
def a_modul(cur):
    for aranan in ("CannotFindActiveDiscountOffer", "ActiveDiscountOffer",
                   "DiscountVoucherType"):
        cur.execute(
            "SELECT o.type_desc, OBJECT_SCHEMA_NAME(m.object_id), "
            "       OBJECT_NAME(m.object_id), LEN(m.definition) "
            "FROM sys.sql_modules m JOIN sys.objects o "
            "  ON o.object_id = m.object_id "
            "WHERE m.definition LIKE ?", f"%{aranan}%")
        rows = cur.fetchall()
        log(f"-- '{aranan}' geçen modüller: {len(rows)}")
        for r in rows:
            log(f"   {r[0]} | {r[1]}.{r[2]} | {r[3]} karakter")
    # en umut verici modüllerin tanımını dök (ilk 2, 8000 karaktere kadar)
    cur.execute(
        "SELECT TOP 2 OBJECT_NAME(m.object_id), m.definition "
        "FROM sys.sql_modules m "
        "WHERE m.definition LIKE '%ActiveDiscountOffer%' "
        "ORDER BY LEN(m.definition)")
    for ad, tanim in cur.fetchall():
        log(f"\n##### TANIM: {ad} (ilk 8000 kr) #####")
        log(tanim[:8000])


@bolum("B) DISCOUNT VIEW + PROSEDÜR ADLARI")
def b_adlar(cur):
    cur.execute("SELECT name FROM sys.views WHERE name LIKE '%Discount%' "
                "ORDER BY name")
    log("-- view'lar: " + ", ".join(r[0] for r in cur.fetchall()))
    cur.execute("SELECT name FROM sys.procedures WHERE name LIKE '%Discount%' "
                "ORDER BY name")
    log("-- prosedürler: " + ", ".join(r[0] for r in cur.fetchall()))


@bolum("C) DefV01/DefV02 METOD PARAMETRE TANIMLARI")
def c_param(cur):
    cur.execute("SELECT * FROM prDiscountOfferMethodParameter "
                "WHERE DiscountOfferMethodCode IN ('DefV01','DefV02')")
    adlar = [d[0] for d in cur.description]
    rows = cur.fetchall()
    log(f"-- kayıt: {len(rows)} | kolonlar: " + " | ".join(adlar))
    for r in rows:
        log("   " + " | ".join(str(v)[:40] for v in r))
    cur.execute("SELECT DiscountOfferMethodCode, COUNT(*) "
                "FROM prDiscountOfferMethodParameter "
                "GROUP BY DiscountOfferMethodCode ORDER BY 2 DESC")
    log("-- metod başına parametre tanımı:")
    for r in cur.fetchall():
        log(f"   {r[0]} | {r[1]}")


def satir_farki(cur, sql1, sql2, etiket):
    cur.execute(sql1)
    adlar = [d[0] for d in cur.description]
    r1 = cur.fetchone()
    cur.execute(sql2)
    r2 = cur.fetchone()
    if not r1 or not r2:
        log(f"  ({etiket}: satır eksik — r1={bool(r1)} r2={bool(r2)})")
        return
    farkli = 0
    for ad, a, b in zip(adlar, r1, r2):
        if ad in ("DiscountOfferCode", "RowGuid", "CreatedUserName",
                  "CreatedDate", "LastUpdatedUserName", "LastUpdatedDate",
                  "Description", "Priority"):
            continue
        sa, sb = str(a).strip(), str(b).strip()
        if sa != sb:
            farkli += 1
            log(f"   {ad}: HCKMP='{sa[:38]}'  |  UNI2054='{sb[:38]}'")
    log(f"  ({etiket}: {farkli} farklı alan)")


@bolum("D) cdDiscountOffer FARKI (HCKMP vs UNI2054)")
def d_fark(cur):
    satir_farki(cur,
                "SELECT * FROM cdDiscountOffer WHERE DiscountOfferCode='HCKMP'",
                "SELECT * FROM cdDiscountOffer WHERE DiscountOfferCode='UNI2054'",
                "tanım")


@bolum("E) KURAL FARKI (HCKMP aşama1 vs UNI2054 aşama1)")
def e_fark(cur):
    satir_farki(cur,
                "SELECT * FROM prDiscountOfferRules "
                "WHERE DiscountOfferCode='HCKMP' AND DiscountOfferStageCode=1",
                "SELECT * FROM prDiscountOfferRules "
                "WHERE DiscountOfferCode='UNI2054' AND DiscountOfferStageCode=1",
                "kural")


def main():
    cfg = load_config()
    log(">>> NEBIM KEŞİF v21 — MOTORUN ARAMA SORGUSU (salt-okunur)")
    conn = connect(cfg)
    cur = conn.cursor()
    a_modul(cur)
    b_adlar(cur)
    c_param(cur)
    d_fark(cur)
    e_fark(cur)
    log("\n>>> KEŞİF v21 TAMAM. Çıktının TAMAMINI yapıştır.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log(traceback.format_exc())
    try:
        with open("KESIF21-CIKTI.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(OUT))
        print("\n>>> KESIF21-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
