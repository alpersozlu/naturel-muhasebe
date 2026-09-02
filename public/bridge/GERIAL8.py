# -*- coding: utf-8 -*-
"""NEBIM GERİ AL-8 — YÜKLE8'i geri alır (YAZAR!).

zzHCyedek_Kural'daki yedekten HCKMP kural satırlarının tarih alanlarını
eski hâline döndürür ve resmi aktivasyonu tekrar çalıştırır.
Cikti: GERIAL8-CIKTI.txt
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


def main():
    cfg = load_config()
    log(">>> GERİ AL-8 — kural tarihlerini eski hâline döndür")
    conn = connect(cfg)
    conn.autocommit = True
    cur = conn.cursor()

    cur.execute("IF OBJECT_ID('zzHCyedek_Kural') IS NULL SELECT 0 ELSE SELECT 1")
    if not cur.fetchone()[0]:
        log("DURDU: zzHCyedek_Kural yok (YUKLE8 değişiklik yapmamış).")
        return

    cur.execute("SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS "
                "WHERE TABLE_NAME = 'prDiscountOfferRules'")
    tarih_kols = [r[0] for r in cur.fetchall()
                  if r[1] in ("date", "datetime", "smalldatetime", "datetime2")
                  and "Created" not in r[0] and "LastUpdated" not in r[0]]
    log(f"--- geri alınacak tarih alanları: {tarih_kols}")

    set_parcasi = ", ".join(f"k.[{c}] = y.[{c}]" for c in tarih_kols)
    cur.execute(f"""
        UPDATE k SET {set_parcasi}
        FROM prDiscountOfferRules k
        JOIN (SELECT * FROM (
                SELECT *, sira = ROW_NUMBER() OVER (
                    PARTITION BY DiscountOfferStageCode ORDER BY (SELECT 0))
                FROM zzHCyedek_Kural WHERE DiscountOfferCode = N'HCKMP') z
              WHERE z.sira = 1) y
          ON y.DiscountOfferCode = k.DiscountOfferCode
         AND y.DiscountOfferStageCode = k.DiscountOfferStageCode
        WHERE k.DiscountOfferCode = N'HCKMP'
        """)
    log("--- tarih alanları yedekten geri yazıldı.")

    cur.execute("EXEC sp_ActivatedDiscountOffers @UserName=N'Sc', "
                "@DiscountOfferCode=N'HCKMP'")
    try:
        while cur.nextset():
            pass
    except Exception:
        pass
    log("--- resmi aktivasyon tekrar çalıştırıldı.")

    cur.execute("SELECT DiscountOfferStageCode, LastValidDate "
                "FROM prDiscountOfferRules WHERE DiscountOfferCode = ?", KOD)
    for r in cur.fetchall():
        log(f"--- kural aşama {r[0]}: LastValidDate={r[1]}")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log("\nHATA:")
        log(traceback.format_exc())
    try:
        with open("GERIAL8-CIKTI.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(OUT))
        print("\n>>> GERIAL8-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
