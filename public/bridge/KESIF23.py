"""NEBIM KEŞİF v23 — MOTOR SİMÜLASYONU (salt-okunur; yalnız qry_* çalıştırır).

A) qry_GetActiveDiscountOffers'ı POS'un çağırdığı gibi ÇALIŞTIR:
   S01 + müşteri 12-4-1 (+ geçerli bir ürünle) → HCKMP listede mi?
B) Statik müşteri dalını ADIM ADIM tekrar kur → hangi koşul eliyor?
C) Çek penceresinin kullandığı asıl prosedürü bul:
   'DiscountVoucherTypeCode'+'IsActive' ve 'UseRecordedVouchers' geçen
   modüllerin en küçüklerini TAM DÖK.
Cikti: KESIF23-CIKTI.txt
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


def exec_dump(cur, sql, *p, etiket=""):
    cur.execute(sql, *p)
    try:
        adlar = [d[0] for d in cur.description]
        rows = cur.fetchall()
        log(f"-- {etiket}: {len(rows)} satır | " + " | ".join(adlar))
        for r in rows[:40]:
            log("   " + " | ".join(str(v)[:36] for v in r))
    except Exception as e:
        log(f"-- {etiket}: sonuç kümesi yok ({e})")


@bolum("A) MOTOR SİMÜLASYONU — qry_GetActiveDiscountOffers")
def a_sim(cur):
    cur.execute("SELECT TOP 1 ItemCode FROM prItemListContent "
                "WHERE ItemListCode = N'HCGECERLI'")
    r = cur.fetchone()
    ornek_urun = r[0] if r else ""
    log(f"örnek geçerli ürün: {ornek_urun}")
    exec_dump(cur, "EXEC qry_GetActiveDiscountOffers N'R', N'S01', 4, N'', N'', N'TR'",
              etiket="yalnız mağaza (S01)")
    exec_dump(cur, "EXEC qry_GetActiveDiscountOffers N'R', N'S01', 4, N'12-4-1', N'', N'TR'",
              etiket="mağaza+müşteri")
    exec_dump(cur, "EXEC qry_GetActiveDiscountOffers N'R', N'S01', 4, N'12-4-1', ?, N'TR'",
              ornek_urun, etiket="mağaza+müşteri+ürün")


@bolum("B) STATİK MÜŞTERİ DALI — ADIM ADIM (HCKMP)")
def b_adim(cur):
    adimlar = [
        ("1 lokasyon(S01,stage1)",
         "SELECT COUNT(*) FROM prDiscountOfferLocation WITH(NOLOCK) "
         "WHERE DiscountOfferCode='HCKMP' AND StoreTypeCode=5 "
         "AND StoreCode='S01' AND DiscountOfferStageCode=1"),
        ("2 +kural join (filter='' ve bayraklar 0)",
         "SELECT COUNT(*) FROM prDiscountOfferLocation l WITH(NOLOCK) "
         "INNER JOIN prDiscountOfferRules r WITH(NOLOCK) "
         "ON l.DiscountOfferCode=r.DiscountOfferCode "
         "AND l.DiscountOfferStageCode=r.DiscountOfferStageCode "
         "AND convert(nvarchar(max), r.CustomerFilterString)=SPACE(0) "
         "AND r.IsValidCustomerMarriedDate=0 AND r.IsValidCustomerBirthDate=0 "
         "WHERE l.DiscountOfferCode='HCKMP' AND l.StoreTypeCode=5 "
         "AND l.StoreCode='S01' AND l.DiscountOfferStageCode=1"),
        ("3 +offer join (R, tip4)",
         "SELECT COUNT(*) FROM prDiscountOfferLocation l WITH(NOLOCK) "
         "INNER JOIN cdDiscountOffer o WITH(NOLOCK) "
         "ON o.DiscountOfferCode=l.DiscountOfferCode "
         "AND o.ProcessCode='R' AND o.CurrAccTypeCode=4 "
         "WHERE l.DiscountOfferCode='HCKMP' AND l.StoreTypeCode=5 "
         "AND l.StoreCode='S01' AND l.DiscountOfferStageCode=1"),
        ("4 final (aktif+stage1 kural+dönem)",
         "SELECT COUNT(*) FROM cdDiscountOffer o WITH(NOLOCK) "
         "INNER JOIN prDiscountOfferRules r WITH(NOLOCK) "
         "ON r.DiscountOfferCode=o.DiscountOfferCode "
         "AND r.DiscountOfferStageCode=1 "
         "INNER JOIN cdTimePeriod t WITH(NOLOCK) "
         "ON t.TimePeriodCode=r.TimePeriodCode AND t.IsBlocked=0 "
         "WHERE o.DiscountOfferCode='HCKMP' AND o.IsActive=1 AND o.IsBlocked=0 "
         "AND GETDATE() BETWEEN CAST(t.StartDate AS datetime)+CAST(t.StartTime AS datetime) "
         "AND CAST(t.EndDate AS datetime)+CAST(t.EndTime AS datetime)"),
    ]
    for ad, sql in adimlar:
        cur.execute(sql)
        log(f"  adım {ad}: {cur.fetchone()[0]}")


@bolum("C) ÇEK PENCERESİNİN PROSEDÜRÜ")
def c_moduller(cur):
    cur.execute(
        "SELECT OBJECT_NAME(m.object_id), LEN(m.definition) "
        "FROM sys.sql_modules m "
        "WHERE m.definition LIKE '%DiscountVoucherTypeCode%' "
        "AND m.definition LIKE '%IsActive%' ORDER BY LEN(m.definition)")
    adaylar = cur.fetchall()
    log("-- 'DiscountVoucherTypeCode'+'IsActive' modülleri:")
    for r in adaylar:
        log(f"   {r[0]} | {r[1]}")
    cur.execute(
        "SELECT OBJECT_NAME(m.object_id), LEN(m.definition) "
        "FROM sys.sql_modules m "
        "WHERE m.definition LIKE '%UseRecordedVouchers%' "
        "ORDER BY LEN(m.definition)")
    kayitli = cur.fetchall()
    log("-- 'UseRecordedVouchers' modülleri:")
    for r in kayitli:
        log(f"   {r[0]} | {r[1]}")
    dokulecek = [r[0] for r in adaylar[:3]] + [r[0] for r in kayitli[:2]]
    dokulecek = list(dict.fromkeys(dokulecek))[:4]
    for ad in dokulecek:
        cur.execute("SELECT m.definition FROM sys.sql_modules m "
                    "WHERE OBJECT_NAME(m.object_id) = ?", ad)
        r = cur.fetchone()
        if r:
            log(f"\n##### {ad} (TAM, ilk 7000) #####")
            log(r[0][:7000])


def main():
    cfg = load_config()
    log(">>> NEBIM KEŞİF v23 — MOTOR SİMÜLASYONU (salt-okunur)")
    conn = connect(cfg)
    cur = conn.cursor()
    a_sim(cur)
    b_adim(cur)
    c_moduller(cur)
    log("\n>>> KEŞİF v23 TAMAM. Çıktının TAMAMINI yapıştır.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log(traceback.format_exc())
    try:
        with open("KESIF23-CIKTI.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(OUT))
        print("\n>>> KESIF23-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
