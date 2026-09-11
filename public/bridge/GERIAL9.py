# -*- coding: utf-8 -*-
"""NEBIM GERİ AL-9 — YÜKLE9'u geri alır (YAZAR!).

HCKMP kurallarındaki AmountRuleCode'u yedekten eski hâline döndürür,
HCTUTAR tutar kuralını (basamaklar + açıklama + kural) siler ve
resmi aktivasyonu tekrar çalıştırır.
Cikti: GERIAL9-CIKTI.txt
"""
from __future__ import annotations

import traceback
from satis_kopru import load_config, connect

OUT = []
KOD = "HCKMP"
KURAL = "HCTUTAR"


def log(*a):
    s = " ".join(str(x) for x in a)
    print(s)
    OUT.append(s)


def main():
    cfg = load_config()
    log(">>> GERİ AL-9 — tutar kuralı bağını kaldır")
    conn = connect(cfg)
    conn.autocommit = True
    cur = conn.cursor()

    cur.execute("SELECT COUNT(*) FROM prDiscountOfferRules WHERE DiscountOfferCode=? "
                "AND AmountRuleCode=?", KOD, KURAL)
    bagli = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM cdAmountRule WHERE AmountRuleCode=?", KURAL)
    var = cur.fetchone()[0]
    if not bagli and not var:
        log("DURDU: YUKLE9 izi yok (zaten orijinal).")
        return

    cur.execute("IF OBJECT_ID('zzHCyedek_Kural') IS NULL SELECT 0 ELSE SELECT 1")
    eski = ""
    if cur.fetchone()[0]:
        cur.execute("SELECT TOP 1 EskiDeger FROM zzHCyedek_Kural WHERE Kod=? "
                    "AND Alan LIKE 'AmountRuleCode@%' ORDER BY Id DESC", KOD)
        r = cur.fetchone()
        eski = (r[0] if r and r[0] and r[0] != "NULL" else "") or ""
    cur.execute("UPDATE prDiscountOfferRules SET AmountRuleCode=? WHERE DiscountOfferCode=?",
                eski, KOD)
    log(f"--- HCKMP AmountRuleCode -> '{eski}'")

    for t in ("prAmountRuleBracket", "cdAmountRuleDesc", "cdAmountRule"):
        try:
            cur.execute(f"DELETE FROM {t} WHERE AmountRuleCode=?", KURAL)
            log(f"--- {t}: {cur.rowcount} satır silindi")
        except Exception as e:
            log(f"--- {t}: {str(e)[:80]}")

    cur.execute("EXEC sp_ActivatedDiscountOffers @UserName=N'Sc', @DiscountOfferCode=N'HCKMP'")
    try:
        while cur.nextset():
            pass
    except Exception:
        pass
    log("--- resmi aktivasyon tekrar çalıştırıldı.")
    cur.execute("SELECT DiscountOfferStageCode, AmountRuleCode FROM prDiscountOfferRules "
                "WHERE DiscountOfferCode=?", KOD)
    log(f"--- doğrulama: {[(x[0], str(x[1]).strip()) for x in cur.fetchall()]}")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log("\nHATA:")
        log(traceback.format_exc())
    try:
        with open("GERIAL9-CIKTI.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(OUT))
        print("\n>>> GERIAL9-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
