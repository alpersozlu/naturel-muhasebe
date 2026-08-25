# -*- coding: utf-8 -*-
"""NEBIM GERİ-AL-1B — dfGlobalDefault.DiscountVoucherTypeCode'u boşaltır (YAZAR!).

YUKLE-1B'nin geri alma scripti: 'HC' değerini eski haline ('') döndürür.
Cikti: GERIAL1B-CIKTI.txt
"""
from __future__ import annotations

import traceback
from satis_kopru import load_config, connect

OUT = []


def log(*a):
    s = " ".join(str(x) for x in a)
    print(s)
    OUT.append(s)


def main():
    cfg = load_config()
    log(">>> GERİ-AL-1B — dfGlobalDefault.DiscountVoucherTypeCode -> ''")
    conn = connect(cfg)
    conn.autocommit = False
    cur = conn.cursor()
    cur.execute("UPDATE dfGlobalDefault SET DiscountVoucherTypeCode = '' "
                "WHERE LTRIM(RTRIM(DiscountVoucherTypeCode)) = 'HC'")
    log(f"  güncellenen satır: {cur.rowcount}")
    conn.commit()
    log(">>> COMMIT EDİLDİ — alan eski (boş) haline döndü.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log("\nHATA — transaction otomatik geri alınır:")
        log(traceback.format_exc())
    try:
        with open("GERIAL1B-CIKTI.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(OUT))
        print("\n>>> GERIAL1B-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
