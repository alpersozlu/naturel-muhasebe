# -*- coding: utf-8 -*-
"""NEBIM YÜKLE-6 — HAMİLİNE ÇEK KAPISI (YAZAR!).

POS, çek penceresini açmadan önce sp_ValidateDiscountVoucherCustomer'ı
çağırıyor. O prosedür çeki MÜŞTERİYE BAĞLI sayıyor:
    WHERE CustomerTypeCode = @CurrAccTypeCode
      AND CustomerCode     = @CurrAccCode
Bizim çekler hamiline (CustomerCode boş) → Permit=0 → POS duruyor.

Bu script o koşulu şuna çevirir:
    WHERE ( (CustomerTypeCode = @CurrAccTypeCode AND
             CustomerCode = @CurrAccCode)
            OR EXISTS (cdDiscountVoucherType.IsBearerVoucher = 1) )

Yani müşteriye bağlı çekler AYNEN çalışır; tipi HAMİLİNE işaretli çekler
müşteri şartı aranmadan geçer (Nebim'in kendi bayrağının anlamı).

Orijinal tanım zzHCyedek_Proc'a yedeklenir. Geri alma: GERIAL6.
Cikti: YUKLE6-CIKTI.txt
"""
from __future__ import annotations

import re
import traceback
from satis_kopru import load_config, connect

OUT = []
PROC = "sp_ValidateDiscountVoucherCustomer"
ESKI = (r"WHERE\s+cdDiscountVoucher\.CustomerTypeCode\s*=\s*@CurrAccTypeCode"
        r"\s+AND\s+cdDiscountVoucher\.CustomerCode\s*=\s*@CurrAccCode")
YENI = (
    "WHERE ( ( cdDiscountVoucher.CustomerTypeCode = @CurrAccTypeCode\n"
    "          AND cdDiscountVoucher.CustomerCode = @CurrAccCode )\n"
    "        OR EXISTS ( SELECT 1 FROM cdDiscountVoucherType hcTip "
    "WITH(NOLOCK)\n"
    "                    WHERE hcTip.DiscountVoucherTypeCode = "
    "cdDiscountVoucher.DiscountVoucherTypeCode\n"
    "                      AND hcTip.IsBearerVoucher = 1 ) )")
IMZA = "hcTip.IsBearerVoucher = 1"


def log(*a):
    s = " ".join(str(x) for x in a)
    print(s)
    OUT.append(s)


def tanim(cur):
    cur.execute("SELECT OBJECT_DEFINITION(OBJECT_ID(?))", PROC)
    r = cur.fetchone()
    return (r[0] or "") if r else ""


def dene(cur, etiket):
    """POS'un çağırdığı gibi çağır: müşteri tipi 4, kod '12-4-1'."""
    for tip, cari in ((4, "12-4-1"), (4, "12-4-10")):
        try:
            cur.execute(f"EXEC {PROC} @CurrAccTypeCode=?, @CurrAccCode=?",
                        tip, cari)
            r = cur.fetchone()
            log(f"  {etiket} ({tip}, '{cari}') -> Permit={r[0]} | {r[2]}"
                if r else f"  {etiket} ({tip}, '{cari}') -> sonuç yok")
        except Exception as e:
            log(f"  {etiket} ({tip}, '{cari}') -> HATA {str(e)[:110]}")


def main():
    cfg = load_config()
    log(">>> YÜKLE-6 — hamiline çek kapısı")
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

    log("\n--- ÖNCE (POS bu cevabı alıyor):")
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

    log(f"\n--- doğrulama: yeni koşul prosedürde var mı: "
        f"{'EVET ✓' if IMZA in tanim(cur) else 'HAYIR ✗'}")

    log("\n--- SONRA (POS artık bu cevabı alacak):")
    dene(cur, "  sonra")

    log("\n>>> Beklenen: Permit=1")
    log(">>> 1 görüyorsanız POS'u KAPATIP AÇIN, yeni fiş açıp çeki deneyin.")
    log(">>> Geri almak için: GERIAL6")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log("\nHATA:")
        log(traceback.format_exc())
    try:
        with open("YUKLE6-CIKTI.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(OUT))
        print("\n>>> YUKLE6-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
