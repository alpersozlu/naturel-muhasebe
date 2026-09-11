# -*- coding: utf-8 -*-
"""NEBIM YÜKLE-11 — HC ÇEK TİPİNDE PROVİZYONU AÇ (YAZAR!).

DLL kanıtı (UseDiscountVoucherItem.SetSerialNumber): IsProvisionRequired=0 iken
motor çek kaydını HİÇ okumaz, tutarı tutar-kuralı basamağından alır (1.000).
IsProvisionRequired=1 iken çeki yükler, ÇEKİN KENDİ TUTARINI kullanır (500),
kalan bakiye + tek-kullanım kontrolü yapar; hamiline tipte müşteri kontrolünü
atlar (DiscountVoucher.ValidateCustomer).

Bu script: cdDiscountVoucherType 'HC' → IsProvisionRequired = 1
(eski değer zzHCyedek_Kural'a yazılır). Geri alma: GERIAL11.
Cikti: YUKLE11-CIKTI.txt
"""
from __future__ import annotations

import traceback
from satis_kopru import load_config, connect

OUT = []
TIP = "HC"
ALANLAR = ["IsProvisionRequired", "IsV3Provision", "IsWebServiceProvision",
           "IsBearerVoucher", "IsDisposable", "CannotChangeVoucherAmount",
           "UseRecordedVouchers"]


def log(*a):
    s = " ".join(str(x) for x in a)
    print(s)
    OUT.append(s)


def durum(cur, etiket):
    cur.execute(f"SELECT {', '.join(ALANLAR)} FROM cdDiscountVoucherType "
                f"WITH(NOLOCK) WHERE DiscountVoucherTypeCode = ?", TIP)
    r = cur.fetchone()
    log(f"  {etiket}: " + " | ".join(f"{a}={v}" for a, v in zip(ALANLAR, r)))
    return dict(zip(ALANLAR, r))


def main():
    cfg = load_config()
    log(">>> YÜKLE-11 — HC çek tipinde provizyonu aç")
    conn = connect(cfg)
    conn.autocommit = True
    cur = conn.cursor()

    log("\n=== 1) ÖNCE ===")
    onceki = durum(cur, "önce")
    if onceki["IsProvisionRequired"]:
        log("\nDURDU: IsProvisionRequired zaten 1. Değişiklik yok.")
        return

    log("\n=== 2) YEDEK + DEĞİŞİKLİK ===")
    cur.execute("IF OBJECT_ID('zzHCyedek_Kural') IS NULL CREATE TABLE zzHCyedek_Kural "
                "(Id int IDENTITY(1,1) PRIMARY KEY, Kod nvarchar(20), Alan nvarchar(60), "
                "EskiDeger nvarchar(200), YedekTarihi datetime)")
    cur.execute("INSERT INTO zzHCyedek_Kural (Kod, Alan, EskiDeger, YedekTarihi) "
                "VALUES (?, ?, ?, GETDATE())", TIP, "cdDiscountVoucherType.IsProvisionRequired",
                str(int(bool(onceki["IsProvisionRequired"]))))
    cur.execute("UPDATE cdDiscountVoucherType SET IsProvisionRequired = 1, "
                "LastUpdatedUserName = N'Sc', LastUpdatedDate = GETDATE() "
                "WHERE DiscountVoucherTypeCode = ?", TIP)
    log(f"  güncellenen satır: {cur.rowcount}")

    log("\n=== 3) SONRA ===")
    durum(cur, "sonra")
    log("\n>>> POS'u KAPATIP AÇIN → yeni fiş → İndirim Çeki Kullan → 2900500099956")
    log(">>> Beklenen: Kullanılabilir Tutar 500,00")
    log(">>> Geri almak için: GERIAL11")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log("\nHATA:")
        log(traceback.format_exc())
    try:
        with open("YUKLE11-CIKTI.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(OUT))
        print("\n>>> YUKLE11-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
