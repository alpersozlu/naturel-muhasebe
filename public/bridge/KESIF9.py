"""NEBIM KEŞİF v9 — NAKİT tutar tablosu + kolonu avı (salt-okunur).

KESIF8 buldu: trPaymentLine'da tutar yok; kart tutarı trCreditCardPaymentLine.CurrAccAmount.
Nakit tutarı CashLineID -> ayrı tablo. Bu script o tabloyu (CashLineID kolonu olan)
otomatik bulur, money kolonlarını + nakit/kart örnek tutarlarını gösterir.

Cikti: KESIF9-CIKTI.txt
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
    company = cfg.get("company_code", 1)
    log(">>> NEBIM KEŞİF v9 — nakit tutar tablosu")
    conn = connect(cfg)
    cur = conn.cursor()

    # 1) CashLineID kolonuna sahip tablolar (trPaymentLine hariç) = nakit detay tablosu
    cur.execute(
        "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.COLUMNS "
        "WHERE COLUMN_NAME='CashLineID' AND TABLE_NAME<>'trPaymentLine'")
    cash_tables = [r[0] for r in cur.fetchall()]
    log(f"\n=== CashLineID içeren tablolar: {cash_tables} ===")

    for t in cash_tables:
        cur.execute(
            "SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS "
            "WHERE TABLE_NAME=? ORDER BY ORDINAL_POSITION", t)
        cc = cur.fetchall()
        money = [c for c, d in cc if d in ("money", "decimal", "numeric", "float")]
        log(f"\n--- {t} kolonlar ---")
        log("  " + ", ".join(f"{c}:{d}" for c, d in cc))
        log(f"  >>> PARA kolonları: {money}")

    # 2) Nakit örnek: son nakit ödemeli (PaymentTypeCode=1) faturalar + tutar
    if cash_tables:
        ct = cash_tables[0]
        log(f"\n=== ÖRNEK: nakit ödeme satırları ({ct}) ===")
        try:
            cur.execute(
                f"SELECT TOP 8 ph.DocumentNumber, pl.PaymentTypeCode, cl.* "
                f"FROM trPaymentLine pl "
                f"JOIN trPaymentHeader ph ON ph.PaymentHeaderID=pl.PaymentHeaderID "
                f"JOIN [{ct}] cl ON cl.CashLineID=pl.CashLineID "
                f"WHERE pl.PaymentTypeCode=1 AND ph.CompanyCode=? "
                f"ORDER BY ph.DocumentDate DESC", company)
            names = [d[0] for d in cur.description]
            for row in cur.fetchall():
                parts = []
                for i, cn in enumerate(names):
                    v = row[i]
                    if v is None:
                        continue
                    s = str(v)
                    if s.strip() in ("", "0", "0.0", "0.0000"):
                        continue
                    if len(s) > 36:
                        s = s[:36] + "…"
                    parts.append(f"{cn}={s}")
                log("   " + " | ".join(parts))
        except Exception as e:
            log(f"   hata: {str(e)[:160]}")

    # 3) Kart örnek: CurrAccAmount doğrula
    log("\n=== ÖRNEK: kart ödeme tutarları (trCreditCardPaymentLine.CurrAccAmount) ===")
    try:
        cur.execute(
            "SELECT TOP 8 ph.DocumentNumber, ccl.CurrAccAmount, ccl.CurrAccCurrencyCode "
            "FROM trPaymentLine pl "
            "JOIN trPaymentHeader ph ON ph.PaymentHeaderID=pl.PaymentHeaderID "
            "JOIN trCreditCardPaymentLine ccl ON ccl.CreditCardPaymentLineID=pl.CreditCardPaymentLineID "
            "WHERE pl.PaymentTypeCode=2 AND ph.CompanyCode=? "
            "ORDER BY ph.DocumentDate DESC", company)
        for r in cur.fetchall():
            log(f"   {r[0]} | CurrAccAmount={r[1]} {r[2]}")
    except Exception as e:
        log(f"   hata: {str(e)[:160]}")

    # 4) Bir günün nakit+kart toplamı, mağaza özetiyle elle kıyas için
    log("\n=== ÖRNEK: bugün(-1) mağaza+ödeme tipi toplam (kontrol) ===")
    try:
        ct = cash_tables[0] if cash_tables else None
        if ct:
            cur.execute(
                f"SELECT h.StoreCode, "
                f"  SUM(CASE WHEN pl.PaymentTypeCode=1 THEN cl2.Amount ELSE 0 END) AS nakit, "
                f"  SUM(CASE WHEN pl.PaymentTypeCode=2 THEN ccl.CurrAccAmount ELSE 0 END) AS kart "
                f"FROM trInvoiceHeader h "
                f"JOIN trPaymentHeader ph ON ph.DocumentNumber=h.InvoiceNumber AND ph.CompanyCode=h.CompanyCode "
                f"JOIN trPaymentLine pl ON pl.PaymentHeaderID=ph.PaymentHeaderID "
                f"LEFT JOIN [{ct}] cl2 ON cl2.CashLineID=pl.CashLineID "
                f"LEFT JOIN trCreditCardPaymentLine ccl ON ccl.CreditCardPaymentLineID=pl.CreditCardPaymentLineID "
                f"WHERE h.ProcessCode='R' AND h.CompanyCode=? AND h.InvoiceDate>=DATEADD(day,-2,GETDATE()) "
                f"GROUP BY h.StoreCode", company)
            log("  (NOT: cl2.Amount kolon adı yanlışsa hata verir -> yukarıdaki PARA kolonundan düzeltirim)")
            for r in cur.fetchall():
                log(f"   Mağaza {r[0]}: nakit={r[1]}  kart={r[2]}")
    except Exception as e:
        log(f"   hata (muhtemelen Amount kolon adı): {str(e)[:160]}")

    log("\n>>> KEŞİF v9 TAMAM. Tamamını yapıştır.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log(traceback.format_exc())
    try:
        with open("KESIF9-CIKTI.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(OUT))
        print("\n>>> KESIF9-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
