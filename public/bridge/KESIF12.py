"""NEBIM KEŞİF v12 — KREDİ ÇEKİ: tüm-zaman gün listesi + fatura detayı + teşhis.

KESIF11 bulgusu: Kredi Çeki = bsPaymentType kod 7, ödemeler GiftCard
mekanizmasıyla (trGiftCardPaymentLine) saklanıyor, AllPayments view'ında
DocumentDate+StoreCode+Loc_Payment hazır.

Bu script (salt-okunur):
A) TÜM ZAMAN (2019'dan beri) kredi çeki > 0 olan günler, gün × mağaza
   + yıllık özet
B) 2026 kredi çeki ödemelerinin TAM detayı (belge no, müşteri, çek serisi)
C) Bu ödemelerin fatura eşleşmesi + fatura satırları (ürün/satıcı/müşteri)
D) TEŞHİS: köprünün payment subquery'si (DocumentNumber=InvoiceNumber)
   bu ödemeleri neden kaçırıyor?

Cikti: KESIF12-CIKTI.txt
"""
from __future__ import annotations

import traceback
from satis_kopru import load_config, connect

OUT = []

CEK_KOD = 7  # bsPaymentType: Kredi Çeki


def log(*a):
    s = " ".join(str(x) for x in a)
    print(s)
    OUT.append(s)


def main():
    cfg = load_config()
    company = int(cfg.get("company_code", 1))
    log(">>> NEBIM KEŞİF v12 — KREDİ ÇEKİ tüm-zaman + detay + teşhis")
    conn = connect(cfg)
    cur = conn.cursor()

    # ── A) TÜM ZAMAN gün listesi ────────────────────────────────────────
    log("\n=== A) TÜM ZAMAN — kredi çeki > 0 olan günler (gün × mağaza) ===")
    cur.execute(
        "SELECT CAST(DocumentDate AS date) AS gun, StoreCode, "
        "       SUM(Loc_Payment) AS toplam, COUNT(*) AS adet "
        "FROM AllPayments "
        "WHERE PaymentTypeCode = ? AND CompanyCode = ? "
        "GROUP BY CAST(DocumentDate AS date), StoreCode "
        "HAVING SUM(Loc_Payment) > 0 "
        "ORDER BY gun, StoreCode", CEK_KOD, company)
    rows = cur.fetchall()
    log(f"GÜN        | MAĞAZA | TOPLAM | ADET   ({len(rows)} kayıt)")
    for r in rows:
        log(f"{r[0]} | {r[1]} | {float(r[2]):.2f} | {r[3]}")

    # sıfır/negatif net günler (bilgi amaçlı — listeye girmeyenler)
    cur.execute(
        "SELECT COUNT(*) FROM ( "
        "  SELECT CAST(DocumentDate AS date) AS gun, StoreCode "
        "  FROM AllPayments "
        "  WHERE PaymentTypeCode = ? AND CompanyCode = ? "
        "  GROUP BY CAST(DocumentDate AS date), StoreCode "
        "  HAVING SUM(Loc_Payment) <= 0 "
        ") t", CEK_KOD, company)
    log(f"(ayrıca net toplamı <= 0 olan {cur.fetchone()[0]} gün×mağaza var — listede yok)")

    # yıllık özet
    log("\n--- Yıllık özet ---")
    cur.execute(
        "SELECT YEAR(DocumentDate) AS yil, StoreCode, "
        "       SUM(Loc_Payment) AS toplam, COUNT(*) AS adet "
        "FROM AllPayments "
        "WHERE PaymentTypeCode = ? AND CompanyCode = ? "
        "GROUP BY YEAR(DocumentDate), StoreCode "
        "ORDER BY yil, StoreCode", CEK_KOD, company)
    for r in cur.fetchall():
        log(f"  {r[0]} | {r[1]} | {float(r[2]):.2f} | {r[3]} satır")

    # ── B) 2026 ödemelerinin tam detayı ────────────────────────────────
    log("\n=== B) 2026 KREDİ ÇEKİ ÖDEMELERİ — tam detay ===")
    cur.execute(
        "SELECT ap.DocumentDate, ap.DocumentTime, ap.StoreCode, ap.DocumentNumber, "
        "       ap.PaymentNumber, ap.Loc_Payment, ap.CurrAccCode, ca.FirstLastName, "
        "       gl.SerialNumber, ap.Description "
        "FROM AllPayments ap "
        "LEFT JOIN cdCurrAcc ca ON ca.CurrAccCode = ap.CurrAccCode "
        "LEFT JOIN trGiftCardPaymentLine gl "
        "       ON gl.GiftCardPaymentLineID = ap.GiftCardPaymentLineID "
        "WHERE ap.PaymentTypeCode = ? AND ap.CompanyCode = ? "
        "  AND ap.DocumentDate >= '2026-01-01' "
        "ORDER BY ap.DocumentDate, ap.DocumentNumber", CEK_KOD, company)
    pays = cur.fetchall()
    doc_numbers = []
    for r in pays:
        log(f"  {r[0]} {r[1]} | {r[2]} | belge:{r[3]} | odeme_no:{r[4]} | "
            f"tutar:{float(r[5]):.2f} | musteri:{r[6]} {r[7]} | çek-seri:{r[8]} | not:{r[9]}")
        if r[3] and str(r[3]) not in doc_numbers:
            doc_numbers.append(str(r[3]))
    log(f"  farklı belge no: {doc_numbers}")

    # ── C) Fatura eşleşmesi + fatura detayı ────────────────────────────
    log("\n=== C) BELGE → FATURA EŞLEŞMESİ + FATURA DETAYI ===")
    for dn in doc_numbers:
        cur.execute(
            "SELECT InvoiceNumber, ProcessCode, StoreCode, InvoiceDate, IsReturn, "
            "       CurrAccCode, InvoiceHeaderID "
            "FROM trInvoiceHeader WHERE InvoiceNumber = ? AND CompanyCode = ?",
            dn, company)
        hits = cur.fetchall()
        if not hits:
            log(f"\n--- belge {dn}: trInvoiceHeader'da YOK (fatura değil — köprü bu yüzden görmez)")
            continue
        for h in hits:
            log(f"\n--- belge {dn}: FATURA VAR — Process={h[1]} Mağaza={h[2]} "
                f"Tarih={h[3]} İade={h[4]} Müşteri={h[5]}")
            cur.execute(
                "SELECT l.SortOrder, l.ItemCode, id.ItemDescription, l.Qty1, "
                "       c.NetAmount, sp.FirstLastName, ca.FirstLastName "
                "FROM trInvoiceLine l "
                "JOIN trInvoiceHeader hh ON hh.InvoiceHeaderID = l.InvoiceHeaderID "
                "JOIN trInvoiceLineCurrency c ON c.InvoiceLineID = l.InvoiceLineID "
                "     AND c.CurrencyCode = hh.LocalCurrencyCode "
                "LEFT JOIN cdItemDesc id ON id.ItemTypeCode = l.ItemTypeCode "
                "     AND id.ItemCode = l.ItemCode AND id.LangCode = 'TR' "
                "LEFT JOIN cdSalesperson sp ON sp.SalespersonCode = l.SalespersonCode "
                "LEFT JOIN cdCurrAcc ca ON ca.CurrAccCode = hh.CurrAccCode "
                "WHERE l.InvoiceHeaderID = ? "
                "ORDER BY l.SortOrder", h[6])
            for l in cur.fetchall():
                log(f"      #{l[0]} {l[1]} | {l[2]} | adet:{l[3]} | net:{l[4]} | "
                    f"satıcı:{l[5]} | müşteri:{l[6]}")

    # ── D) TEŞHİS — köprü subquery'si bu belgelerde kod 7 görüyor mu? ──
    log("\n=== D) TEŞHİS — köprü payment subquery'si (DocumentNumber eşleşmesi) ===")
    for dn in doc_numbers:
        cur.execute(
            "SELECT DISTINCT pl.PaymentTypeCode "
            "FROM trPaymentHeader ph "
            "JOIN trPaymentLine pl ON pl.PaymentHeaderID = ph.PaymentHeaderID "
            "WHERE ph.DocumentNumber = ? AND ph.CompanyCode = ?", dn, company)
        codes = sorted(r[0] for r in cur.fetchall())
        log(f"  belge {dn}: köprü-tarzı sorguda kodlar = {codes}"
            + ("  <<< 7 VAR, köprü GÖRMELİYDİ" if CEK_KOD in codes else "  <<< 7 YOK"))
    # kredi çeki ödemesinin bağlı olduğu header'ların belge no biçimi
    log("\n  2026 kod-7 ödeme header'larının DocumentNumber değerleri (yukarıda B'de).")
    log("  Eğer bunlar fatura numarası DEĞİLSE köprünün kaçırması normaldir;")
    log("  fatura numarasıysa ve D'de '7 VAR' diyorsa köprüde başka bir filtre sorunu var demektir.")

    log("\n>>> KEŞİF v12 TAMAM. Çıktının TAMAMINI yapıştır.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log(traceback.format_exc())
    try:
        with open("KESIF12-CIKTI.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(OUT))
        print("\n>>> KESIF12-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
