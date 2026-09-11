# -*- coding: utf-8 -*-
"""NEBIM GERİ AL-10 — YÜKLE10'u geri alır (YAZAR!).

IND ve UNI2054 kurallarındaki IsValidWithOtherDiscountVouchers bayrağını
zzHCyedek_Kural'daki eski değerine döndürür.
Cikti: GERIAL10-CIKTI.txt
"""
from __future__ import annotations

import traceback
from satis_kopru import load_config, connect

OUT = []
HEDEF = ["IND", "UNI2054"]
BAYRAK = "IsValidWithOtherDiscountVouchers"


def log(*a):
    s = " ".join(str(x) for x in a)
    print(s)
    OUT.append(s)


def main():
    cfg = load_config()
    log(">>> GERİ AL-10 — bayrağı eski değerine döndür")
    conn = connect(cfg)
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute("IF OBJECT_ID('zzHCyedek_Kural') IS NULL SELECT 0 ELSE SELECT 1")
    if not cur.fetchone()[0]:
        log("DURDU: yedek tablosu yok.")
        return
    for kod in HEDEF:
        cur.execute("SELECT Alan, EskiDeger FROM zzHCyedek_Kural WHERE Kod=? AND Alan LIKE ? "
                    "ORDER BY Id DESC", kod, f"{BAYRAK}@%")
        satirlar = cur.fetchall()
        if not satirlar:
            log(f"  {kod}: yedek yok, atlandı")
            continue
        gorulen = set()
        for alan, eski in satirlar:
            st = alan.split("@")[-1]
            if st in gorulen:
                continue
            gorulen.add(st)
            cur.execute(f"UPDATE prDiscountOfferRules SET {BAYRAK} = ? "
                        f"WHERE DiscountOfferCode = ? AND DiscountOfferStageCode = ?",
                        int(eski or 0), kod, int(st))
            log(f"  {kod} st{st}: {BAYRAK} -> {eski}")
    cur.execute(f"SELECT DiscountOfferCode, DiscountOfferStageCode, {BAYRAK} "
                f"FROM prDiscountOfferRules WHERE DiscountOfferCode IN (N'IND', N'UNI2054')")
    log(f"--- doğrulama: {[(str(r[0]).strip(), r[1], r[2]) for r in cur.fetchall()]}")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log("\nHATA:")
        log(traceback.format_exc())
    try:
        with open("GERIAL10-CIKTI.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(OUT))
        print("\n>>> GERIAL10-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
