# -*- coding: utf-8 -*-
"""NEBIM YÜKLE-5 — HAMİLİNE ÇEK İSTİSNASI (YAZAR!).

qry_GetDiscountVouchersByDiscountOfferCode prosedüründeki
    AND CustomerCode = @CurrAccCode
koşulunu
    AND (CustomerCode = @CurrAccCode OR CustomerCode = SPACE(0)
         OR CustomerCode IS NULL)
yapar. Müşteriye bağlı çeklerin davranışı AYNEN korunur; sahibi yazmayan
(hamiline) çekler de listeye girer.

Orijinal tanım zzHCyedek_Proc tablosuna yedeklenir. Geri alma: GERIAL5.
Cikti: YUKLE5-CIKTI.txt
"""
from __future__ import annotations

import re
import traceback
from satis_kopru import load_config, connect

OUT = []
PROC = "qry_GetDiscountVouchersByDiscountOfferCode"
ESKI = r"AND\s+CustomerCode\s*=\s*@CurrAccCode"
YENI = ("AND (CustomerCode = @CurrAccCode OR CustomerCode = SPACE(0) "
        "OR CustomerCode IS NULL)")
IMZA = "SPACE(0) OR CustomerCode IS NULL"


def log(*a):
    s = " ".join(str(x) for x in a)
    print(s)
    OUT.append(s)


def tanim(cur):
    cur.execute("SELECT OBJECT_DEFINITION(OBJECT_ID(?))", PROC)
    r = cur.fetchone()
    return (r[0] or "") if r else ""


def dene(cur, etiket):
    """Prosedürü POS gibi çağır: müşteri kodlu ve kodsuz."""
    for cari in ("12-4-10", ""):
        try:
            cur.execute(
                "DECLARE @d date = CAST(GETDATE() AS date); "
                f"EXEC {PROC} @DiscountOfferCodes=?, @CurrAccTypeCode=?, "
                "@CurrAccCode=?, @CurrentDate=@d", "HCKMP", 4, cari)
            n = len(cur.fetchall())
            log(f"  {etiket} cari='{cari}' -> {n} çek")
        except Exception as e:
            log(f"  {etiket} cari='{cari}' -> HATA {str(e)[:110]}")


def main():
    cfg = load_config()
    log(">>> YÜKLE-5 — hamiline çek istisnası")
    conn = connect(cfg)
    conn.autocommit = True
    cur = conn.cursor()

    eski = tanim(cur)
    if not eski:
        log("DURDU: prosedür bulunamadı.")
        return

    if IMZA in eski:
        log("DURDU: değişiklik ZATEN uygulanmış. Mevcut durum:")
        dene(cur, "mevcut")
        return

    bulunan = re.findall(ESKI, eski, flags=re.I)
    log(f"\n--- hedef koşul bulundu mu: {len(bulunan)} adet")
    if len(bulunan) != 1:
        log("DURDU: koşul tam 1 kez geçmiyor, güvenli değil. "
            "Hiçbir şey değiştirilmedi.")
        return

    log("\n--- ÖNCE (mevcut davranış):")
    dene(cur, "  önce")

    log("\n--- yedekleniyor: zzHCyedek_Proc")
    cur.execute(
        "IF OBJECT_ID('zzHCyedek_Proc') IS NULL "
        "CREATE TABLE zzHCyedek_Proc ("
        "Id int IDENTITY(1,1) PRIMARY KEY, Ad nvarchar(200), "
        "Tanim nvarchar(max), YedekTarihi datetime)")
    cur.execute("INSERT INTO zzHCyedek_Proc (Ad, Tanim, YedekTarihi) "
                "VALUES (?, ?, GETDATE())", PROC, eski)
    cur.execute("SELECT COUNT(*) FROM zzHCyedek_Proc WHERE Ad = ?", PROC)
    log(f"  yedek satırı: {cur.fetchone()[0]}")

    yeni = re.sub(ESKI, YENI, eski, count=1, flags=re.I)
    yeni = re.sub(r"CREATE\s+PROCEDURE", "ALTER PROCEDURE", yeni, count=1,
                  flags=re.I)
    if "ALTER PROCEDURE" not in yeni.upper()[:400]:
        log("DURDU: CREATE PROCEDURE başlığı bulunamadı.")
        return

    log("\n--- prosedür güncelleniyor...")
    cur.execute(yeni)
    log("  uygulandı.")

    kontrol = tanim(cur)
    log(f"\n--- doğrulama: yeni koşul prosedürde var mı: "
        f"{'EVET ✓' if IMZA in kontrol else 'HAYIR ✗'}")

    log("\n--- SONRA (yeni davranış):")
    dene(cur, "  sonra")

    log("\n>>> Beklenen: cari='12-4-10' satırı artık 15 çek göstermeli.")
    log(">>> 15 görüyorsanız POS'ta YENİ FİŞ açıp çeki deneyin.")
    log(">>> Geri almak için: GERIAL5")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log("\nHATA:")
        log(traceback.format_exc())
    try:
        with open("YUKLE5-CIKTI.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(OUT))
        print("\n>>> YUKLE5-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
