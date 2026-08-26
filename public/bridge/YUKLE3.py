# -*- coding: utf-8 -*-
"""NEBIM YÜKLE-3 — Hediye Çeki KULLANIM KAMPANYASI + geçerli ürün listesi (YAZAR!).

Ne yapar (TEK transaction):
  1) 'HCGECERLI' ürün listesi: POS'ta satılan tüm ürünler HARİÇ
     - Alt Grup aksesuarları: ÇORAP/CORAP, CÜZDAN/CUZDAN, KEMER, KARTLIK,
       DERİ BAKIM, SPREY, SÜNGER/SUNGER, FIRÇA, AYAKKABI DEODORANT
     - Adında BLİNK/BLINK geçen veya kodu B- ile başlayan ürünler
     - TSF1499 (outlet) + TSF70 (%70 tasfiye) listelerindeki ürünler
  2) 'HCKMP' kampanyası: tip=3 (İndirim Çeki), metod=DefV01
     (İndirim Çeki Kazan/Kullan), çek tipi=HC, 3 mağaza + merkez
  3) Kullanım kuralı: yalnız HCGECERLI ürünlerde, her ödeme tipiyle
     geçerli, fişte bir kez
Mevcut HİÇBİR kayda dokunmaz — yalnız yeni satır ekler.
Geri almak için: GERIAL3.bat
Cikti: YUKLE3-CIKTI.txt
"""
from __future__ import annotations

import traceback
from satis_kopru import load_config, connect

OUT = []
KMP = "HCKMP"
LISTE = "HCGECERLI"
TIP = "HC"

AKSESUAR = ["ÇORAP", "CORAP", "CÜZDAN", "CUZDAN", "KEMER", "KARTLIK",
            "DERİ BAKIM", "SPREY", "SÜNGER", "SUNGER", "FIRÇA",
            "AYAKKABI DEODORANT"]


def log(*a):
    s = " ".join(str(x) for x in a)
    print(s)
    OUT.append(s)


def kolonlar(cur, tablo):
    cur.execute("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS "
                "WHERE TABLE_NAME = ?", tablo)
    return {r[0] for r in cur.fetchall()}


def main():
    cfg = load_config()
    log(">>> YÜKLE-3 — kullanım kampanyası + geçerli ürün listesi")
    conn = connect(cfg)
    conn.autocommit = False
    cur = conn.cursor()

    # ── 0) ÖN KONTROLLER ─────────────────────────────────────────────
    log("\n--- 0) Ön kontrol")
    pa = kolonlar(cur, "prItemAttribute")
    if not {"ItemCode", "AttributeTypeCode", "AttributeCode"} <= pa:
        log(f"DURDU: prItemAttribute kolonları beklenenden farklı: {sorted(pa)}")
        conn.rollback()
        return
    cur.execute("SELECT COUNT(*) FROM cdDiscountOffer WHERE DiscountOfferCode=?", KMP)
    if cur.fetchone()[0]:
        log(f"DURDU: '{KMP}' kampanyası zaten var.")
        conn.rollback()
        return
    cur.execute("SELECT COUNT(*) FROM cdItemList WHERE ItemListCode=?", LISTE)
    if cur.fetchone()[0]:
        log(f"DURDU: '{LISTE}' listesi zaten var.")
        conn.rollback()
        return
    cur.execute("SELECT COUNT(*) FROM cdDiscountVoucherType "
                "WHERE DiscountVoucherTypeCode=?", TIP)
    if cur.fetchone()[0] != 1:
        log("DURDU: HC çek tipi yok (önce YUKLE1).")
        conn.rollback()
        return
    for lst in ("TSF1499", "TSF70"):
        cur.execute("SELECT COUNT(*) FROM prItemListContent WHERE ItemListCode=?", lst)
        log(f"  hariç listesi {lst}: {cur.fetchone()[0]} ürün")
    log("  Ön kontrol TEMİZ.")

    # ── 1) ÜRÜN LİSTESİ ──────────────────────────────────────────────
    log("\n--- 1) HCGECERLI listesi kuruluyor")
    cur.execute("INSERT INTO cdItemList (ItemListCode, ItemTypeCode, IsBlocked) "
                "VALUES (?, 1, 0)", LISTE)
    cur.execute("INSERT INTO cdItemListDesc (ItemListCode, LangCode, "
                "ItemListDescription) VALUES (?, 'TR', "
                "N'HEDIYE CEKI GECERLI URUNLER')", LISTE)
    aks = ",".join(f"N'{a}'" for a in AKSESUAR)
    cur.execute(f"""
        INSERT INTO prItemListContent (ItemListCode, ItemTypeCode, ItemCode, ColorCode)
        SELECT ?, 1, i.ItemCode, N''
        FROM cdItem i
        WHERE i.ItemTypeCode = 1 AND i.IsBlocked = 0 AND i.UsePOS = 1
          AND NOT EXISTS (SELECT 1 FROM prItemAttribute pa
                          WHERE pa.ItemCode = i.ItemCode
                            AND pa.AttributeTypeCode = 18
                            AND pa.AttributeCode IN ({aks}))
          AND NOT EXISTS (SELECT 1 FROM cdItemDesc d
                          WHERE d.ItemCode = i.ItemCode
                            AND (UPPER(d.ItemDescription) LIKE N'%BLİNK%'
                                 OR UPPER(d.ItemDescription) LIKE N'%BLINK%'))
          AND i.ItemCode NOT LIKE N'B-%'
          AND NOT EXISTS (SELECT 1 FROM prItemListContent x
                          WHERE x.ItemListCode IN (N'TSF1499', N'TSF70')
                            AND x.ItemCode = i.ItemCode)
        """, LISTE)
    log(f"  listeye giren ürün: {cur.rowcount}")
    cur.execute("SELECT COUNT(*) FROM cdItem WHERE ItemTypeCode=1 "
                "AND IsBlocked=0 AND UsePOS=1")
    log(f"  (POS'taki toplam ürün: {cur.fetchone()[0]} — fark = hariç tutulanlar)")

    # ── 2) KAMPANYA ──────────────────────────────────────────────────
    log("\n--- 2) HCKMP kampanyası kuruluyor")
    cur.execute("""
        INSERT INTO cdDiscountOffer (
            DiscountOfferCode, DiscountOfferTypeCode, DiscountOfferMethodCode,
            ProcessCode, CurrAccTypeCode, DiscountVoucherTypeCode,
            DiscountOfferApplyCode, Priority, Description, IsActive, IsBlocked)
        VALUES (?, 3, 'DefV01', 'R', 4, ?, 1, 5,
                N'DERIMOD HEDIYE CEKI KULLANIMI', 1, 0)
        """, KMP, TIP)
    cur.execute("INSERT INTO cdDiscountOfferDesc (DiscountOfferCode, LangCode, "
                "DiscountOfferDescription) VALUES (?, 'TR', "
                "N'DERIMOD HEDIYE CEKI KULLANIMI')", KMP)
    log("  kampanya + açıklama eklendi (tip=İndirim Çeki, metod=DefV01, çek tipi=HC).")

    # ── 3) KURAL (kullanım aşaması) ─────────────────────────────────
    cur.execute("""
        INSERT INTO prDiscountOfferRules (
            DiscountOfferCode, DiscountOfferStageCode, TimePeriodCode,
            UseItemListForUsing, ItemListCodeForUsing,
            IsValidWithOtherInstantDiscounts, OnlyBeUsedOnce,
            IsValidCashPayments, IsValidCreditCardPayments,
            IsValidGiftCardPayments, IsValidCreditVoucherPayments,
            IsValidRemittanceAndEFTPayments, IsValidAdvancePayments,
            IsValidOtherPayments)
        VALUES (?, 2, '2050', 1, ?, 1, 1, 1, 1, 1, 1, 1, 1, 1)
        """, KMP, LISTE)
    log(f"  kullanım kuralı eklendi (yalnız {LISTE}, fişte bir kez).")

    # ── 4) LOKASYONLAR ───────────────────────────────────────────────
    lokasyonlar = [("M", ""), ("S01", ""), ("S01", "S01"), ("S02", ""),
                   ("S02", "S02"), ("S03", ""), ("S03", "S03")]
    n = 0
    for stage in (1, 2):
        for ofis, magaza in lokasyonlar:
            cur.execute(
                "INSERT INTO prDiscountOfferLocation (ProcessCode, "
                "DiscountOfferCode, DiscountOfferStageCode, CompanyCode, "
                "OfficeCode, StoreTypeCode, StoreCode) "
                "VALUES ('R', ?, ?, 1, ?, 5, ?)", KMP, stage, ofis, magaza)
            n += 1
    log(f"  lokasyon kayıtları: {n} (merkez + 3 mağaza × 2 aşama)")

    # ── 5) DOĞRULAMA ─────────────────────────────────────────────────
    log("\n--- 5) Doğrulama")
    sayilar = {}
    for t, kosul, p in (("cdDiscountOffer", "DiscountOfferCode=?", KMP),
                        ("prDiscountOfferRules", "DiscountOfferCode=?", KMP),
                        ("prDiscountOfferLocation", "DiscountOfferCode=?", KMP),
                        ("prItemListContent", "ItemListCode=?", LISTE)):
        cur.execute(f"SELECT COUNT(*) FROM [{t}] WHERE {kosul}", p)
        sayilar[t] = cur.fetchone()[0]
        log(f"  {t}: {sayilar[t]}")
    if (sayilar["cdDiscountOffer"] == 1 and sayilar["prDiscountOfferRules"] == 1
            and sayilar["prDiscountOfferLocation"] == 14
            and sayilar["prItemListContent"] > 5000):
        conn.commit()
        log("\n>>> COMMIT EDİLDİ — kampanya AKTİF. POS'u kapatıp açın, "
            "geçerli ürünle satış deneyin.")
    else:
        conn.rollback()
        log("\n>>> SAYILAR TUTMADI — her şey GERİ ALINDI.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log("\nHATA — transaction otomatik geri alınır (commit edilmedi):")
        log(traceback.format_exc())
    try:
        with open("YUKLE3-CIKTI.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(OUT))
        print("\n>>> YUKLE3-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
