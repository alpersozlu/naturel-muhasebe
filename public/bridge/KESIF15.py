"""NEBIM KEŞİF v15 — YAZMA ÖNCESİ HAZIRLIK (salt-okunur).

YUKLE1 (hediye çeki tipi + test çekleri) yazılmadan önce gereken
son bilgiler. HİÇBİR YAZMA YAPMAZ.

A) cdDiscountVoucherType: TÜM kolon tipleri + mevcut kaydın HAM dökümü
B) cdDiscountVoucher + cdDiscountVoucherTypeDesc kolon tipleri
C) bsDiscountLevelOfUse sözlüğü (kullanım düzeyi anlamları)
D) srRefNumberDiscountVoucher yapısı
E) Ürün listesi tabloları (ItemList) + '2.%50HAZ' örneği
F) 'DiscountVoucher' kolonu içeren tablo haritası
G) Yedek düzeni (msdb son yedekler)

Cikti: KESIF15-CIKTI.txt
"""
from __future__ import annotations

import traceback
from satis_kopru import load_config, connect

OUT = []


def log(*a):
    s = " ".join(str(x) for x in a)
    print(s)
    OUT.append(s)


def kisalt(v, n=60):
    s = "<NULL>" if v is None else str(v)
    s = s.replace("\r", " ").replace("\n", " ").strip()
    return (s[: n - 1] + "…") if len(s) > n else s


def bolum(ad):
    def dekore(f):
        def sarili(*a, **kw):
            log(f"\n=== {ad} ===")
            try:
                f(*a, **kw)
            except Exception:
                log("BÖLÜM HATASI:\n" + traceback.format_exc())
        return sarili
    return dekore


def tipler(cur, tablo):
    cur.execute(
        "SELECT COLUMN_NAME, DATA_TYPE, "
        "       COALESCE(CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION, 0), "
        "       IS_NULLABLE, COLUMN_DEFAULT "
        "FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = ? "
        "ORDER BY ORDINAL_POSITION", tablo)
    log(f"-- {tablo} kolonları (ad | tip | boy | null? | default):")
    for r in cur.fetchall():
        log(f"  {r[0]} | {r[1]} | {r[2]} | {r[3]} | {kisalt(r[4], 30)}")


@bolum("A) cdDiscountVoucherType — TİPLER + HAM KAYIT")
def a_tip(cur):
    tipler(cur, "cdDiscountVoucherType")
    log("-- Mevcut kayıt(lar), TÜM alanlar ham dökum:")
    cur.execute("SELECT * FROM cdDiscountVoucherType")
    adlar = [d[0] for d in cur.description]
    for i, row in enumerate(cur.fetchall(), 1):
        log(f"  --- kayıt {i}:")
        for ad, v in zip(adlar, row):
            log(f"     {ad} = {kisalt(v)}")


@bolum("B) cdDiscountVoucher + Desc — KOLON TİPLERİ")
def b_voucher(cur):
    tipler(cur, "cdDiscountVoucher")
    tipler(cur, "cdDiscountVoucherTypeDesc")


@bolum("C) KULLANIM DÜZEYİ SÖZLÜĞÜ")
def c_duzey(cur):
    for t in ("bsDiscountLevelOfUse", "bsDiscountLevelOfUseDesc"):
        cur.execute(f"SELECT * FROM [{t}]")
        adlar = [d[0] for d in cur.description]
        log(f"-- {t}: " + " | ".join(adlar))
        for r in cur.fetchall():
            log("   " + " | ".join(kisalt(v, 40) for v in r))


@bolum("D) srRefNumberDiscountVoucher YAPISI")
def d_ref(cur):
    tipler(cur, "srRefNumberDiscountVoucher")
    cur.execute("SELECT COUNT(*) FROM srRefNumberDiscountVoucher")
    log(f"  satır sayısı: {cur.fetchone()[0]}")


@bolum("E) ÜRÜN LİSTESİ TABLOLARI")
def e_liste(cur):
    cur.execute(
        "SELECT t.name, SUM(p.rows) FROM sys.tables t "
        "JOIN sys.partitions p ON p.object_id = t.object_id "
        "     AND p.index_id IN (0,1) "
        "WHERE t.name LIKE '%ItemList%' GROUP BY t.name ORDER BY t.name")
    for t, n in cur.fetchall():
        log(f"  {t} | {n}")
    # örnek: kampanyalarda kullanılan liste kodu
    try:
        cur.execute("SELECT TOP 5 * FROM cdItemListHeader "
                    "ORDER BY CreatedDate DESC")
        adlar = [d[0] for d in cur.description]
        log("-- cdItemListHeader son 5: " + " | ".join(adlar))
        for r in cur.fetchall():
            log("   " + " | ".join(kisalt(v, 24) for v in r))
    except Exception as e:
        log(f"  cdItemListHeader okunamadı ({e}) — tablo adı farklı olabilir")


@bolum("F) 'DiscountVoucher' KOLONU İÇEREN TABLOLAR")
def f_harita(cur):
    cur.execute(
        "SELECT t.name, c.name FROM sys.columns c "
        "JOIN sys.tables t ON t.object_id = c.object_id "
        "WHERE c.name LIKE '%DiscountVoucher%' ORDER BY t.name, c.name")
    for t, c in cur.fetchall():
        log(f"  {t}.{c}")


@bolum("G) YEDEK DÜZENİ (msdb)")
def g_yedek(cur):
    cur.execute(
        "SELECT TOP 8 database_name, type, backup_finish_date "
        "FROM msdb.dbo.backupset "
        "WHERE database_name = 'Derimod_V3' "
        "ORDER BY backup_finish_date DESC")
    rows = cur.fetchall()
    if not rows:
        log("  Derimod_V3 için msdb'de yedek KAYDI YOK!")
    for r in rows:
        log(f"  {r[0]} | tip {r[1]} | {r[2]}")


def main():
    cfg = load_config()
    log(">>> NEBIM KEŞİF v15 — YAZMA ÖNCESİ HAZIRLIK (salt-okunur)")
    conn = connect(cfg)
    cur = conn.cursor()
    a_tip(cur)
    b_voucher(cur)
    c_duzey(cur)
    d_ref(cur)
    e_liste(cur)
    f_harita(cur)
    g_yedek(cur)
    log("\n>>> KEŞİF v15 TAMAM. Çıktının TAMAMINI yapıştır.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log(traceback.format_exc())
    try:
        with open("KESIF15-CIKTI.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(OUT))
        print("\n>>> KESIF15-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
