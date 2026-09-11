# -*- coding: utf-8 -*-
"""NEBIM GERİ AL-11 — YÜKLE11'i geri alır: HC tipinde IsProvisionRequired = 0.
Cikti: GERIAL11-CIKTI.txt
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
    log(">>> GERİ AL-11 — provizyonu kapat")
    conn = connect(cfg)
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute("UPDATE cdDiscountVoucherType SET IsProvisionRequired = 0, "
                "LastUpdatedUserName = N'Sc', LastUpdatedDate = GETDATE() "
                "WHERE DiscountVoucherTypeCode = N'HC'")
    log(f"--- güncellenen satır: {cur.rowcount}")
    cur.execute("SELECT IsProvisionRequired FROM cdDiscountVoucherType "
                "WHERE DiscountVoucherTypeCode = N'HC'")
    log(f"--- doğrulama: IsProvisionRequired={cur.fetchone()[0]}")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log("\nHATA:")
        log(traceback.format_exc())
    try:
        with open("GERIAL11-CIKTI.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(OUT))
        print("\n>>> GERIAL11-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
