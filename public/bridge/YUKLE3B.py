# -*- coding: utf-8 -*-
"""NEBIM YÜKLE-3B — HCKMP kampanyasına eksik iki parça (YAZAR!).

POS 'CannotFindActiveDiscountOfferForDiscountVoucherType' diyor.
MERT'in kampanyalarıyla kıyasta eksik iki parçayı ekler:
  1) prDiscountOfferRules AŞAMA-1 (Kazanım) kural satırı
     (aşama-2'nin aynısı; mevcut tüm kampanyalarda aşama-1 var)
  2) prDiscountOfferActiveLog'a 'Aktif edildi' kaydı
Mevcut kayda DOKUNMAZ. Geri almak: GERIAL3.bat (hepsini siler).
Cikti: YUKLE3B-CIKTI.txt
"""
from __future__ import annotations

import traceback
from satis_kopru import load_config, connect

OUT = []
KMP = "HCKMP"
LISTE = "HCGECERLI"


def log(*a):
    s = " ".join(str(x) for x in a)
    print(s)
    OUT.append(s)


def main():
    cfg = load_config()
    log(">>> YÜKLE-3B — aşama-1 kuralı + aktivasyon kaydı")
    conn = connect(cfg)
    conn.autocommit = False
    cur = conn.cursor()

    cur.execute("SELECT COUNT(*) FROM cdDiscountOffer "
                "WHERE DiscountOfferCode=? AND IsActive=1", KMP)
    if cur.fetchone()[0] != 1:
        log("DURDU: HCKMP yok/aktif değil.")
        conn.rollback()
        return
    cur.execute("SELECT COUNT(*) FROM prDiscountOfferRules "
                "WHERE DiscountOfferCode=? AND DiscountOfferStageCode=1", KMP)
    if cur.fetchone()[0]:
        log("  aşama-1 kuralı zaten var, atlanıyor.")
    else:
        cur.execute("""
            INSERT INTO prDiscountOfferRules (
                DiscountOfferCode, DiscountOfferStageCode, TimePeriodCode,
                UseItemListForUsing, ItemListCodeForUsing,
                UseItemListForWinning, ItemListCodeForWinning,
                IsValidWithOtherInstantDiscounts, OnlyBeUsedOnce,
                IsValidCashPayments, IsValidCreditCardPayments,
                IsValidGiftCardPayments, IsValidCreditVoucherPayments,
                IsValidRemittanceAndEFTPayments, IsValidAdvancePayments,
                IsValidOtherPayments)
            VALUES (?, 1, '2050', 1, ?, 1, ?, 1, 1, 1, 1, 1, 1, 1, 1, 1)
            """, KMP, LISTE, LISTE)
        log("  aşama-1 (Kazanım) kural satırı eklendi.")

    cur.execute("SELECT COUNT(*) FROM prDiscountOfferActiveLog "
                "WHERE DiscountOfferCode=?", KMP)
    if cur.fetchone()[0]:
        log("  aktivasyon kaydı zaten var, atlanıyor.")
    else:
        cur.execute("INSERT INTO prDiscountOfferActiveLog "
                    "(DiscountOfferCode, Activated, OperationDate) "
                    "VALUES (?, 1, GETDATE())", KMP)
        log("  ActiveLog 'Aktif edildi' kaydı eklendi.")

    cur.execute("SELECT COUNT(*) FROM prDiscountOfferRules "
                "WHERE DiscountOfferCode=?", KMP)
    n = cur.fetchone()[0]
    log(f"  doğrulama: HCKMP kural satırı = {n} (beklenen 2)")
    if n == 2:
        conn.commit()
        log("\n>>> COMMIT EDİLDİ — POS'u kapatıp açın, çeki tekrar deneyin.")
    else:
        conn.rollback()
        log("\n>>> SAYILAR TUTMADI — geri alındı.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log("\nHATA — transaction otomatik geri alınır:")
        log(traceback.format_exc())
    try:
        with open("YUKLE3B-CIKTI.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(OUT))
        print("\n>>> YUKLE3B-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
