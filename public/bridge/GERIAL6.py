# -*- coding: utf-8 -*-
"""NEBIM GERİ AL-6 — YÜKLE6'yı geri alır (YAZAR!).

zzHCyedek_Proc'taki EN SON yedekten sp_ValidateDiscountVoucherCustomer
prosedürünü orijinaline döndürür.
Cikti: GERIAL6-CIKTI.txt
"""
from __future__ import annotations

import re
import traceback
from satis_kopru import load_config, connect

OUT = []
PROC = "sp_ValidateDiscountVoucherCustomer"
IMZA = "hcTip.IsBearerVoucher = 1"


def log(*a):
    s = " ".join(str(x) for x in a)
    print(s)
    OUT.append(s)


def tanim(cur):
    cur.execute("SELECT OBJECT_DEFINITION(OBJECT_ID(?))", PROC)
    r = cur.fetchone()
    return (r[0] or "") if r else ""


def main():
    cfg = load_config()
    log(">>> GERİ AL-6 — doğrulama prosedürünü orijinaline döndür")
    conn = connect(cfg)
    conn.autocommit = True
    cur = conn.cursor()

    if IMZA not in tanim(cur):
        log("DURDU: prosedürde bizim değişikliğimiz YOK (zaten orijinal).")
        return

    cur.execute("IF OBJECT_ID('zzHCyedek_Proc') IS NULL SELECT 0 ELSE SELECT 1")
    if not cur.fetchone()[0]:
        log("DURDU: zzHCyedek_Proc tablosu yok.")
        return

    cur.execute("SELECT TOP 1 Tanim, YedekTarihi FROM zzHCyedek_Proc "
                "WHERE Ad = ? ORDER BY Id DESC", PROC)
    r = cur.fetchone()
    if not r or not r[0]:
        log("DURDU: bu prosedür için yedek satırı yok.")
        return
    log(f"--- yedek tarihi: {r[1]}")

    geri = re.sub(r"CREATE\s+PROCEDURE", "ALTER PROCEDURE", r[0], count=1,
                  flags=re.I)
    cur.execute(geri)
    log("--- orijinal tanım geri yüklendi.")
    log(f"--- doğrulama: değişiklik hâlâ var mı: "
        f"{'VAR ✗' if IMZA in tanim(cur) else 'YOK ✓ (orijinal)'}")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log("\nHATA:")
        log(traceback.format_exc())
    try:
        with open("GERIAL6-CIKTI.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(OUT))
        print("\n>>> GERIAL6-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
