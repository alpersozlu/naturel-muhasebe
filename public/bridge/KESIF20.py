"""NEBIM KEŞİF v20 — ÇEK TESTİ TEŞHİSİ (salt-okunur).

POS hataları: 'CannotFindActiveDiscountOfferForDiscountVoucherType' ve
'İndirim Çeki Kullanılmış!'. Teşhis için:
A) Test çeklerinin ANLIK durumu (IsUsed/UsedAmount değişti mi?)
B) prDiscountOfferActiveLog tam döküm (aktivasyon mekanizması)
C) TimePeriod '2050' kaydı
D) HCKMP kullanım izleri (tpInvoiceDiscountOffer)
E) HCKMP tam kayıt (offer+rules+location sayıları)
F) Kampanya tipi dağılımı (tip-3 ilk kez mi?) + DefV01 metod kaydı
HİÇBİR YAZMA YAPMAZ. Cikti: KESIF20-CIKTI.txt
"""
from __future__ import annotations

import traceback
from satis_kopru import load_config, connect

OUT = []
SERILER = ["2900500099918", "2900500099925", "2900700099916"]


def log(*a):
    s = " ".join(str(x) for x in a)
    print(s)
    OUT.append(s)


def kisalt(v, n=44):
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


def dump_rows(cur, sql, *p, etiket=""):
    cur.execute(sql, *p)
    adlar = [d[0] for d in cur.description]
    i = 0
    for row in cur.fetchall():
        i += 1
        log(f"  --- {etiket} {i}:")
        for ad, v in zip(adlar, row):
            log(f"     {ad} = {kisalt(v)}")
    if i == 0:
        log(f"  ({etiket}: kayıt yok)")


@bolum("A) TEST ÇEKLERİNİN ANLIK DURUMU")
def a_cekler(cur):
    q = ",".join("?" * len(SERILER))
    cur.execute(f"SELECT SerialNumber, Amount, UsedAmount, MinAmount, IsUsed, "
                f"IsBlocked, IsCanceled, FirstValidDate, LastValidDate, "
                f"DiscountVoucherTypeCode, LastUpdatedUserName, LastUpdatedDate "
                f"FROM cdDiscountVoucher WHERE SerialNumber IN ({q})", *SERILER)
    for r in cur.fetchall():
        log(f"  {r[0]} | tutar={r[1]} kullanılan={r[2]} min={r[3]} | "
            f"IsUsed={r[4]} Blok={r[5]} İptal={r[6]} | {r[7]}→{r[8]} | "
            f"tip='{str(r[9]).strip()}' | son:{r[10]} {r[11]}")


@bolum("B) prDiscountOfferActiveLog — TAM DÖKÜM")
def b_activelog(cur):
    dump_rows(cur, "SELECT * FROM prDiscountOfferActiveLog ORDER BY 1", etiket="log")


@bolum("C) TIMEPERIOD TABLOLARI + '2050'")
def c_period(cur):
    cur.execute("SELECT t.name, SUM(p.rows) FROM sys.tables t "
                "JOIN sys.partitions p ON p.object_id=t.object_id "
                "AND p.index_id IN (0,1) WHERE t.name LIKE '%TimePeriod%' "
                "GROUP BY t.name")
    for t, n in cur.fetchall():
        log(f"  {t} | {n}")
        try:
            cur.execute(f"SELECT * FROM [{t}] WHERE 1=1")
            adlar = [d[0] for d in cur.description]
            kodkolon = next((k for k in adlar if "Code" in k), None)
            if kodkolon:
                cur.execute(f"SELECT TOP 6 * FROM [{t}]")
                log("   kolonlar: " + " | ".join(adlar))
                for r in cur.fetchall():
                    log("   " + " | ".join(kisalt(v, 22) for v in r))
        except Exception as e:
            log(f"   (okunamadı: {e})")


@bolum("D) HCKMP KULLANIM İZLERİ")
def d_izler(cur):
    cur.execute("SELECT COUNT(*) FROM tpInvoiceDiscountOffer "
                "WHERE DiscountOfferCode = 'HCKMP'")
    log(f"  tpInvoiceDiscountOffer HCKMP: {cur.fetchone()[0]}")
    dump_rows(cur, "SELECT TOP 5 * FROM tpInvoiceDiscountOffer "
                   "WHERE DiscountVoucherTypeCode = 'HC' "
                   "ORDER BY CreatedDate DESC", etiket="HC-izi")


@bolum("E) HCKMP KAYIT SAYILARI + KURAL DÖKÜMÜ")
def e_hckmp(cur):
    for t in ("cdDiscountOffer", "prDiscountOfferRules", "prDiscountOfferLocation"):
        cur.execute(f"SELECT COUNT(*) FROM [{t}] WHERE DiscountOfferCode='HCKMP'")
        log(f"  {t}: {cur.fetchone()[0]}")
    dump_rows(cur, "SELECT * FROM cdDiscountOffer WHERE DiscountOfferCode='HCKMP'",
              etiket="offer")
    dump_rows(cur, "SELECT * FROM prDiscountOfferRules "
                   "WHERE DiscountOfferCode='HCKMP'", etiket="kural")


@bolum("F) KAMPANYA TİPİ DAĞILIMI + DefV01")
def f_tipler(cur):
    cur.execute("SELECT DiscountOfferTypeCode, COUNT(*) FROM cdDiscountOffer "
                "GROUP BY DiscountOfferTypeCode")
    for r in cur.fetchall():
        log(f"  kampanya tipi {r[0]}: {r[1]} adet")
    dump_rows(cur, "SELECT * FROM bsDiscountOfferMethod "
                   "WHERE DiscountOfferMethodCode IN ('DefV01','DefV02','DefT01-A')",
              etiket="metod")


def main():
    cfg = load_config()
    log(">>> NEBIM KEŞİF v20 — ÇEK TESTİ TEŞHİSİ (salt-okunur)")
    conn = connect(cfg)
    cur = conn.cursor()
    a_cekler(cur)
    b_activelog(cur)
    c_period(cur)
    d_izler(cur)
    e_hckmp(cur)
    f_tipler(cur)
    log("\n>>> KEŞİF v20 TAMAM. Çıktının TAMAMINI yapıştır.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log(traceback.format_exc())
    try:
        with open("KESIF20-CIKTI.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(OUT))
        print("\n>>> KESIF20-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
