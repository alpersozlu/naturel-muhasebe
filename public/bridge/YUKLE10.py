# -*- coding: utf-8 -*-
"""NEBIM YÜKLE-10 — ANINDA İNDİRİM KAMPANYALARINA "ÇEKLE BİRLİKTE GEÇERLİ" (YAZAR!).

DLL kanıtı (DiscountOfferImplementer.IsValidWith): çek, üründeki mevcut
kampanya kuralında IsValidWithOtherDiscountVouchers=1 değilse o ürüne
uygulanamaz. IND ve UNI2054'te bu bayrak 0 → her denemede hata.

Bu script:
  1) Aktif tüm ANINDA İNDİRİM (tip 1) kampanyalarını ve bayrağı listeler
  2) Yalnız HEDEF listesindeki kampanyaların kural satırlarında bayrağı 1 yapar
     (eski değer zzHCyedek_Kural'a yazılır)
  3) Doğrular. Aktivasyon TEKRAR ÇALIŞTIRILMAZ (bayrak canlı okunur).
%60HAZ26 / TSF1499 bilerek DIŞARIDA: %60-70 ve outlet ürünlerde çek geçmez.
Geri alma: GERIAL10
Cikti: YUKLE10-CIKTI.txt
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
    log(">>> YÜKLE-10 — anında indirim kampanyalarına 'çekle birlikte geçerli'")
    conn = connect(cfg)
    conn.autocommit = True
    cur = conn.cursor()

    log("\n=== 1) AKTİF ANINDA-İNDİRİM KAMPANYALARI VE BAYRAK ===")
    cur.execute(f"""
        SELECT o.DiscountOfferCode, o.IsActive, r.DiscountOfferStageCode, r.{BAYRAK},
               r.IsValidWithOtherInstantDiscounts
        FROM cdDiscountOffer o WITH(NOLOCK)
        JOIN prDiscountOfferRules r WITH(NOLOCK) ON r.DiscountOfferCode = o.DiscountOfferCode
        WHERE o.IsActive = 1 AND o.DiscountOfferTypeCode = 1
        ORDER BY o.DiscountOfferCode, r.DiscountOfferStageCode
        """)
    for r in cur.fetchall():
        kod = str(r[0]).strip()
        isaret = "  <<< AÇILACAK" if kod in HEDEF else ""
        log(f"  {kod:12} st{r[2]} | {BAYRAK}={r[3]} | InstantDisc={r[4]}{isaret}")

    log("\n=== 2) YEDEK + DEĞİŞİKLİK ===")
    cur.execute("IF OBJECT_ID('zzHCyedek_Kural') IS NULL CREATE TABLE zzHCyedek_Kural "
                "(Id int IDENTITY(1,1) PRIMARY KEY, Kod nvarchar(20), Alan nvarchar(60), "
                "EskiDeger nvarchar(200), YedekTarihi datetime)")
    toplam = 0
    for kod in HEDEF:
        cur.execute(f"SELECT DiscountOfferStageCode, {BAYRAK} FROM prDiscountOfferRules "
                    f"WHERE DiscountOfferCode = ?", kod)
        satirlar = cur.fetchall()
        if not satirlar:
            log(f"  {kod}: kural satırı YOK, atlandı")
            continue
        for st, eski in satirlar:
            cur.execute("INSERT INTO zzHCyedek_Kural (Kod, Alan, EskiDeger, YedekTarihi) "
                        "VALUES (?, ?, ?, GETDATE())", kod, f"{BAYRAK}@{st}", str(int(bool(eski))))
        cur.execute(f"UPDATE prDiscountOfferRules SET {BAYRAK} = 1 WHERE DiscountOfferCode = ?", kod)
        log(f"  {kod}: {cur.rowcount} kural satırında {BAYRAK} -> 1 "
            f"(eski: {[int(bool(e)) for _, e in satirlar]})")
        toplam += cur.rowcount

    log("\n=== 3) DOĞRULAMA ===")
    cur.execute(f"SELECT DiscountOfferCode, DiscountOfferStageCode, {BAYRAK} "
                f"FROM prDiscountOfferRules WITH(NOLOCK) WHERE DiscountOfferCode IN "
                f"(N'IND', N'UNI2054', N'HCKMP', N'%60HAZ26') ORDER BY 1, 2")
    for r in cur.fetchall():
        log(f"  {str(r[0]).strip():10} st{r[1]} | {BAYRAK}={r[2]}")
    log(f"\n  değişen satır: {toplam}")
    log(">>> POS'u KAPATIP AÇIN → yeni fiş (1.000 TL üstü, %20 kampanyalı ürün olabilir)")
    log(">>> Ödeme → İşlemler → İndirim Çeki Kullan → tip listesi → 2900500099956")
    log(">>> Geri almak için: GERIAL10")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log("\nHATA:")
        log(traceback.format_exc())
    try:
        with open("YUKLE10-CIKTI.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(OUT))
        print("\n>>> YUKLE10-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
