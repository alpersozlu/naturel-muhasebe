"""NEBIM KEŞİF v11 — KREDİ ÇEKİ avı + gün raporu (salt-okunur).

Amaç: Mağaza Hareket Özeti'ndeki "Toplam Kredi Çeki" kaleminin Nebim'de
hangi tablodan/ödeme kodundan geldiğini bulmak ve mümkünse aynı çalışmada
"kredi çeki > 0 olan günler" listesini mağaza mağaza üretmek.

1) Ödeme tipi sözlük tabloları (bsPaymentType*) — tüm kod/açıklamalar
2) trPaymentLine gerçek kullanım: kod dağılımı + alt-tablo FK doluluk
3) Çek/hediye/voucher tabloları (Cheque/GiftCard/Voucher) — satır sayısı + örnek
4) AllPayments view — kolonlar + örnek satırlar
5) OTOMATİK GÜN RAPORU: açıklaması 'çek' içeren ödeme tipleri için
   gün × mağaza toplamları (toplam > 0 olan günler)

Cikti: KESIF11-CIKTI.txt
"""
from __future__ import annotations

import traceback
from satis_kopru import load_config, connect

OUT = []


def log(*a):
    s = " ".join(str(x) for x in a)
    print(s)
    OUT.append(s)


def norm(s) -> str:
    """Türkçe katlamalı küçük harf ('Çek' -> 'cek')."""
    if s is None:
        return ""
    t = str(s)
    for a, b in (("Ç", "c"), ("ç", "c"), ("İ", "i"), ("I", "i"), ("ı", "i"),
                 ("Ş", "s"), ("ş", "s"), ("Ğ", "g"), ("ğ", "g"),
                 ("Ü", "u"), ("ü", "u"), ("Ö", "o"), ("ö", "o")):
        t = t.replace(a, b)
    return t.lower()


def rowcount(cur, table) -> object:
    try:
        cur.execute(
            "SELECT SUM(row_count) FROM sys.dm_db_partition_stats "
            "WHERE object_id=OBJECT_ID(?) AND index_id IN (0,1)", table)
        return cur.fetchone()[0]
    except Exception:
        try:
            cur.execute(f"SELECT COUNT(*) FROM [{table}]")
            return cur.fetchone()[0]
        except Exception:
            return "?"


def columns(cur, table) -> list[str]:
    cur.execute(
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS "
        "WHERE TABLE_NAME=? ORDER BY ORDINAL_POSITION", table)
    return [r[0] for r in cur.fetchall()]


def sample(cur, table, n=3, maxcols=14):
    """İlk maxcols kolonla TOP n örnek satır bas."""
    try:
        cur.execute(f"SELECT TOP {n} * FROM [{table}]")
        desc = [d[0] for d in cur.description][:maxcols]
        log("    örnek kolonlar: " + ", ".join(desc))
        for r in cur.fetchall():
            vals = [str(v)[:38] for v in list(r)[:maxcols]]
            log("    | " + " | ".join(vals))
    except Exception as e:
        log(f"    örnek alınamadı: {str(e)[:150]}")


def main():
    cfg = load_config()
    company = cfg.get("company_code", 1)
    log(">>> NEBIM KEŞİF v11 — KREDİ ÇEKİ avı + gün raporu")
    conn = connect(cfg)
    cur = conn.cursor()

    # ── 1) Ödeme tipi sözlükleri ─────────────────────────────────────────
    log("\n=== 1) ÖDEME TİPİ SÖZLÜK TABLOLARI ===")
    cur.execute(
        "SELECT DISTINCT TABLE_NAME FROM INFORMATION_SCHEMA.COLUMNS "
        "WHERE TABLE_NAME LIKE '%PaymentType%' ORDER BY TABLE_NAME")
    dict_tables = [r[0] for r in cur.fetchall()]
    log(f"tablolar: {dict_tables}")

    cek_codes = {}  # code -> aciklama (açıklaması 'çek' içerenler)
    all_types = {}  # code -> aciklama (hepsi)
    for t in dict_tables:
        cols = columns(cur, t)
        n = rowcount(cur, t)
        log(f"\n--- {t} (satır: {n})  kolonlar: {cols}")
        if not n or n == "?" or int(n) > 500:
            continue
        code_col = next((c for c in cols if norm(c).endswith("code") and "paymenttype" in norm(c)), None)
        desc_col = next((c for c in cols if "desc" in norm(c)), None)
        lang_col = next((c for c in cols if norm(c) == "langcode"), None)
        try:
            if code_col and desc_col:
                q = f"SELECT [{code_col}], [{desc_col}] FROM [{t}]"
                if lang_col:
                    q += f" WHERE [{lang_col}]='TR'"
                cur.execute(q)
                for code, d in cur.fetchall():
                    log(f"    kod {code} = {d}")
                    all_types[str(code)] = str(d)
                    if "cek" in norm(d):
                        cek_codes[str(code)] = str(d)
            else:
                sample(cur, t, n=20, maxcols=6)
        except Exception as e:
            log(f"    okunamadı: {str(e)[:150]}")
    log(f"\n>>> 'çek' içeren ödeme tipleri: {cek_codes if cek_codes else 'BULUNAMADI'}")

    # ── 2) trPaymentLine gerçek kullanım ────────────────────────────────
    log("\n=== 2) trPaymentLine KULLANIM ===")
    try:
        cur.execute(
            "SELECT PaymentTypeCode, COUNT(*) FROM trPaymentLine "
            "GROUP BY PaymentTypeCode ORDER BY PaymentTypeCode")
        for code, n in cur.fetchall():
            log(f"    PaymentTypeCode {code} ({all_types.get(str(code), '?')}): {n} satır")
    except Exception as e:
        log(f"    hata: {str(e)[:150]}")
    # alt-tablo FK kolonlarının doluluğu
    try:
        pl_cols = columns(cur, "trPaymentLine")
        fk_cols = [c for c in pl_cols if norm(c).endswith("lineid") and norm(c) != "paymentlineid"]
        for c in fk_cols:
            cur.execute(f"SELECT COUNT(*) FROM trPaymentLine WHERE [{c}] IS NOT NULL")
            n = cur.fetchone()[0]
            if n:
                log(f"    {c}: {n} dolu  <<<")
            else:
                log(f"    {c}: 0")
    except Exception as e:
        log(f"    FK doluluk hatası: {str(e)[:150]}")
    # trPaymentHeader kolonları (tarih/mağaza için)
    try:
        log("    trPaymentHeader kolonları: " + ", ".join(columns(cur, "trPaymentHeader")[:30]))
    except Exception as e:
        log(f"    trPaymentHeader: {str(e)[:120]}")

    # ── 3) Çek / hediye / voucher tabloları ─────────────────────────────
    log("\n=== 3) ÇEK/HEDİYE/VOUCHER TABLOLARI ===")
    cur.execute(
        "SELECT DISTINCT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES "
        "WHERE TABLE_NAME LIKE '%Cheque%' OR TABLE_NAME LIKE '%GiftCard%' "
        "   OR TABLE_NAME LIKE '%Voucher%' OR TABLE_NAME LIKE '%CreditNote%' "
        "ORDER BY TABLE_NAME")
    cek_tables = [r[0] for r in cur.fetchall()]
    log(f"tablolar: {cek_tables}")
    for t in cek_tables:
        n = rowcount(cur, t)
        log(f"\n--- {t} (satır: {n})")
        if n and n != "?" and int(n) > 0:
            log("    kolonlar: " + ", ".join(columns(cur, t)[:25]))
            sample(cur, t, n=3)

    # ── 4) AllPayments view ─────────────────────────────────────────────
    log("\n=== 4) PAYMENT VIEW'LARI ===")
    cur.execute(
        "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.VIEWS "
        "WHERE TABLE_NAME LIKE '%Payment%' ORDER BY TABLE_NAME")
    views = [r[0] for r in cur.fetchall()]
    log(f"view'lar: {views}")
    ap = next((v for v in views if norm(v) == "allpayments"), None) or \
         next((v for v in views if "allpayment" in norm(v)), None)
    ap_cols = []
    if ap:
        ap_cols = columns(cur, ap)
        log(f"\n--- {ap} kolonları: {ap_cols}")
        try:
            cur.execute(f"SELECT TOP 5 * FROM [{ap}]")
            desc = [d[0] for d in cur.description][:14]
            log("    örnek kolonlar: " + ", ".join(desc))
            for r in cur.fetchall():
                log("    | " + " | ".join(str(v)[:30] for v in list(r)[:14]))
        except Exception as e:
            log(f"    örnek alınamadı: {str(e)[:150]}")

    # ── 5) OTOMATİK GÜN RAPORU ──────────────────────────────────────────
    log("\n=== 5) GÜN RAPORU — kredi çeki > 0 olan günler ===")
    if not cek_codes:
        log("    'çek' içeren ödeme tipi kodu bulunamadı — yukarıdaki 1-4")
        log("    bölümlerinin TAMAMINI yapıştır, rapor sorgusunu ona göre yazacağız.")
    elif not ap:
        log(f"    çek kodları var ({cek_codes}) ama AllPayments view bulunamadı.")
        log("    Bölüm 2-3 çıktısına göre tablo-bazlı sorgu yazılacak; tamamını yapıştır.")
    else:
        # kolonları esnek seç
        def pick(cands):
            for c in cands:
                hit = next((x for x in ap_cols if norm(x) == norm(c)), None)
                if hit:
                    return hit
            return None

        date_col = pick(["DocumentDate", "PaymentDate", "OperationDate", "InvoiceDate", "CreatedDate"])
        store_col = pick(["StoreCode", "OfficeCode", "POSStoreCode"])
        amt_col = pick(["Loc_Payment", "PaymentLoc", "Payment", "Amount", "CurrAccAmount"])
        type_col = pick(["PaymentTypeCode", "PaymentType"])
        comp_col = pick(["CompanyCode"])
        log(f"    seçilen kolonlar: tarih={date_col} mağaza={store_col} tutar={amt_col} tip={type_col}")
        if not (date_col and amt_col and type_col):
            log("    gerekli kolonlar eksik — view kolon listesine göre elle yazacağız.")
        else:
            codes = ",".join(cek_codes.keys())
            store_sel = f"[{store_col}]" if store_col else "'?'"
            comp_where = f" AND [{comp_col}]={int(company)}" if comp_col else ""
            q = (
                f"SELECT CAST([{date_col}] AS date) AS gun, {store_sel} AS magaza, "
                f"       [{type_col}] AS tip, SUM([{amt_col}]) AS toplam, COUNT(*) AS adet "
                f"FROM [{ap}] "
                f"WHERE [{type_col}] IN ({codes}) AND [{date_col}] >= '2026-01-01'{comp_where} "
                f"GROUP BY CAST([{date_col}] AS date), {store_sel}, [{type_col}] "
                f"HAVING SUM([{amt_col}]) > 0 "
                f"ORDER BY gun, magaza")
            log(f"    SQL: {q}")
            try:
                cur.execute(q)
                rows = cur.fetchall()
                log(f"\n    >>> KREDİ ÇEKİ > 0 OLAN GÜNLER ({len(rows)} kayıt):")
                log("    GÜN        | MAĞAZA | TİP | TOPLAM | ADET")
                for r in rows:
                    tip = all_types.get(str(r[2]), r[2])
                    log(f"    {r[0]} | {r[1]} | {tip} | {r[3]} | {r[4]}")
                if not rows:
                    log("    (2026'da hiç yok)")
            except Exception as e:
                log(f"    sorgu hatası: {str(e)[:250]}")

    log("\n>>> KEŞİF v11 TAMAM. Çıktının TAMAMINI yapıştır.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log(traceback.format_exc())
    try:
        with open("KESIF11-CIKTI.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(OUT))
        print("\n>>> KESIF11-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
