# -*- coding: utf-8 -*-
"""NEBIM YÜKLE-2 — BASILI 3.000 hediye çekinin serileri (YAZAR!).

Matbaada basılan çeklerin numaralarını 'HC' tipine kaydeder:
  500 TL: sıra 1–1000  (2900500000013 … 2900500010005)  MinAmount 1000
  750 TL: sıra 1–1000  (2900700000011 … 2900700010003)  MinAmount 1500
 1000 TL: sıra 1–1000  (2901000000015 … 2901000010007)  MinAmount 2000

Numaralar script içinde matbaadakiyle AYNI algoritmayla üretilir ve ilk/son
numaralar sabit beklenen değerlerle KARŞILAŞTIRILIR — uyuşmazsa hiçbir şey
yazılmadan durur. TEK transaction; sayım tutmazsa otomatik ROLLBACK.

ÖN ŞART: YUKLE1 çalışmış ve POS testi GEÇMİŞ olmalı.
Cikti: YUKLE2-CIKTI.txt
"""
from __future__ import annotations

import traceback
from satis_kopru import load_config, connect

OUT = []
TIP = "HC"
ADET = 1000

BEKLENEN = {  # küpür kodu -> (ilk, son, tutar)
    "05": ("2900500000013", "2900500010005", 500),
    "07": ("2900700000011", "2900700010003", 750),
    "10": ("2901000000015", "2901000010007", 1000),
}


def log(*a):
    s = " ".join(str(x) for x in a)
    print(s)
    OUT.append(s)


def kontrol_hanesi(oniki: str) -> str:
    toplam = sum(int(d) * (3 if i % 2 else 1) for i, d in enumerate(oniki))
    return str((10 - toplam % 10) % 10)


def barkod_no(kupur: str, sira: int) -> str:
    govde = f"290{kupur}{sira:07d}"
    return govde + kontrol_hanesi(govde)


def main():
    # ── seri üretimi + sabit değer doğrulaması ───────────────────────
    seriler = []
    for kupur, (ilk, son, tutar) in BEKLENEN.items():
        nolar = [barkod_no(kupur, i) for i in range(1, ADET + 1)]
        if nolar[0] != ilk or nolar[-1] != son:
            log(f"DURDU: {kupur} serisi beklenenle uyuşmuyor "
                f"({nolar[0]}/{nolar[-1]} != {ilk}/{son}). HİÇBİR ŞEY YAZILMADI.")
            return
        seriler += [(n, tutar) for n in nolar]
    log(f">>> YÜKLE-2 — {len(seriler)} basılı çek serisi (algoritma doğrulandı)")

    cfg = load_config()
    conn = connect(cfg)
    conn.autocommit = False
    cur = conn.cursor()

    # ── ön kontrol ───────────────────────────────────────────────────
    cur.execute("SELECT COUNT(*) FROM cdDiscountVoucherType "
                "WHERE DiscountVoucherTypeCode = ?", TIP)
    if cur.fetchone()[0] != 1:
        log("DURDU: 'HC' tipi yok — önce YUKLE1.")
        conn.rollback()
        return
    cur.execute("SELECT COUNT(*) FROM cdDiscountVoucher "
                "WHERE DiscountVoucherTypeCode = ?", TIP)
    onceki = cur.fetchone()[0]
    log(f"  mevcut HC çek sayısı: {onceki} (beklenen 15 test çeki)")
    for kupur, (ilk, son, _) in BEKLENEN.items():
        cur.execute("SELECT COUNT(*) FROM cdDiscountVoucher "
                    "WHERE SerialNumber IN (?, ?)", ilk, son)
        if cur.fetchone()[0]:
            log(f"DURDU: {kupur} serisi (kısmen) zaten yüklü. Tekrar çalıştırma!")
            conn.rollback()
            return

    # ── yükleme ──────────────────────────────────────────────────────
    log("  yükleniyor (birkaç saniye sürebilir)...")
    for i, (seri, tutar) in enumerate(seriler, 1):
        cur.execute("""
            INSERT INTO cdDiscountVoucher (
                DiscountVoucherTypeCode, SerialNumber, CustomerTypeCode,
                CustomerCode, FirstValidDate, LastValidDate, CurrencyCode,
                Amount, UsedAmount, MinAmount, DiscountRate,
                IsUsed, IsBlocked, IsCanceled, IsReturnVoucher,
                CancelDate, CancelDescription)
            VALUES (?,?,4,'',CONVERT(date, GETDATE()),'2099-12-31','TRY',
                    ?,0,?,0,0,0,0,0,'1900-01-01','')
            """, TIP, seri, tutar, tutar * 2)
        if i % 500 == 0:
            log(f"    {i}/{len(seriler)}")

    # ── doğrulama ────────────────────────────────────────────────────
    cur.execute("SELECT COUNT(*) FROM cdDiscountVoucher "
                "WHERE DiscountVoucherTypeCode = ?", TIP)
    sonraki = cur.fetchone()[0]
    log(f"  doğrulama: {onceki} + 3000 = {onceki + 3000}, bulunan: {sonraki}")
    cur.execute("SELECT Amount, COUNT(*), MIN(MinAmount), MAX(MinAmount) "
                "FROM cdDiscountVoucher WHERE DiscountVoucherTypeCode = ? "
                "AND IsUsed = 0 GROUP BY Amount ORDER BY Amount", TIP)
    for r in cur.fetchall():
        log(f"    {float(r[0]):.0f} TL: {r[1]} adet (asgari sepet "
            f"{float(r[2]):.0f}–{float(r[3]):.0f})")
    if sonraki == onceki + 3000:
        conn.commit()
        log("\n>>> COMMIT EDİLDİ — 3.000 basılı çek AKTİF. Mağazalarda geçerli.")
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
        with open("YUKLE2-CIKTI.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(OUT))
        print("\n>>> YUKLE2-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
