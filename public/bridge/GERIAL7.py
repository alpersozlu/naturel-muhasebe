# -*- coding: utf-8 -*-
"""NEBIM GERİ AL-7 — YÜKLE7'yi geri alır (YAZAR!).

zzHCyedek_Metod'daki en son yedekten HCKMP'nin metodunu eski hâline
döndürür ve resmi aktivasyonu tekrar çalıştırır.
Cikti: GERIAL7-CIKTI.txt
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
    log(">>> GERİ AL-7 — kampanya metodunu eski hâline döndür")
    conn = connect(cfg)
    conn.autocommit = True
    cur = conn.cursor()

    cur.execute("IF OBJECT_ID('zzHCyedek_Metod') IS NULL SELECT 0 ELSE SELECT 1")
    if not cur.fetchone()[0]:
        log("DURDU: zzHCyedek_Metod tablosu yok (YUKLE7 hiç değişiklik "
            "yapmamış).")
        return

    cur.execute("SELECT TOP 1 EskiMetod, YedekTarihi FROM zzHCyedek_Metod "
                "WHERE Kod = ? ORDER BY Id DESC", KOD)
    r = cur.fetchone()
    if not r:
        log("DURDU: yedek satırı yok.")
        return
    eski = str(r[0]).strip()
    log(f"--- yedek: metod={eski} ({r[1]})")

    cur.execute("SELECT DiscountOfferMethodCode FROM cdDiscountOffer "
                "WHERE DiscountOfferCode = ?", KOD)
    su_an = str((cur.fetchone() or [""])[0]).strip()
    if su_an == eski:
        log("DURDU: metod zaten eski hâlinde. Değişiklik yapılmadı.")
        return

    cur.execute("UPDATE cdDiscountOffer SET DiscountOfferMethodCode = ? "
                "WHERE DiscountOfferCode = ?", eski, KOD)
    cur.execute("SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS "
                "WHERE TABLE_NAME='prDiscountOfferRules' "
                "AND COLUMN_NAME='DiscountOfferMethodCode'")
    if cur.fetchone()[0]:
        cur.execute("UPDATE prDiscountOfferRules SET DiscountOfferMethodCode "
                    "= ? WHERE DiscountOfferCode = ?", eski, KOD)
    log(f"--- metod geri alındı: {su_an} -> {eski}")

    cur.execute("EXEC sp_ActivatedDiscountOffers @UserName=N'Sc', "
                "@DiscountOfferCode=N'HCKMP'")
    try:
        while cur.nextset():
            pass
    except Exception:
        pass
    log("--- resmi aktivasyon tekrar çalıştırıldı.")

    cur.execute("SELECT DiscountOfferMethodCode, IsActive FROM cdDiscountOffer "
                "WHERE DiscountOfferCode = ?", KOD)
    r2 = cur.fetchone()
    log(f"--- doğrulama: metod={str(r2[0]).strip()} | aktif={r2[1]}")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log("\nHATA:")
        log(traceback.format_exc())
    try:
        with open("GERIAL7-CIKTI.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(OUT))
        print("\n>>> GERIAL7-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
