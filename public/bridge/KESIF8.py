"""NEBIM KEŞİF v8 — ödeme TUTARI kolonu avı (salt-okunur).

Amaç: trPaymentLine'da ödeme tipi başına TUTAR hangi kolonda? (Nakit/Kart ayrımını
doğru kıyaslamak için.) Köprü şu an sadece PaymentTypeCode çekiyor, tutarı değil.

Cikti: KESIF8-CIKTI.txt
"""
from __future__ import annotations

import traceback
from satis_kopru import load_config, connect

OUT = []


def log(*a):
    s = " ".join(str(x) for x in a)
    print(s)
    OUT.append(s)


def cols(cur, table):
    cur.execute(
        "SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS "
        "WHERE TABLE_NAME=? ORDER BY ORDINAL_POSITION", table)
    return cur.fetchall()


def main():
    cfg = load_config()
    company = cfg.get("company_code", 1)
    log(">>> NEBIM KEŞİF v8 — ödeme tutarı kolonu")
    conn = connect(cfg)
    cur = conn.cursor()

    for t in ("trPaymentHeader", "trPaymentLine", "trCreditCardPaymentLine"):
        log(f"\n=== {t} kolonlar ===")
        cc = cols(cur, t)
        for c, d in cc:
            log(f"  {c}:{d}")

    # Son 5 perakende faturanın ödeme satırları — TÜM dolu kolonlar (tutarı görmek için)
    log("\n=== ÖRNEK: son perakende faturaların ödeme satırları (dolu kolonlar) ===")
    cur.execute(
        "SELECT TOP 5 h.InvoiceNumber, h.InvoiceHeaderID "
        "FROM trInvoiceHeader h "
        "WHERE h.ProcessCode='R' AND h.CompanyCode=? "
        "ORDER BY h.InvoiceDate DESC, h.InvoiceNumber DESC", company)
    invs = cur.fetchall()
    for inv_no, _hid in invs:
        log(f"\n#### Fatura {inv_no} ####")
        try:
            cur.execute(
                "SELECT pl.* FROM trPaymentHeader ph "
                "JOIN trPaymentLine pl ON pl.PaymentHeaderID=ph.PaymentHeaderID "
                "WHERE ph.DocumentNumber=? AND ph.CompanyCode=?", inv_no, company)
            colnames = [d[0] for d in cur.description]
            for row in cur.fetchall():
                parts = []
                for i, cn in enumerate(colnames):
                    v = row[i]
                    if v is None:
                        continue
                    s = str(v)
                    if s.strip() == "" or s == "0" or s == "0.0":
                        continue
                    if len(s) > 40:
                        s = s[:40] + "…"
                    parts.append(f"{cn}={s}")
                log("   PL: " + " | ".join(parts))
        except Exception as e:
            log(f"   hata: {str(e)[:150]}")

    log("\n>>> KEŞİF v8 TAMAM. Tamamını yapıştır.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log(traceback.format_exc())
    try:
        with open("KESIF8-CIKTI.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(OUT))
        print("\n>>> KESIF8-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
