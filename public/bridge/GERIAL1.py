# -*- coding: utf-8 -*-
"""NEBIM GERİ-AL-1 — YÜKLE-1'in eklediklerini siler (YAZAR!).

Yalnız 'HC' tipine ait kayıtları siler: 15 test çeki + açıklamalar + tip.
GÜVENLİK: kullanılmış (IsUsed=1 veya UsedAmount>0) çek varsa DURUR —
kullanılmış çek silinmez, durumu bildirirsin.
Cikti: GERIAL1-CIKTI.txt
"""
from __future__ import annotations

import traceback
from satis_kopru import load_config, connect

OUT = []
TIP = "HC"


def log(*a):
    s = " ".join(str(x) for x in a)
    print(s)
    OUT.append(s)


def main():
    cfg = load_config()
    log(">>> GERİ-AL-1 — 'HC' tipinin kayıtları siliniyor")
    conn = connect(cfg)
    conn.autocommit = False
    cur = conn.cursor()

    cur.execute("SELECT COUNT(*) FROM cdDiscountVoucher "
                "WHERE DiscountVoucherTypeCode = ? "
                "  AND (IsUsed = 1 OR UsedAmount > 0)", TIP)
    kullanilmis = cur.fetchone()[0]
    if kullanilmis:
        log(f"DURDU: {kullanilmis} çek KULLANILMIŞ görünüyor — silinmedi. "
            "Durumu Claude'a bildir.")
        conn.rollback()
        return

    cur.execute("DELETE FROM cdDiscountVoucher "
                "WHERE DiscountVoucherTypeCode = ?", TIP)
    log(f"  test çeki silindi: {cur.rowcount}")
    cur.execute("DELETE FROM cdDiscountVoucherTypeDesc "
                "WHERE DiscountVoucherTypeCode = ?", TIP)
    log(f"  açıklama silindi: {cur.rowcount}")
    cur.execute("DELETE FROM cdDiscountVoucherType "
                "WHERE DiscountVoucherTypeCode = ?", TIP)
    log(f"  tip silindi: {cur.rowcount}")
    conn.commit()
    log("\n>>> COMMIT EDİLDİ — sistem YÜKLE-1 öncesi haline döndü.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log("\nHATA — transaction otomatik geri alınır:")
        log(traceback.format_exc())
    try:
        with open("GERIAL1-CIKTI.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(OUT))
        print("\n>>> GERIAL1-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
