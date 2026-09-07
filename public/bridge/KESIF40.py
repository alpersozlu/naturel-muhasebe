"""NEBIM KEŞİF 40 — İPTAL EDİLMİŞ FATURA NASIL İŞARETLENİYOR? (salt-okunur)

Lefkoşa 31.08.2026: iade faturası 1-R-7-92614 (09:58, kredi çeki CV…5954)
Nebim'in kendi "Mağaza Hareket Özeti" raporunda YOK, çek kartı cdGiftCard'dan
SİLİNMİŞ; ama köprünün trInvoiceHeader/trInvoiceLine sorgusu satırları hâlâ
taşıyor. Aynı müşteri aynı ürünü 18:56'da yeniden iade etti (92692, çek 5960,
19:01'de 92693 satışında kullanıldı). Yani 92614 Nebim'de İPTAL edilmiş ama
satırları duruyor → başlıkta ya da satırda bir bayrak olmalı.

A) Üç faturanın (92614 iptal-iade, 92692 geçerli iade, 92693 satış) trInvoiceHeader
   satırları TÜM kolonlarıyla yan yana; 92614'ün 92692'den farklı olduğu alanlar ◀ ile.
B) Aynı üçlünün trInvoiceLine satırları (tüm kolonlar, farklar ◀).
C) Veritabanında adı Cancel/Iptal/Void/Delete/Status/Valid geçen kolonlar (tablo adıyla).
D) Kredi çeki tarafı: cdGiftCard'da 5954 ve 5960; trGiftCardPaymentHeader/Line ve
   AllPayments'ta 92614 ile 92692'nin ödeme satırları (tüm kolonlar, farklar ◀).
E) 31.08.2026 S01 için Nebim'in kendi raporunun kullandığı olası filtre: aynı gün
   ProcessCode='R' fatura başlıklarında bit/bayrak kolonlarının dağılımı.
Cikti: KESIF40-CIKTI.txt
"""
from __future__ import annotations

import traceback
from decimal import Decimal

from satis_kopru import load_config, connect

OUT = []
IPTAL, GECERLI, SATIS = "1-R-7-92614", "1-R-7-92692", "1-R-7-92693"


def log(*a):
    s = " ".join(str(x) for x in a)
    print(s)
    OUT.append(s)


def fmt(v):
    if v is None:
        return "NULL"
    if isinstance(v, (bytes, bytearray)):
        return "0x" + bytes(v).hex()[:24]
    if isinstance(v, Decimal):
        return str(v)
    s = str(v)
    return s if len(s) <= 40 else s[:37] + "..."


def rows_by_key(cur, sql, params, keycol):
    cur.execute(sql, params)
    cols = [d[0] for d in cur.description]
    out = {}
    for r in cur.fetchall():
        d = dict(zip(cols, r))
        out.setdefault(str(d.get(keycol)), []).append(d)
    return cols, out


def side_by_side(title, cols, groups, order, refa, refb):
    """Her kolon için üç değeri yaz; refa ile refb farklıysa ◀ koy."""
    log("\n" + "=" * 72)
    log(title)
    rows = {k: (groups.get(k) or [{}])[0] for k in order}
    log("  %-28s | %-22s | %-22s | %-22s" % ("KOLON", *order))
    diffs = []
    for c in cols:
        vals = [fmt(rows[k].get(c)) for k in order]
        mark = ""
        if fmt(rows[refa].get(c)) != fmt(rows[refb].get(c)):
            mark = "  ◀ FARK"
            diffs.append(c)
        log("  %-28s | %-22s | %-22s | %-22s%s" % (c, *vals, mark))
    log(f"  → {refa} ile {refb} arasında farklı kolonlar: {', '.join(diffs) or 'YOK'}")


def main():
    cfg = load_config()
    conn = connect(cfg)
    cur = conn.cursor()
    cc = cfg.get("company_code", 1)
    trio = (IPTAL, GECERLI, SATIS)
    log(">>> KEŞİF 40 — iptal edilmiş fatura bayrağı (salt-okunur)")

    # A) başlıklar
    cols, groups = rows_by_key(
        cur,
        "SELECT * FROM trInvoiceHeader WHERE CompanyCode = ? AND InvoiceNumber IN (?, ?, ?)",
        (cc, *trio), "InvoiceNumber")
    log(f"\nA) trInvoiceHeader: bulunan = {{k: len(v) for k, v in groups.items()}}")
    side_by_side("A) trInvoiceHeader — kolon kolon", cols, groups, trio, IPTAL, GECERLI)

    # B) satırlar (ilk satır)
    cols, groups = rows_by_key(
        cur,
        """SELECT l.* FROM trInvoiceLine l
           JOIN trInvoiceHeader h ON h.InvoiceHeaderID = l.InvoiceHeaderID
           WHERE h.CompanyCode = ? AND h.InvoiceNumber IN (?, ?, ?)""",
        (cc, *trio), "InvoiceHeaderID")
    # InvoiceHeaderID → InvoiceNumber eşlemesi
    cur.execute("SELECT InvoiceHeaderID, InvoiceNumber FROM trInvoiceHeader WHERE CompanyCode = ? AND InvoiceNumber IN (?, ?, ?)", (cc, *trio))
    idmap = {str(r[0]): r[1] for r in cur.fetchall()}
    groups2 = {idmap.get(k, k): v for k, v in groups.items()}
    log(f"\nB) trInvoiceLine: satır sayıları = {{k: len(v) for k, v in groups2.items()}}")
    side_by_side("B) trInvoiceLine — ilk satır, kolon kolon", cols, groups2, trio, IPTAL, GECERLI)

    # C) aday bayrak kolonları (tüm DB)
    log("\n" + "=" * 72)
    log("C) Adında Cancel/Iptal/Void/Delete/Status/Valid geçen kolonlar")
    cur.execute("""
        SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE (COLUMN_NAME LIKE '%Cancel%' OR COLUMN_NAME LIKE '%Iptal%'
               OR COLUMN_NAME LIKE '%Void%' OR COLUMN_NAME LIKE '%Delet%'
               OR COLUMN_NAME LIKE '%Status%' OR COLUMN_NAME LIKE '%IsValid%')
          AND (TABLE_NAME LIKE 'trInvoice%' OR TABLE_NAME LIKE 'trPayment%'
               OR TABLE_NAME LIKE 'trGiftCard%' OR TABLE_NAME LIKE 'cdGiftCard%'
               OR TABLE_NAME LIKE 'trShipment%' OR TABLE_NAME LIKE 'tr%Header')
        ORDER BY TABLE_NAME, COLUMN_NAME
    """)
    for r in cur.fetchall():
        log(f"  {r[0]}.{r[1]} ({r[2]})")

    # D) kredi çeki tarafı
    log("\n" + "=" * 72)
    log("D) cdGiftCard 5954 / 5960")
    cur.execute("SELECT * FROM cdGiftCard WHERE SerialNumber IN (?, ?)",
                ("CV100000000000005954", "CV100000000000005960"))
    cols = [d[0] for d in cur.description]
    rows = cur.fetchall()
    log(f"  bulunan kart sayısı: {len(rows)} (5954 yoksa Nebim silmiş demektir)")
    for r in rows:
        d = dict(zip(cols, r))
        log("  " + ", ".join(f"{k}={fmt(v)}" for k, v in d.items()))

    for label, table, key in (("trGiftCardPaymentHeader", "trGiftCardPaymentHeader", "DocumentNumber"),):
        cols, groups = rows_by_key(
            cur, f"SELECT * FROM {table} WHERE CompanyCode = ? AND DocumentNumber IN (?, ?)",
            (cc, IPTAL, GECERLI), key)
        log(f"\n  {label}: bulunan = {{k: len(v) for k, v in groups.items()}}")
        if groups:
            side_by_side(f"D) {label} — kolon kolon", cols, groups, (IPTAL, GECERLI, SATIS), IPTAL, GECERLI)

    cols, groups = rows_by_key(
        cur,
        """SELECT ap.* FROM AllPayments ap
           WHERE ap.CompanyCode = ? AND ap.PaymentTypeCode = 7
             AND ap.DocumentDate = '2026-08-31' AND ap.CurrAccCode = (
               SELECT TOP 1 CurrAccCode FROM trInvoiceHeader
               WHERE CompanyCode = ? AND InvoiceNumber = ?)""",
        (cc, cc, IPTAL), "PaymentNumber")
    log(f"\n  AllPayments (çek ödemeleri, aynı müşteri, 31.08): {list(groups.keys())}")
    for k, v in groups.items():
        log("  " + k + ": " + ", ".join(f"{c}={fmt(v[0].get(c))}" for c in cols))

    # E) aynı gün S01 başlıklarında bit kolonlarının dağılımı
    log("\n" + "=" * 72)
    log("E) 31.08.2026 S01 trInvoiceHeader — bit/bayrak kolonlarının dağılımı")
    cur.execute("""
        SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = 'trInvoiceHeader' AND DATA_TYPE = 'bit'
    """)
    bits = [r[0] for r in cur.fetchall()]
    log(f"  bit kolonları: {', '.join(bits)}")
    for b in bits:
        cur.execute(f"""
            SELECT {b}, COUNT(*) FROM trInvoiceHeader
            WHERE CompanyCode = ? AND ProcessCode = 'R' AND StoreCode = 'S01'
              AND InvoiceDate = '2026-08-31'
            GROUP BY {b}""", (cc,))
        log(f"  {b}: " + ", ".join(f"{fmt(r[0])}→{r[1]}" for r in cur.fetchall()))
    cur.execute("""
        SELECT InvoiceNumber, InvoiceTime, IsReturn, IsCompleted, IsPrinted
        FROM trInvoiceHeader
        WHERE CompanyCode = ? AND ProcessCode = 'R' AND StoreCode = 'S01'
          AND InvoiceDate = '2026-08-31' ORDER BY InvoiceNumber""", (cc,))
    for r in cur.fetchall():
        log("  " + " | ".join(fmt(x) for x in r))

    log("\n>>> KEŞİF 40 TAMAM. Çıktının TAMAMINI yapıştır.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log(traceback.format_exc())
    try:
        with open("KESIF40-CIKTI.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(OUT))
        print("\n>>> KESIF40-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
