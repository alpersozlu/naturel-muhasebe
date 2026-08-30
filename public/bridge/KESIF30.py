"""NEBIM KEŞİF v30 — HCKMP NEDEN GÖRÜNMÜYOR (salt-okunur, KISA ÇIKTI).

MSGCannotFindActiveDiscountOfferForDiscountVoucherType teşhisi:
A) HCKMP kampanya kartı (kritik bayraklar)
B) HCKMP kuralları
C) LOKASYON/ÜRÜN/MÜŞTERİ satır sayıları  <<< ana şüpheli
D) ÇALIŞAN kampanya ile kıyas (bugün Lefkoşa'da indirim veren)
E) HC çek tipi bayrakları
F) qry_GetActiveDiscountOffers parametreleri
Cikti: KESIF30-CIKTI.txt
"""
from __future__ import annotations

import traceback
from satis_kopru import load_config, connect

OUT = []
KOD = "HCKMP"


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
            except Exception as e:
                log(f"  HATA: {type(e).__name__}: {str(e)[:200]}")
        return sarili
    return dekore


def sozluk(cur, sql, *p):
    cur.execute(sql, *p)
    kols = [d[0] for d in cur.description]
    return [dict(zip(kols, r)) for r in cur.fetchall()]


def kisa(d, anahtarlar):
    """Sadece var olan ve ilginç anahtarları tek satırda ver."""
    parca = []
    for k in anahtarlar:
        if k in d:
            v = d[k]
            if hasattr(v, "strftime"):
                v = v.strftime("%Y-%m-%d")
            parca.append(f"{k}={str(v).strip()}")
    return " | ".join(parca)


@bolum("A) HCKMP KAMPANYA KARTI")
def a_kart(cur):
    r = sozluk(cur, "SELECT * FROM cdDiscountOffer WHERE DiscountOfferCode=?", KOD)
    if not r:
        log("  !!! HCKMP KAMPANYASI YOK !!!")
        return
    d = r[0]
    log("  " + kisa(d, ["IsActive", "IsBlocked", "DiscountOfferTypeCode",
                       "DiscountVoucherTypeCode", "TimePeriodCode",
                       "StartDate", "EndDate", "FirstValidDate",
                       "LastValidDate", "PriorityNumber", "ApplyTo",
                       "DiscountOfferMethodCode", "IsAppliedToAllStores",
                       "IsValidForAllStores"]))
    kalan = [k for k in d if "Active" in k or "Valid" in k or "Store" in k]
    log("  (ilgili diğer kolonlar) " + kisa(d, kalan))


@bolum("B) HCKMP KURALLARI")
def b_kural(cur):
    r = sozluk(cur, "SELECT * FROM prDiscountOfferRules WHERE DiscountOfferCode=?", KOD)
    log(f"  kural satırı: {len(r)}")
    for d in r:
        log("  - " + kisa(d, ["DiscountOfferRuleStageCode", "StageCode",
                              "LineNumber", "UseItemListForUsing",
                              "ItemListCodeForUsing", "OnlyBeUsedOnce",
                              "IsValidCustomerBirthDate",
                              "IsValidCustomerMarriedDate",
                              "IsValidForAllPaymentTypes"]))


@bolum("C) LOKASYON / ÜRÜN / MÜŞTERİ  <<< ANA ŞÜPHELİ")
def c_lokasyon(cur):
    for tablo in ("prDiscountOfferLocation", "prDiscountOfferProduct",
                  "prDiscountOfferCustomer"):
        try:
            cur.execute(f"SELECT COUNT(*) FROM {tablo} WHERE DiscountOfferCode=?", KOD)
            n = cur.fetchone()[0]
            cur.execute(f"SELECT COUNT(*) FROM {tablo}")
            t = cur.fetchone()[0]
            isaret = "  <<< BOŞ! KÖK NEDEN BU" if n == 0 and "Location" in tablo else ""
            log(f"  {tablo}: HCKMP={n}  (tablo toplamı={t}){isaret}")
        except Exception as e:
            log(f"  {tablo}: HATA {str(e)[:90]}")
    try:
        cur.execute("SELECT DISTINCT TOP 20 StoreCode FROM prDiscountOfferLocation "
                    "WHERE DiscountOfferCode=?", KOD)
        kod = [str(x[0]).strip() for x in cur.fetchall()]
        log(f"  HCKMP mağazaları: {kod or '(YOK)'}")
    except Exception as e:
        log(f"  mağaza listesi: {str(e)[:90]}")


@bolum("D) ÇALIŞAN KAMPANYA İLE KIYAS")
def d_kiyas(cur):
    r = sozluk(cur, """
        SELECT TOP 3 t.DiscountOfferCode, adet = COUNT(*)
        FROM tpInvoiceDiscountOffer t WITH(NOLOCK)
        JOIN trInvoiceHeader h WITH(NOLOCK)
          ON h.InvoiceHeaderID = t.InvoiceHeaderID
        WHERE h.InvoiceDate >= DATEADD(day, -3, GETDATE())
        GROUP BY t.DiscountOfferCode
        ORDER BY COUNT(*) DESC
        """)
    if not r:
        log("  (son 3 günde kullanılan kampanya yok)")
        return
    for d in r:
        kod = str(d["DiscountOfferCode"]).strip()
        cur.execute("SELECT COUNT(*) FROM prDiscountOfferLocation "
                    "WHERE DiscountOfferCode=?", kod)
        lok = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM prDiscountOfferProduct "
                    "WHERE DiscountOfferCode=?", kod)
        urn = cur.fetchone()[0]
        o = sozluk(cur, "SELECT * FROM cdDiscountOffer WHERE DiscountOfferCode=?", kod)
        akt = kisa(o[0], ["IsActive", "DiscountOfferTypeCode",
                          "TimePeriodCode"]) if o else "-"
        log(f"  {kod}: kullanım={d['adet']} | lokasyon={lok} | ürün={urn} | {akt}")


@bolum("E) HC ÇEK TİPİ")
def e_tip(cur):
    r = sozluk(cur, "SELECT * FROM cdDiscountVoucherType "
                    "WHERE DiscountVoucherTypeCode=N'HC'")
    if not r:
        log("  !!! HC TİPİ YOK !!!")
        return
    d = r[0]
    log("  " + kisa(d, ["IsActive", "IsBlocked", "UseRecordedVouchers",
                        "IsDisposable", "IsBearerVoucher",
                        "IsUsedOncePerSale", "DiscountLevelOfUseCode",
                        "BarcodeTypeCode", "IsProvisionRequired",
                        "IsV3Provision", "CurrencyCode"]))
    cur.execute("SELECT DiscountVoucherTypeCode FROM cdDiscountVoucherType")
    log(f"  sistemdeki tüm çek tipleri: "
        f"{[str(x[0]).strip() for x in cur.fetchall()]}")


@bolum("F) qry_GetActiveDiscountOffers PARAMETRELERİ")
def f_param(cur):
    cur.execute("""
        SELECT PARAMETER_NAME, DATA_TYPE
        FROM INFORMATION_SCHEMA.PARAMETERS
        WHERE SPECIFIC_NAME = 'qry_GetActiveDiscountOffers'
        ORDER BY ORDINAL_POSITION
        """)
    p = [f"{r[0]}:{r[1]}" for r in cur.fetchall()]
    log(f"  {p or '(prosedür bulunamadı)'}")
    cur.execute("""
        SELECT TOP 3 name, modify_date FROM sys.objects
        WHERE name IN ('qry_GetActiveDiscountOffers',
                       'qry_GetDiscountOfferProducts_R_1',
                       'qry_GetDiscountOfferProducts_R_2')
        """)
    for r in cur.fetchall():
        log(f"  {r[0]} son üretim: {r[1]}")


def main():
    cfg = load_config()
    log(">>> KEŞİF v30 — HCKMP görünürlük teşhisi (salt-okunur)")
    conn = connect(cfg)
    cur = conn.cursor()
    a_kart(cur)
    b_kural(cur)
    c_lokasyon(cur)
    d_kiyas(cur)
    e_tip(cur)
    f_param(cur)
    log("\n>>> KEŞİF v30 TAMAM. Çıktının TAMAMINI yapıştır/fotoğrafla.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log(traceback.format_exc())
    try:
        with open("KESIF30-CIKTI.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(OUT))
        print("\n>>> KESIF30-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
