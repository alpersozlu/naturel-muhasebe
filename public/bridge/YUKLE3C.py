# -*- coding: utf-8 -*-
"""NEBIM YÜKLE-3C — HCKMP kural bayrak düzeltmesi (YAZAR!).

Motor sorgusu (qry_GetActiveDiscountOffers) IsValidCustomerBirthDate=1 veya
IsValidCustomerMarriedDate=1 olan kampanyaları 'doğum günü kampanyası' sayıp
yalnız doğum günü BUGÜN olan müşteriye gösteriyor. Bu iki alan bizim
satırlarımızda varsayılan olarak 1 gelmiş. Düzeltme: HCKMP'nin kural
satırlarında ikisini de 0 yap (+ MaxInstallmentCount=0 hizalaması).
YALNIZ HCKMP satırlarına dokunur. Cikti: YUKLE3C-CIKTI.txt
"""
from __future__ import annotations

import traceback
from satis_kopru import load_config, connect

OUT = []
KMP = "HCKMP"


def log(*a):
    s = " ".join(str(x) for x in a)
    print(s)
    OUT.append(s)


def main():
    cfg = load_config()
    log(">>> YÜKLE-3C — HCKMP doğum günü/evlilik bayrakları kapatılıyor")
    conn = connect(cfg)
    conn.autocommit = False
    cur = conn.cursor()

    cur.execute("SELECT DiscountOfferStageCode, IsValidCustomerBirthDate, "
                "IsValidCustomerMarriedDate, MaxInstallmentCount "
                "FROM prDiscountOfferRules WHERE DiscountOfferCode = ?", KMP)
    for r in cur.fetchall():
        log(f"  önce: aşama {r[0]} | doğum={r[1]} evlilik={r[2]} taksit={r[3]}")

    cur.execute("UPDATE prDiscountOfferRules "
                "SET IsValidCustomerBirthDate = 0, "
                "    IsValidCustomerMarriedDate = 0, "
                "    MaxInstallmentCount = 0 "
                "WHERE DiscountOfferCode = ?", KMP)
    log(f"  güncellenen satır: {cur.rowcount} (beklenen 2)")

    cur.execute("SELECT DiscountOfferStageCode, IsValidCustomerBirthDate, "
                "IsValidCustomerMarriedDate FROM prDiscountOfferRules "
                "WHERE DiscountOfferCode = ?", KMP)
    hepsi_kapali = True
    for r in cur.fetchall():
        log(f"  sonra: aşama {r[0]} | doğum={r[1]} evlilik={r[2]}")
        if r[1] or r[2]:
            hepsi_kapali = False

    if hepsi_kapali:
        conn.commit()
        log("\n>>> COMMIT EDİLDİ — POS'u kapatıp açın, çeki tekrar deneyin.")
    else:
        conn.rollback()
        log("\n>>> BEKLENMEDİK DURUM — geri alındı.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log("\nHATA — transaction otomatik geri alınır:")
        log(traceback.format_exc())
    try:
        with open("YUKLE3C-CIKTI.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(OUT))
        print("\n>>> YUKLE3C-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
