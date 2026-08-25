# -*- coding: utf-8 -*-
"""NEBIM YÜKLE-1B — POS varsayılan çek tipini 'HC' yapar (YAZAR!).

SADECE POS testi "çek bulunamadı / tip seçilemiyor" derse çalıştırılır.
dfGlobalDefault.DiscountVoucherTypeCode alanı şu an BOŞ; 'HC' yazılır.
Başka HİÇBİR alana dokunmaz. Geri almak için: GERIAL1B.bat
Cikti: YUKLE1B-CIKTI.txt
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
    log(">>> YÜKLE-1B — dfGlobalDefault.DiscountVoucherTypeCode -> 'HC'")
    conn = connect(cfg)
    conn.autocommit = False
    cur = conn.cursor()

    cur.execute("SELECT DiscountVoucherTypeCode FROM dfGlobalDefault")
    mevcut = [str(r[0]).strip() for r in cur.fetchall()]
    log(f"  mevcut değer(ler): {mevcut}")
    if any(m not in ("", "HC") for m in mevcut):
        log("DURDU: alan boş değil ve HC de değil — durumu bildir.")
        conn.rollback()
        return

    cur.execute("UPDATE dfGlobalDefault SET DiscountVoucherTypeCode = 'HC' "
                "WHERE LTRIM(RTRIM(DiscountVoucherTypeCode)) = ''")
    log(f"  güncellenen satır: {cur.rowcount}")
    cur.execute("SELECT DiscountVoucherTypeCode FROM dfGlobalDefault")
    yeni = [str(r[0]).strip() for r in cur.fetchall()]
    if all(v == "HC" for v in yeni):
        conn.commit()
        log(f"  yeni değer(ler): {yeni}")
        log("\n>>> COMMIT EDİLDİ — POS'u kapatıp açın, çeki tekrar deneyin.")
    else:
        conn.rollback()
        log("\n>>> BEKLENMEDİK DURUM — geri alındı, durumu bildir.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log("\nHATA — transaction otomatik geri alınır:")
        log(traceback.format_exc())
    try:
        with open("YUKLE1B-CIKTI.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(OUT))
        print("\n>>> YUKLE1B-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
