# -*- coding: utf-8 -*-
"""NEBIM YÜKLE-7 — KAMPANYAYI 'ÇEK KULLANMA' METODUNA ÇEVİR (YAZAR!).

IZLE3 kanıtı: POS HCKMP'yi tanıyor ama DiscountOfferStageCode=1
(çek KAZANMA) tarafında değerlendiriyor. Çek penceresi ise çek KULLANMA
kampanyası arıyor ve bulamıyor -> MSGCannotFindActiveDiscountOffer...

Bu script:
  1) Metod/aşama/tip tablolarını DÖKER (her hâlükârda)
  2) 'çek kullanma' metodunu KENDİ BULUR
  3) Emin olamazsa HİÇBİR ŞEY DEĞİŞTİRMEDEN durur
  4) Eminse: yedek alır -> kampanyanın metodunu çevirir ->
     sp_ActivatedDiscountOffers ile resmi aktivasyonu tekrar çalıştırır
     -> doğrular

Geri alma: GERIAL7
Cikti: YUKLE7-CIKTI.txt
"""
from __future__ import annotations

import traceback
from satis_kopru import load_config, connect

OUT = []
KOD = "HCKMP"


def log(*a):
    s = " ".join(str(x) for x in a)
    print(s)
    OUT.append(s)


def bolum(ad):
    log(f"\n=== {ad} ===")


def kolonlar(cur, tablo):
    cur.execute("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS "
                "WHERE TABLE_NAME = ? ORDER BY ORDINAL_POSITION", tablo)
    return [r[0] for r in cur.fetchall()]


def tablolar(cur, desen):
    cur.execute("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES "
                "WHERE TABLE_NAME LIKE ? ORDER BY TABLE_NAME", desen)
    return [r[0] for r in cur.fetchall()]


def dok(cur, sql, *p, sinir=40):
    cur.execute(sql, *p)
    kols = [d[0] for d in cur.description]
    satirlar = cur.fetchall()
    log(f"   kolonlar: {kols}")
    for r in satirlar[:sinir]:
        log("   · " + " | ".join(
            (str(x).strip() if x is not None else "-") for x in r)[:150])
    return [dict(zip(kols, r)) for r in satirlar]


def main():
    cfg = load_config()
    log(">>> YÜKLE-7 — kampanyayı 'çek kullanma' metoduna çevir")
    conn = connect(cfg)
    conn.autocommit = True
    cur = conn.cursor()

    # ── 1) MEVCUT DURUM ───────────────────────────────────────────
    bolum("1) HCKMP'NİN ŞU ANKİ HÂLİ")
    cur.execute("SELECT DiscountOfferTypeCode, DiscountOfferMethodCode, "
                "DiscountVoucherTypeCode, IsActive FROM cdDiscountOffer "
                "WHERE DiscountOfferCode = ?", KOD)
    r = cur.fetchone()
    if not r:
        log("DURDU: HCKMP kampanyası yok.")
        return
    tip, mevcut_metod, cektipi, aktif = (r[0], str(r[1]).strip(),
                                         str(r[2]).strip(), r[3])
    log(f"  tip={tip} | metod={mevcut_metod} | çek tipi={cektipi} "
        f"| aktif={aktif}")

    kr = kolonlar(cur, "prDiscountOfferRules")
    sec = [k for k in ("DiscountOfferStageCode", "DiscountOfferMethodCode",
                       "LineNumber", "UseItemListForUsing",
                       "ItemListCodeForUsing", "OnlyBeUsedOnce") if k in kr]
    log("  --- kural satırları:")
    dok(cur, f"SELECT {', '.join(sec)} FROM prDiscountOfferRules "
             f"WHERE DiscountOfferCode = N'{KOD}'")

    # ── 2) METOD TABLOLARI ────────────────────────────────────────
    bolum("2) METOD / TİP TABLOLARI (her hâlükârda dökülür)")
    metod_tablolari = [t for t in tablolar(cur, "%DiscountOfferMethod%")
                       if "Script" not in t]
    log(f"  metod tabloları: {metod_tablolari}")
    adaylar = {}
    for t in metod_tablolari:
        log(f"  --- {t}:")
        try:
            satirlar = dok(cur, f"SELECT TOP 40 * FROM {t} WITH(NOLOCK)")
        except Exception as e:
            log(f"   HATA {str(e)[:90]}")
            continue
        for d in satirlar:
            kod = None
            for k, v in d.items():
                if k.lower() == "discountoffermethodcode" and v:
                    kod = str(v).strip()
            if not kod:
                continue
            metin = " ".join(str(v) for v in d.values() if v is not None).lower()
            adaylar.setdefault(kod, "")
            adaylar[kod] += " " + metin

    for t in tablolar(cur, "%DiscountOfferType%")[:3]:
        log(f"  --- {t}:")
        try:
            dok(cur, f"SELECT TOP 20 * FROM {t} WITH(NOLOCK)")
        except Exception as e:
            log(f"   HATA {str(e)[:90]}")

    # ── 3) KULLANMA METODUNU BUL ──────────────────────────────────
    bolum("3) 'ÇEK KULLANMA' METODU SEÇİMİ")
    kullan, kazan = [], []
    for kod, metin in adaylar.items():
        kullanma = ("kullan" in metin or "use" in metin
                    or "harca" in metin or "spend" in metin)
        kazanma = ("kazan" in metin or "earn" in metin or "gain" in metin)
        cek = ("voucher" in metin or "çek" in metin or "cek" in metin)
        if not cek:
            continue
        if kullanma and not kazanma:
            kullan.append(kod)
        elif kazanma and not kullanma:
            kazan.append(kod)
    log(f"  çek KULLANMA adayları: {kullan}")
    log(f"  çek KAZANMA adayları : {kazan}")
    log(f"  kampanyanın şu anki metodu: {mevcut_metod} "
        f"({'KAZANMA' if mevcut_metod in kazan else ''}"
        f"{'KULLANMA' if mevcut_metod in kullan else ''}"
        f"{'sınıflandırılamadı' if mevcut_metod not in kazan + kullan else ''})")

    if mevcut_metod in kullan:
        log("\n>>> Metod ZATEN 'çek kullanma'. Değiştirilecek bir şey yok.")
        log(">>> Sorun başka yerde; yukarıdaki tablo dökümü analiz için yeterli.")
        return
    if len(kullan) != 1:
        log("\nDURDU: tek bir 'çek kullanma' metodu belirlenemedi "
            f"({len(kullan)} aday). HİÇBİR ŞEY DEĞİŞTİRİLMEDİ.")
        log(">>> Yukarıdaki döküm analiz için yeterli.")
        return
    hedef = kullan[0]
    log(f"\n>>> HEDEF METOD: {hedef}  (mevcut: {mevcut_metod})")

    # ── 4) YEDEK + DEĞİŞİKLİK ─────────────────────────────────────
    bolum("4) YEDEK VE DEĞİŞİKLİK")
    cur.execute(
        "IF OBJECT_ID('zzHCyedek_Metod') IS NULL "
        "CREATE TABLE zzHCyedek_Metod (Id int IDENTITY(1,1) PRIMARY KEY, "
        "Kod nvarchar(20), EskiMetod nvarchar(20), YedekTarihi datetime)")
    cur.execute("INSERT INTO zzHCyedek_Metod (Kod, EskiMetod, YedekTarihi) "
                "VALUES (?, ?, GETDATE())", KOD, mevcut_metod)
    log(f"  yedek alındı: {mevcut_metod}")

    cur.execute("UPDATE cdDiscountOffer SET DiscountOfferMethodCode = ? "
                "WHERE DiscountOfferCode = ?", hedef, KOD)
    log(f"  cdDiscountOffer.DiscountOfferMethodCode -> {hedef}")

    if "DiscountOfferMethodCode" in kr:
        cur.execute("UPDATE prDiscountOfferRules SET DiscountOfferMethodCode "
                    "= ? WHERE DiscountOfferCode = ?", hedef, KOD)
        log(f"  prDiscountOfferRules metodu -> {hedef}")

    # ── 5) RESMİ AKTİVASYON ───────────────────────────────────────
    bolum("5) RESMİ AKTİVASYON (prosedürler yeniden üretilir)")
    cur.execute("EXEC sp_ActivatedDiscountOffers @UserName=N'Sc', "
                "@DiscountOfferCode=N'HCKMP'")
    try:
        while cur.nextset():
            pass
    except Exception:
        pass
    log("  tamamlandı.")

    # ── 6) DOĞRULAMA ──────────────────────────────────────────────
    bolum("6) DOĞRULAMA")
    cur.execute("SELECT DiscountOfferMethodCode, IsActive FROM cdDiscountOffer "
                "WHERE DiscountOfferCode = ?", KOD)
    r2 = cur.fetchone()
    log(f"  metod={str(r2[0]).strip()} | aktif={r2[1]}")
    cur.execute("SELECT COUNT(*) FROM prDiscountOfferLocation "
                "WHERE DiscountOfferCode = ?", KOD)
    log(f"  lokasyon satırı: {cur.fetchone()[0]}")
    for ad in ("qry_GetDiscountOfferProducts_R_1",
               "qry_GetDiscountOfferProducts_R_2"):
        cur.execute("SELECT o.modify_date, CASE WHEN m.definition LIKE "
                    "'%HCKMP%' THEN 1 ELSE 0 END FROM sys.sql_modules m "
                    "JOIN sys.objects o ON o.object_id = m.object_id "
                    "WHERE o.name = ?", ad)
        r3 = cur.fetchone()
        log(f"  {ad}: üretim={r3[0]} | HCKMP={bool(r3[1])}")

    log("\n>>> POS'u KAPATIP AÇIN, yeni fiş + ürün + çek deneyin.")
    log(">>> Geri almak için: GERIAL7")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log("\nHATA:")
        log(traceback.format_exc())
    try:
        with open("YUKLE7-CIKTI.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(OUT))
        print("\n>>> YUKLE7-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
