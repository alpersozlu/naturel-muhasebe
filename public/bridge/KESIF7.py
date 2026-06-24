"""NEBIM KEŞİF v7 — YÖNETİM İSKONTO AÇIKLAMASI avı (salt-okunur).

Kullanici notu: trInvoiceHeader.Description = FIS aciklamasi (kasiyer notu), ISTENEN DEGIL.
Istenen: "Yonetim Ozel talebi" (DiscountReasonCode=1) secilip SIFRE girilerek manuel
iskonto yapilirken yonetimin yazdigi AYRI aciklama. Bu hangi tabloda/kolonda?

Strateji: reason=1 faturalarina odaklan, fatura/satira bagli TUM tablolarda dolu
metin (description/note/explanation/aciklama/reason/comment) alanlarini tara,
hangisi bu faturalar icin DOLU geliyorsa = aradigimiz alan.

Hicbir sey yazmaz/gondermez. Cikti: KESIF7-CIKTI.txt
"""
from __future__ import annotations

import traceback
from satis_kopru import load_config, connect

OUT = []


def log(*a):
    s = " ".join(str(x) for x in a)
    print(s)
    OUT.append(s)


TEXT_KW = ["description", "note", "explan", "aciklama", "açıklama",
           "comment", "remark", "memo", "reason", "subreason"]
KEY_COLS = ["InvoiceLineID", "InvoiceHeaderID", "InvoiceNumber", "DocumentNumber"]
TEXT_TYPES = {"varchar", "nvarchar", "char", "nchar", "text", "ntext"}


def _inlist(values):
    out = []
    for v in values:
        s = str(v).replace("'", "''")
        out.append(f"'{s}'")
    return ",".join(out)


def main():
    cfg = load_config()
    company = cfg.get("company_code", 1)
    log(">>> NEBIM KEŞİF v7 — yönetim iskonto açıklaması avı")
    log(f">>> DB={cfg.get('database')} Şirket={company}")
    conn = connect(cfg)
    cur = conn.cursor()

    # 1) reason=1 faturalar (en yeni 25)
    cur.execute(
        "SELECT TOP 25 h.InvoiceHeaderID, h.InvoiceNumber, h.InvoiceDate, h.Description "
        "FROM trInvoiceHeader h "
        "WHERE h.ProcessCode='R' AND h.CompanyCode=? AND h.DiscountReasonCode=1 "
        "ORDER BY h.InvoiceDate DESC, h.InvoiceNumber DESC",
        company)
    rows = cur.fetchall()
    header_ids = [str(r[0]) for r in rows]
    inv_numbers = [str(r[1]) for r in rows]
    log("\n=== BÖLÜM 1 — reason=1 ('Yönetim Özel talebi') son 25 fatura ===")
    log("(Description = FİŞ açıklaması, KARŞILAŞTIRMA için; aradığımız BU DEĞİL)")
    for r in rows:
        desc = (str(r[3]).replace("\n", " ").replace("\r", " ")[:50]) if r[3] else ""
        log(f"  {r[1]} | {r[2]} | fis_acik='{desc}'")
    if not header_ids:
        log("reason=1 fatura bulunamadı — durduruldu.")
        return

    # 2) bu faturalarin satir id'leri
    cur.execute(
        f"SELECT InvoiceLineID FROM trInvoiceLine "
        f"WHERE InvoiceHeaderID IN ({_inlist(header_ids)})")
    line_ids = [str(r[0]) for r in cur.fetchall()]
    log(f"\n  ({len(header_ids)} fatura, {len(line_ids)} satır taranacak)")

    id_sets = {
        "InvoiceLineID": line_ids,
        "InvoiceHeaderID": header_ids,
        "InvoiceNumber": inv_numbers,
        "DocumentNumber": inv_numbers,
    }

    # 3) aday tablolar: bir KEY kolonu + bir METİN kolonu olan tüm tablolar
    cur.execute(
        "SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE "
        "FROM INFORMATION_SCHEMA.COLUMNS "
        "WHERE TABLE_NAME IN ("
        "  SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE='BASE TABLE')")
    cols_by_table = {}
    for t, c, dt in cur.fetchall():
        cols_by_table.setdefault(t, []).append((c, dt.lower()))

    candidates = []  # (table, keycol, textcol)
    for t, cols in cols_by_table.items():
        names = {c for c, _ in cols}
        keycol = next((k for k in KEY_COLS if k in names), None)
        if not keycol:
            continue
        for c, dt in cols:
            if dt not in TEXT_TYPES:
                continue
            cl = c.lower()
            if any(k in cl for k in TEXT_KW):
                candidates.append((t, keycol, c))

    log(f"\n=== BÖLÜM 2 — aday tablo.kolon sayısı: {len(candidates)} ===")
    log("(reason=1 faturalar için DOLU gelenler = aradığımız yönetim açıklaması)")

    hits = 0
    for t, keycol, textcol in candidates:
        ids = id_sets.get(keycol) or []
        if not ids:
            continue
        try:
            sql = (f"SELECT TOP 5 [{textcol}] AS v, COUNT(*) AS n "
                   f"FROM [{t}] "
                   f"WHERE [{keycol}] IN ({_inlist(ids)}) "
                   f"  AND [{textcol}] IS NOT NULL AND LTRIM(RTRIM(CAST([{textcol}] AS nvarchar(400))))<>'' "
                   f"GROUP BY [{textcol}] ORDER BY n DESC")
            cur.execute(sql)
            res = cur.fetchall()
        except Exception as e:
            continue
        if not res:
            continue
        hits += 1
        log(f"\n*** DOLU: {t}.{textcol}  (anahtar={keycol}) ***")
        for v, n in res:
            sval = str(v).replace("\n", " ").replace("\r", " ")
            if len(sval) > 80:
                sval = sval[:80] + "…"
            log(f"      {n:>4} ×  {sval!r}")

    if hits == 0:
        log("\n!!! reason=1 faturalar için HİÇBİR metin alanı dolu gelmedi.")
        log("    Açıklama fatura/satıra bağlı olmayabilir (ayrı log tablosu?).")

    # 4) prime suspect: discount engine audit log
    log("\n=== BÖLÜM 3 — discount engine audit log (yapı + örnek) ===")
    for tname in ("auCustomizedDiscountEngineServiceLog",
                  "auCustomizedDiscountEngineServiceGetReturnableItemsLog"):
        try:
            cur.execute(
                "SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS "
                "WHERE TABLE_NAME=? ORDER BY ORDINAL_POSITION", tname)
            cc = cur.fetchall()
            if not cc:
                log(f"\n  [{tname}] yok")
                continue
            log(f"\n  [{tname}] kolonlar: " + ", ".join(f"{c}:{d}" for c, d in cc))
        except Exception as e:
            log(f"  [{tname}] hata: {str(e)[:120]}")

    log("\n>>> KEŞİF v7 TAMAM. Bu dosyanın TAMAMINI bana yapıştır.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log(traceback.format_exc())
    try:
        with open("KESIF7-CIKTI.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(OUT))
        print("\n>>> KESIF7-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
