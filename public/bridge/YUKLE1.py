# -*- coding: utf-8 -*-
"""NEBIM YÜKLE-1 — Hediye Çeki tipi 'HC' + 15 TEST çeki (YAZAR!).

Ne yapar (TEK transaction — ya hepsi ya hiçbiri):
  0) Ön kontrol: 'HC' tipi ve test serileri sistemde OLMAMALI; dfGlobalDefault
     çek ayarları ekrana dökülür (yalnız okunur, DEĞİŞTİRİLMEZ).
  1) Yedek: cdDiscountVoucherType + Desc tablolarının kopyası
     (zzHCyedek_* tabloları; varsa yeniden alınmaz).
  2) cdDiscountVoucherType'a 1 satır: 'HC' — DERİMOD HEDİYE ÇEKİ
     (kayıtlı seriler, tek kullanımlık, hamiline, tutar bazlı, fişte tek çek,
      kampanya indirimlerinden SONRA düşer, tutar değiştirilemez)
  3) cdDiscountVoucherTypeDesc'e TR+EN açıklama
  4) cdDiscountVoucher'a 15 TEST çeki (basılmamış 9991+ seriler):
     500 TL (MinAmount 1000) ×5, 750 TL (1500) ×5, 1000 TL (2000) ×5,
     geçerlilik 2026-08-25 → 2099-12-31
  5) Doğrulama; sorun varsa OTOMATİK ROLLBACK.

MEVCUT HİÇBİR KAYDA DOKUNMAZ — yalnız yeni satır ekler.
Geri almak için: GERIAL1.bat
Cikti: YUKLE1-CIKTI.txt
"""
from __future__ import annotations

import traceback
from satis_kopru import load_config, connect

OUT = []
TIP = "HC"

TEST_CEKLERI = [
    ("2900500099918", 500), ("2900500099925", 500), ("2900500099932", 500),
    ("2900500099949", 500), ("2900500099956", 500),
    ("2900700099916", 750), ("2900700099923", 750), ("2900700099930", 750),
    ("2900700099947", 750), ("2900700099954", 750),
    ("2901000099910", 1000), ("2901000099927", 1000), ("2901000099934", 1000),
    ("2901000099941", 1000), ("2901000099958", 1000),
]


def log(*a):
    s = " ".join(str(x) for x in a)
    print(s)
    OUT.append(s)


def main():
    cfg = load_config()
    log(">>> YÜKLE-1 — Hediye Çeki tipi + 15 TEST çeki")
    conn = connect(cfg)
    conn.autocommit = False
    cur = conn.cursor()

    # ── 0) ÖN KONTROL ────────────────────────────────────────────────
    log("\n--- 0) Ön kontrol")
    cur.execute("SELECT COUNT(*) FROM cdDiscountVoucherType "
                "WHERE DiscountVoucherTypeCode = ?", TIP)
    if cur.fetchone()[0]:
        log(f"DURDU: '{TIP}' tipi ZATEN VAR. (Tekrar çalıştırma; durumu bildir.)")
        conn.rollback()
        return
    seriler = [s for s, _ in TEST_CEKLERI]
    cur.execute(
        "SELECT COUNT(*) FROM cdDiscountVoucher WHERE SerialNumber IN (%s)"
        % ",".join("?" * len(seriler)), *seriler)
    if cur.fetchone()[0]:
        log("DURDU: test serilerinden bazıları zaten kayıtlı. Durumu bildir.")
        conn.rollback()
        return
    cur.execute("SELECT DiscountVoucherTypeCode, ReturnDiscountVoucherTypeCode, "
                "DiscountVoucherLimit, ActivatePointBasedDiscountVoucher "
                "FROM dfGlobalDefault")
    for r in cur.fetchall():
        log(f"  dfGlobalDefault: VoucherType='{str(r[0]).strip()}' "
            f"ReturnVoucherType='{str(r[1]).strip()}' Limit={r[2]} Puan={r[3]}")
    log("  Ön kontrol TEMİZ.")

    # ── 1) YEDEK ─────────────────────────────────────────────────────
    log("\n--- 1) Yedek tabloları")
    for kaynak, hedef in (("cdDiscountVoucherType", "zzHCyedek_VoucherType"),
                          ("cdDiscountVoucherTypeDesc", "zzHCyedek_VoucherTypeDesc")):
        cur.execute("SELECT OBJECT_ID(?)", hedef)
        if cur.fetchone()[0]:
            log(f"  {hedef} zaten var — yeniden alınmadı.")
        else:
            cur.execute(f"SELECT * INTO [{hedef}] FROM [{kaynak}]")
            log(f"  {kaynak} -> {hedef} kopyalandı.")

    # ── 2) TİP ───────────────────────────────────────────────────────
    log("\n--- 2) Çek tipi ekleniyor")
    cur.execute("""
        INSERT INTO cdDiscountVoucherType (
            DiscountVoucherTypeCode, IsProvisionRequired, IsV3Provision,
            ConnectionString, IsWebServiceProvision, WebServiceUrl,
            VoucherWillBePrintedOnSale, UsedManuelNumbering, UseRecordedVouchers,
            BarcodeTypeCode, IsBearerVoucher, DiscountVoucherBaseCode,
            IsPercentageDiscount, IsDisposable, IsUsedOncePerSale,
            CurrencyCode, MaxVoucherAmount, AmountRoundingDigit,
            IgnorePriorityAndAdvantage, IgnorePriorityAndAdvantageInUse,
            CannotChangeVoucherAmount, IfUsedThenCannotEarn,
            DiscountLevelOfUseCode, CancelCustomerDiscount, PrintForm,
            UseSystemGenerateNumber, IsBlocked)
        VALUES (?,0,0,'',0,'',0,1,1,'Def',1,1,0,1,1,'TRY',0,4,0,0,1,0,5,0,0,0,0)
        """, TIP)
    log(f"  '{TIP}' tipi eklendi (kayıtlı seri + tek kullanım + hamiline + "
        "fişte tek çek + kampanyalardan SONRA düşer).")

    # ── 3) AÇIKLAMA ──────────────────────────────────────────────────
    cur.execute("INSERT INTO cdDiscountVoucherTypeDesc "
                "(DiscountVoucherTypeCode, LangCode, DiscountVoucherTypeDescription) "
                "VALUES (?, 'TR', N'DERİMOD HEDİYE ÇEKİ')", TIP)
    cur.execute("INSERT INTO cdDiscountVoucherTypeDesc "
                "(DiscountVoucherTypeCode, LangCode, DiscountVoucherTypeDescription) "
                "VALUES (?, 'EN', N'DERIMOD GIFT VOUCHER')", TIP)
    log("  TR + EN açıklama eklendi.")

    # ── 4) TEST ÇEKLERİ ──────────────────────────────────────────────
    log("\n--- 4) 15 test çeki ekleniyor")
    for seri, tutar in TEST_CEKLERI:
        cur.execute("""
            INSERT INTO cdDiscountVoucher (
                DiscountVoucherTypeCode, SerialNumber, CustomerTypeCode,
                CustomerCode, FirstValidDate, LastValidDate, CurrencyCode,
                Amount, UsedAmount, MinAmount, DiscountRate,
                IsUsed, IsBlocked, IsCanceled, IsReturnVoucher,
                CancelDate, CancelDescription)
            VALUES (?,?,4,'','2026-08-25','2099-12-31','TRY',?,0,?,0,
                    0,0,0,0,'1900-01-01','')
            """, TIP, seri, tutar, tutar * 2)
        log(f"  {seri}  {tutar} TL  (asgari sepet {tutar*2} TL)")

    # ── 5) DOĞRULAMA ─────────────────────────────────────────────────
    log("\n--- 5) Doğrulama")
    cur.execute("SELECT COUNT(*) FROM cdDiscountVoucherType "
                "WHERE DiscountVoucherTypeCode = ?", TIP)
    n_tip = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM cdDiscountVoucher "
                "WHERE DiscountVoucherTypeCode = ?", TIP)
    n_cek = cur.fetchone()[0]
    log(f"  tip: {n_tip} (beklenen 1) | test çeki: {n_cek} (beklenen 15)")
    if n_tip == 1 and n_cek == 15:
        conn.commit()
        log("\n>>> COMMIT EDİLDİ — yükleme BAŞARILI. POS testine hazırız.")
    else:
        conn.rollback()
        log("\n>>> SAYILAR TUTMADI — her şey GERİ ALINDI, hiçbir iz kalmadı.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log("\nHATA — transaction otomatik geri alınır (commit edilmedi):")
        log(traceback.format_exc())
    try:
        with open("YUKLE1-CIKTI.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(OUT))
        print("\n>>> YUKLE1-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
