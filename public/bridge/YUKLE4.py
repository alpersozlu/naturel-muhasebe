# -*- coding: utf-8 -*-
"""NEBIM YÜKLE-4 — RESMİ AKTİVASYON ZİNCİRİ (YAZAR!).

MERT'in 'Aktifle' düğmesinin çalıştırdığı resmi prosedürü HCKMP için
çalıştırır: EXEC sp_ActivatedDiscountOffers 'HCKMP'.
Bu, POS'un kampanya listesini besleyen qry_GetDiscountOfferProducts_R_1/R_2
prosedürlerini AKTİF kampanyalara göre YENİDEN ÜRETİR (HCKMP dahil).
Başarı kanıtı: üretilen prosedür metninde HCKMP/HCGECERLI aranır.
Cikti: YUKLE4-CIKTI.txt
"""
from __future__ import annotations

import traceback
from satis_kopru import load_config, connect

OUT = []


def log(*a):
    s = " ".join(str(x) for x in a)
    print(s)
    OUT.append(s)


def durum(cur, etiket):
    log(f"\n--- {etiket}")
    cur.execute("SELECT COUNT(*) FROM prDiscountOfferLocation "
                "WHERE DiscountOfferCode='HCKMP'")
    log(f"  HCKMP lokasyon satırı: {cur.fetchone()[0]}")
    cur.execute("SELECT COUNT(*) FROM prDiscountOfferProduct")
    log(f"  prDiscountOfferProduct: {cur.fetchone()[0]}")
    cur.execute("SELECT COUNT(*) FROM prDiscountOfferCustomer")
    log(f"  prDiscountOfferCustomer: {cur.fetchone()[0]}")
    for ad in ("qry_GetDiscountOfferProducts_R_1", "qry_GetDiscountOfferProducts_R_2"):
        cur.execute("SELECT modify_date FROM sys.objects WHERE name = ?", ad)
        r = cur.fetchone()
        log(f"  {ad} son değişiklik: {r[0] if r else 'YOK'}")
        cur.execute("SELECT COUNT(*) FROM sys.sql_modules m "
                    "JOIN sys.objects o ON o.object_id = m.object_id "
                    "WHERE o.name = ? AND (m.definition LIKE '%HCKMP%' "
                    "   OR m.definition LIKE '%HCGECERLI%')", ad)
        log(f"    içinde HCKMP/HCGECERLI geçiyor mu: "
            f"{'EVET' if cur.fetchone()[0] else 'HAYIR'}")


def main():
    cfg = load_config()
    log(">>> YÜKLE-4 — resmi aktivasyon zinciri (HCKMP)")
    conn = connect(cfg)
    conn.autocommit = True
    cur = conn.cursor()

    cur.execute("SELECT COUNT(*) FROM cdDiscountOffer "
                "WHERE DiscountOfferCode='HCKMP' AND IsActive=1")
    if cur.fetchone()[0] != 1:
        log("DURDU: HCKMP yok/aktif değil.")
        return

    durum(cur, "ÖNCE")

    log("\n--- sp_ActivatedDiscountOffers çalıştırılıyor (birkaç saniye)...")
    cur.execute("EXEC sp_ActivatedDiscountOffers @UserName=N'Sc', "
                "@DiscountOfferCode=N'HCKMP'")
    # prosedür kendi transaction'larını yönetir; sonuç kümeleri olabilir
    try:
        while cur.nextset():
            pass
    except Exception:
        pass
    log("  tamamlandı.")

    durum(cur, "SONRA")
    log("\n>>> 'HCKMP/HCGECERLI: EVET' görüyorsanız İŞ TAMAM — "
        "POS'u kapatıp açın ve çeki deneyin!")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log("\nHATA:")
        log(traceback.format_exc())
    try:
        with open("YUKLE4-CIKTI.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(OUT))
        print("\n>>> YUKLE4-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
