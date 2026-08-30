"""NEBIM KEŞİF — ÖDEME SATIRI GELMEYEN FATURALAR (salt-okunur).

DocuFlow'da 45 faturanın ödeme kırılımı boş geliyor ("Aktarılmayan ödeme").
Köprü ödemeyi şu koşulla eşliyor:
    trPaymentHeader.DocumentNumber = trInvoiceHeader.InvoiceNumber
Bu keşif, o eşleşmenin neden kurulmadığını arar.

A) Örnek faturaların başlık bilgisi
B) DocumentNumber = InvoiceNumber eşleşmesi var mı?
C) Yoksa: aynı gün + aynı mağazada, tutarı faturaya YAKIN ödeme başlıkları
D) trPaymentHeader'da fatura numarasının başka bir alanda geçip geçmediği
Cikti: KESIF-ODEME-CIKTI.txt
"""
from __future__ import annotations

import traceback
from satis_kopru import load_config, connect

OUT = []

# DocuFlow'da ödemesi gelmeyen, en büyük tutarlı faturalar
FISLER = [
    "1-R-7-79460",   # S03 10.01.2026  20.489,97
    "1-R-7-88691",   # S01 26.06.2026  13.199,98
    "1-R-7-90752",   # S01 28.07.2026  11.549,98  not: "6430 tl maximum alindi"
    "1-R-7-89351",   # S01 06.07.2026  11.074,96  not: "OPTIMUM ALINDI 5594 OLARAK"
    "1-R-7-91659",   # S03 12.08.2026  10.349,98  not: "merit %10 indirim"
    "1-R-7-90495",   # S01 25.07.2026   7.098,99  not: "7500 TL MAXIMUM ALINDI"
    "1-R-7-92197",   # S03 21.08.2026  10.024,98
    "1-R-7-91952",   # S03 16.08.2026   8.999,99
]


def log(*a):
    s = " ".join(str(x) for x in a)
    print(s)
    OUT.append(s)


def main():
    cfg = load_config()
    log(">>> KEŞİF — ödeme satırı gelmeyen faturalar (salt-okunur)")
    conn = connect(cfg)
    cur = conn.cursor()
    cc = cfg.get("company_code", 1)

    for fis in FISLER:
        log("\n" + "=" * 68)
        log(f"FİŞ {fis}")

        # A) Fatura başlığı
        cur.execute("""
            SELECT h.InvoiceHeaderID, h.InvoiceNumber, h.InvoiceDate, h.StoreCode,
                   h.CurrAccCode, h.IsReturn, h.OfficeCode, h.ProcessCode,
                   h.DocCurrencyCode, h.IsCompleted
            FROM trInvoiceHeader h
            WHERE h.InvoiceNumber = ? AND h.CompanyCode = ?
        """, (fis, cc))
        hdr = cur.fetchone()
        if not hdr:
            log("  A) fatura BULUNAMADI")
            continue
        hid, inv, idate, store, curracc, isret, office, proc, curr, done = hdr
        log(f"  A) HeaderID={hid} | {idate} | mağaza={store} | cari={curracc} "
            f"| iade={isret} | ofis={office} | proc={proc} | {curr} | tamam={done}")

        # Fatura tutarı
        cur.execute("""
            SELECT SUM(c.NetAmount)
            FROM trInvoiceLine l
            JOIN trInvoiceLineCurrency c
              ON c.InvoiceLineID = l.InvoiceLineID AND c.CurrencyCode = ?
            WHERE l.InvoiceHeaderID = ?
        """, (curr, hid))
        net = cur.fetchone()[0]
        log(f"     fatura neti = {float(net or 0):.2f}")

        # B) Köprünün kullandığı eşleşme
        cur.execute("""
            SELECT ph.PaymentHeaderID, ph.DocumentNumber, ph.PaymentDate,
                   pl.PaymentTypeCode, pl.CurrAccAmount
            FROM trPaymentHeader ph
            JOIN trPaymentLine pl ON pl.PaymentHeaderID = ph.PaymentHeaderID
            WHERE ph.DocumentNumber = ? AND ph.CompanyCode = ?
        """, (fis, cc))
        rows = cur.fetchall()
        if rows:
            log(f"  B) DocumentNumber eşleşmesi VAR ({len(rows)} satır):")
            for r in rows:
                log(f"     hdr={r[0]} doc={r[1]} {r[2]} tip={r[3]} tutar={float(r[4] or 0):.2f}")
        else:
            log("  B) DocumentNumber = InvoiceNumber eşleşmesi YOK  <<< SORUN BURADA")

        # C) Aynı gün + aynı mağaza, tutarı yakın ödeme başlıkları
        cur.execute("""
            SELECT TOP 15 ph.PaymentHeaderID, ph.DocumentNumber, ph.PaymentDate,
                   ph.StoreCode, pl.PaymentTypeCode, pl.CurrAccAmount, ph.CurrAccCode
            FROM trPaymentHeader ph
            JOIN trPaymentLine pl ON pl.PaymentHeaderID = ph.PaymentHeaderID
            WHERE ph.CompanyCode = ?
              AND CAST(ph.PaymentDate AS date) = CAST(? AS date)
              AND ph.StoreCode = ?
              AND ABS(pl.CurrAccAmount) BETWEEN ? AND ?
            ORDER BY ABS(pl.CurrAccAmount) DESC
        """, (cc, idate, store, float(net or 0) * 0.4, float(net or 0) * 1.2))
        near = cur.fetchall()
        log(f"  C) aynı gün/mağaza yakın tutarlı ödeme başlığı: {len(near)}")
        for r in near[:8]:
            mark = "  <-- cari AYNI" if r[6] == curracc else ""
            log(f"     hdr={r[0]} doc={r[1]} {r[2]} mağaza={r[3]} tip={r[4]} "
                f"tutar={float(r[5] or 0):.2f} cari={r[6]}{mark}")

        # D) Fatura no ödeme tarafında herhangi bir alanda geçiyor mu?
        cur.execute("""
            SELECT TOP 5 ph.PaymentHeaderID, ph.DocumentNumber, ph.Description
            FROM trPaymentHeader ph
            WHERE ph.CompanyCode = ?
              AND (ph.Description LIKE ? OR ph.DocumentNumber LIKE ?)
        """, (cc, f"%{fis}%", f"%{fis}%"))
        d = cur.fetchall()
        log(f"  D) fatura no ödeme başlığı metninde geçiyor mu: {len(d)}")
        for r in d:
            log(f"     hdr={r[0]} doc={r[1]} aciklama={r[2]}")

    log("\n>>> KEŞİF TAMAM. Çıktının TAMAMINI yapıştır.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log(traceback.format_exc())
    try:
        with open("KESIF-ODEME-CIKTI.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(OUT))
        print("\n>>> KESIF-ODEME-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
