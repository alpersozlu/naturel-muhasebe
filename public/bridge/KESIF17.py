"""NEBIM KEŞİF v17 — KAMPANYA MOTORU SÖZLÜKLERİ + AKTİF KURALLAR (salt-okunur).

A) bsDiscountOfferType/Apply/Stage/Method sözlükleri (tam)
B) Tutar kuralı tabloları (%AmountRule%)
C) 5 AKTİF kampanyanın tanım + kural satırları (tüm dolu alanlar)
D) Aktif kampanyaların mağaza kapsamı + parametre değerleri
E) Metod scriptleri listesi
HİÇBİR YAZMA YAPMAZ. Cikti: KESIF17-CIKTI.txt
"""
from __future__ import annotations

import traceback
from satis_kopru import load_config, connect

OUT = []
AKTIFLER = ["UNI2054", "TSF1499", "%60HAZ26", "NİS%40%50", "IND"]


def log(*a):
    s = " ".join(str(x) for x in a)
    print(s)
    OUT.append(s)


def kisalt(v, n=70):
    s = "-" if v is None else str(v)
    s = s.replace("\r", " ").replace("\n", " ").strip()
    return (s[: n - 1] + "…") if len(s) > n else s


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


def dump_tablo(cur, tablo):
    cur.execute(f"SELECT * FROM [{tablo}]")
    adlar = [d[0] for d in cur.description]
    log(f"-- {tablo}: " + " | ".join(adlar))
    for r in cur.fetchall():
        log("   " + " | ".join(kisalt(v, 44) for v in r))


def dump_nonempty(cur, sql, *params, etiket=""):
    cur.execute(sql, *params)
    adlar = [d[0] for d in cur.description]
    i = 0
    for row in cur.fetchall():
        i += 1
        log(f"  --- {etiket} kayıt {i}:")
        for ad, v in zip(adlar, row):
            s = kisalt(v)
            if s not in ("-", "0", "", "0.00", "False", "0.0",
                         "1900-01-01", "1900-01-01 00:00:00"):
                log(f"     {ad} = {s}")
    if i == 0:
        log(f"  ({etiket}: kayıt yok)")


@bolum("A) KAMPANYA MOTORU SÖZLÜKLERİ")
def a_sozluk(cur):
    for t in ("bsDiscountOfferTypeDesc", "bsDiscountOfferApplyDesc",
              "bsDiscountOfferStageDesc", "bsDiscountOfferMethodDesc"):
        dump_tablo(cur, t)


@bolum("B) TUTAR KURALI TABLOLARI")
def b_tutar(cur):
    cur.execute(
        "SELECT t.name, SUM(p.rows) FROM sys.tables t "
        "JOIN sys.partitions p ON p.object_id = t.object_id "
        "     AND p.index_id IN (0,1) "
        "WHERE t.name LIKE '%AmountRule%' GROUP BY t.name ORDER BY t.name")
    tablolar = cur.fetchall()
    for t, n in tablolar:
        log(f"  {t} | {n}")
    for t, n in tablolar:
        if n and n <= 80:
            dump_tablo(cur, t)


@bolum("C) AKTİF KAMPANYALARIN TANIM + KURALLARI")
def c_kurallar(cur):
    for kod in AKTIFLER:
        log(f"\n##### {kod} #####")
        dump_nonempty(cur, "SELECT * FROM cdDiscountOffer "
                           "WHERE DiscountOfferCode = ?", kod, etiket="tanım")
        dump_nonempty(cur, "SELECT * FROM prDiscountOfferRules "
                           "WHERE DiscountOfferCode = ?", kod, etiket="kural")


@bolum("D) AKTİF KAMPANYALARIN MAĞAZA + PARAMETRELERİ")
def d_kapsam(cur):
    for kod in AKTIFLER:
        cur.execute("SELECT * FROM prDiscountOfferLocation "
                    "WHERE DiscountOfferCode = ?", kod)
        adlar = [d[0] for d in cur.description]
        satirlar = cur.fetchall()
        log(f"-- {kod} lokasyon ({len(satirlar)}): " + " | ".join(adlar))
        for r in satirlar[:6]:
            log("   " + " | ".join(kisalt(v, 24) for v in r))
        dump_nonempty(cur, "SELECT * FROM prDiscountOfferParameterValue "
                           "WHERE DiscountOfferCode = ?", kod,
                      etiket=f"{kod} parametre")


@bolum("E) METOD SCRIPTLERİ")
def e_metod(cur):
    cur.execute("SELECT * FROM prDiscountOfferMethodScript")
    adlar = [d[0] for d in cur.description]
    log("-- prDiscountOfferMethodScript: " + " | ".join(adlar))
    for r in cur.fetchall():
        log("   " + " | ".join(kisalt(v, 60) for v in r))


def main():
    cfg = load_config()
    log(">>> NEBIM KEŞİF v17 — KAMPANYA SÖZLÜKLERİ + AKTİF KURALLAR (salt-okunur)")
    conn = connect(cfg)
    cur = conn.cursor()
    a_sozluk(cur)
    b_tutar(cur)
    c_kurallar(cur)
    d_kapsam(cur)
    e_metod(cur)
    log("\n>>> KEŞİF v17 TAMAM. Çıktının TAMAMINI yapıştır.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log(traceback.format_exc())
    try:
        with open("KESIF17-CIKTI.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(OUT))
        print("\n>>> KESIF17-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
