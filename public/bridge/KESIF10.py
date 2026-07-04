"""NEBIM KEŞİF v10 — BARKOD tablosu avı (salt-okunur).

Amaç: Outlet reyonu el terminaliyle okutuldu (barkod listesi DocuFlow'da).
Satış satırlarını bu barkodlarla KESİN eşleştirmek için Nebim'in
barkod -> ItemCode+ColorCode+ItemDim1Code tablosunu bulmamız gerekiyor.

1) 'Barcode' kolonu olan tabloları listeler (kolonlar + satır sayısı)
2) Outlet sayımından 15 GERÇEK barkodu aday tabloda çözümler (kanıt)
3) Son 30 gün perakende satış satırlarının kaçının barkod karşılığı var
   (köprüye eklenecek join şablonunun kapsama testi)

Cikti: KESIF10-CIKTI.txt
"""
from __future__ import annotations

import traceback
from satis_kopru import load_config, connect

OUT = []

# Outlet sayımından örnek barkodlar (Lefkoşa, 03.07.2026 — üç farklı GS1 öneki)
SAMPLE_BARCODES = [
    "8683691843310", "8683691814013", "8683691624247", "8683691594489",
    "8683691551857", "8683691084843", "8683691262371", "8683691576355",
    "8683691605253", "8683691747748", "5471701797516", "5471701913879",
    "5471701851669", "5471701986972", "8684868200882",
]


def log(*a):
    s = " ".join(str(x) for x in a)
    print(s)
    OUT.append(s)


def main():
    cfg = load_config()
    company = cfg.get("company_code", 1)
    log(">>> NEBIM KEŞİF v10 — barkod tablosu avı")
    conn = connect(cfg)
    cur = conn.cursor()

    # 1) Barcode kolonu olan tablolar
    cur.execute(
        "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.COLUMNS "
        "WHERE COLUMN_NAME='Barcode' ORDER BY TABLE_NAME")
    tables = [r[0] for r in cur.fetchall()]
    log(f"\n=== 'Barcode' kolonu olan tablolar ({len(tables)}): {tables} ===")

    candidates = []
    for t in tables:
        cur.execute(
            "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS "
            "WHERE TABLE_NAME=? ORDER BY ORDINAL_POSITION", t)
        cols = [r[0] for r in cur.fetchall()]
        try:
            cur.execute(
                "SELECT SUM(row_count) FROM sys.dm_db_partition_stats "
                "WHERE object_id=OBJECT_ID(?) AND index_id IN (0,1)", t)
            n = cur.fetchone()[0]
        except Exception:
            n = "?"
        has_item = "ItemCode" in cols
        has_color = "ColorCode" in cols
        has_dim = "ItemDim1Code" in cols
        mark = " <<< ADAY" if (has_item and has_color and has_dim) else ""
        log(f"\n--- {t} (satır: {n}){mark}")
        log("  kolonlar: " + ", ".join(cols[:25]) + (" …" if len(cols) > 25 else ""))
        if has_item and has_color and has_dim:
            candidates.append(t)

    if not candidates:
        log("\n!!! ItemCode+ColorCode+ItemDim1Code içeren barkod tablosu bulunamadı."
            " Yukarıdaki tablo/kolon listesini yapıştır, elle seçeriz.")
        return

    best = candidates[0]
    log(f"\n=== ADAY TABLOLAR: {candidates} — test edilen: {best} ===")

    # 2) Örnek barkodları çöz (outlet sayımından gerçek barkodlar)
    log(f"\n=== ÖRNEK ÇÖZÜMLEME ({best}) — outlet sayımından 15 barkod ===")
    placeholders = ",".join("?" for _ in SAMPLE_BARCODES)
    try:
        cur.execute(
            f"SELECT Barcode, ItemCode, ColorCode, ItemDim1Code "
            f"FROM [{best}] WHERE Barcode IN ({placeholders})",
            *SAMPLE_BARCODES)
        rows = cur.fetchall()
        found = {str(r[0]).strip() for r in rows}
        for r in rows:
            log(f"   {r[0]} -> Item={r[1]} Color={r[2]} Beden={r[3]}")
        missing = [b for b in SAMPLE_BARCODES if b not in found]
        log(f"   ÇÖZÜLEN: {len(found)}/{len(SAMPLE_BARCODES)}"
            + (f" | ÇÖZÜLEMEYEN: {missing}" if missing else ""))
    except Exception as e:
        log(f"   hata: {str(e)[:200]}")

    # 3) Kapsama testi — son 30 gün satış satırı barkod tablosunda karşılık buluyor mu?
    log(f"\n=== KAPSAMA TESTİ — son 30 gün perakende satırları ↔ {best} ===")
    try:
        cur.execute(
            f"SELECT COUNT(*) AS satir, "
            f"  SUM(CASE WHEN b.cnt >= 1 THEN 1 ELSE 0 END) AS eslesen, "
            f"  SUM(CASE WHEN b.cnt > 1 THEN 1 ELSE 0 END) AS coklu "
            f"FROM ( "
            f"  SELECT l.ItemCode, l.ColorCode, l.ItemDim1Code "
            f"  FROM trInvoiceHeader h "
            f"  JOIN trInvoiceLine l ON l.InvoiceHeaderID = h.InvoiceHeaderID "
            f"  WHERE h.ProcessCode='R' AND h.CompanyCode=? "
            f"    AND h.InvoiceDate >= DATEADD(day,-30,GETDATE()) "
            f") s "
            f"OUTER APPLY ( "
            f"  SELECT COUNT(*) AS cnt FROM [{best}] bb "
            f"  WHERE bb.ItemCode = s.ItemCode "
            f"    AND bb.ColorCode = s.ColorCode "
            f"    AND bb.ItemDim1Code = s.ItemDim1Code "
            f") b", company)
        r = cur.fetchone()
        log(f"   satış satırı: {r[0]} | barkod karşılığı olan: {r[1]} | ÇOKLU eşleşen: {r[2]}")
        log("   (coklu>0 ise köprü join'inde TOP 1 kullanılır — sorun değil)")
    except Exception as e:
        log(f"   hata: {str(e)[:200]}")

    # 4) Uçtan uca örnek: son 5 satış satırı + bulunan barkod
    log(f"\n=== UÇTAN UCA ÖRNEK — son 5 satış satırı + barkodu ===")
    try:
        cur.execute(
            f"SELECT TOP 5 h.InvoiceNumber, l.ItemCode, l.ColorCode, l.ItemDim1Code, "
            f"  (SELECT TOP 1 bb.Barcode FROM [{best}] bb "
            f"   WHERE bb.ItemCode=l.ItemCode AND bb.ColorCode=l.ColorCode "
            f"     AND bb.ItemDim1Code=l.ItemDim1Code) AS Barcode "
            f"FROM trInvoiceHeader h "
            f"JOIN trInvoiceLine l ON l.InvoiceHeaderID = h.InvoiceHeaderID "
            f"WHERE h.ProcessCode='R' AND h.CompanyCode=? "
            f"ORDER BY h.InvoiceDate DESC, h.InvoiceNumber DESC", company)
        for r in cur.fetchall():
            log(f"   {r[0]} | {r[1]}/{r[2]}/{r[3]} -> barkod: {r[4]}")
    except Exception as e:
        log(f"   hata: {str(e)[:200]}")

    log("\n>>> KEŞİF v10 TAMAM. Tamamını yapıştır.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log(traceback.format_exc())
    try:
        with open("KESIF10-CIKTI.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(OUT))
        print("\n>>> KESIF10-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
