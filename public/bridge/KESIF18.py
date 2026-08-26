"""NEBIM KEŞİF v18 — BARKOD TİPLERİ + ÜRÜN BARKOD ÇAKIŞMASI (salt-okunur).

Amaç: hediye çekinin POS'ta ÜRÜN OKUTMA ALANINDAN okutulabilmesi
(barkod tipi yönlendirmesi) mümkün mü?

A) Barkod tipi tabloları (%BarcodeType%) + içerikleri
B) prItemBarcode: ürün barkodu önek dağılımı + '290%' çakışma kontrolü
C) 'Barcode' kolonu içeren yapılandırma tabloları haritası
D) dfGlobalDefault + cdPOSTerminal'deki barkod/çek ile ilgili alan değerleri
HİÇBİR YAZMA YAPMAZ. Cikti: KESIF18-CIKTI.txt
"""
from __future__ import annotations

import traceback
from satis_kopru import load_config, connect

OUT = []


def log(*a):
    s = " ".join(str(x) for x in a)
    print(s)
    OUT.append(s)


def kisalt(v, n=50):
    s = "-" if v is None else str(v)
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


def dump_tablo(cur, tablo, limit=80):
    cur.execute(f"SELECT COUNT(*) FROM [{tablo}]")
    n = cur.fetchone()[0]
    if n == 0:
        log(f"-- {tablo}: BOŞ")
        return
    if n > limit:
        log(f"-- {tablo}: {n} satır (> {limit}, dökülmedi)")
        return
    cur.execute(f"SELECT * FROM [{tablo}]")
    adlar = [d[0] for d in cur.description]
    log(f"-- {tablo} ({n}): " + " | ".join(adlar))
    for r in cur.fetchall():
        log("   " + " | ".join(kisalt(v, 30) for v in r))


@bolum("A) BARKOD TİPİ TABLOLARI")
def a_tipler(cur):
    cur.execute(
        "SELECT t.name, SUM(p.rows) FROM sys.tables t "
        "JOIN sys.partitions p ON p.object_id = t.object_id "
        "     AND p.index_id IN (0,1) "
        "WHERE t.name LIKE '%BarcodeType%' OR t.name LIKE '%BarcodeDef%' "
        "GROUP BY t.name ORDER BY t.name")
    tablolar = cur.fetchall()
    for t, n in tablolar:
        log(f"  {t} | {n}")
    for t, n in tablolar:
        dump_tablo(cur, t)


@bolum("B) ÜRÜN BARKODLARI — ÖNEK DAĞILIMI + 290 ÇAKIŞMASI")
def b_urun(cur):
    cur.execute("SELECT COUNT(*) FROM prItemBarcode")
    log(f"-- toplam ürün barkodu: {cur.fetchone()[0]}")
    cur.execute("SELECT LEN(Barcode), COUNT(*) FROM prItemBarcode "
                "GROUP BY LEN(Barcode) ORDER BY 2 DESC")
    log("-- uzunluk dağılımı:")
    for r in cur.fetchall():
        log(f"   {r[0]} hane | {r[1]}")
    cur.execute("SELECT TOP 15 LEFT(Barcode,3), COUNT(*) FROM prItemBarcode "
                "GROUP BY LEFT(Barcode,3) ORDER BY 2 DESC")
    log("-- önek (ilk 3 hane) dağılımı:")
    for r in cur.fetchall():
        log(f"   '{r[0]}' | {r[1]}")
    cur.execute("SELECT COUNT(*) FROM prItemBarcode WHERE Barcode LIKE '290%'")
    log(f"-- '290' ile başlayan ÜRÜN barkodu (çakışma riski): {cur.fetchone()[0]}")
    cur.execute("SELECT TOP 5 Barcode, ItemCode FROM prItemBarcode "
                "WHERE Barcode LIKE '29%'")
    for r in cur.fetchall():
        log(f"   '29..' örnek: {r[0]} -> {r[1]}")


@bolum("C) 'BarcodeType' KOLONU İÇEREN TABLOLAR")
def c_harita(cur):
    cur.execute(
        "SELECT t.name, c.name FROM sys.columns c "
        "JOIN sys.tables t ON t.object_id = c.object_id "
        "WHERE c.name LIKE '%BarcodeType%' ORDER BY t.name, c.name")
    for t, c in cur.fetchall():
        log(f"  {t}.{c}")


@bolum("D) POS/GLOBAL AYARLARDA BARKOD-ÇEK ALANLARI")
def d_ayarlar(cur):
    for tablo in ("dfGlobalDefault", "cdPOSTerminal"):
        cur.execute(
            "SELECT c.name FROM sys.columns c "
            "JOIN sys.tables t ON t.object_id = c.object_id "
            "WHERE t.name = ? AND (c.name LIKE '%Barcode%' "
            "   OR c.name LIKE '%Voucher%' OR c.name LIKE '%GiftCard%')", tablo)
        kolonlar = [r[0] for r in cur.fetchall()]
        log(f"-- {tablo} ilgili kolonlar: {', '.join(kolonlar) or '(yok)'}")
        if kolonlar:
            cur.execute(f"SELECT {', '.join('['+k+']' for k in kolonlar)} "
                        f"FROM [{tablo}]")
            for r in cur.fetchall():
                log("   " + " | ".join(f"{k}={kisalt(v, 24)}"
                                       for k, v in zip(kolonlar, r)))


def main():
    cfg = load_config()
    log(">>> NEBIM KEŞİF v18 — BARKOD TİPLERİ (salt-okunur)")
    conn = connect(cfg)
    cur = conn.cursor()
    a_tipler(cur)
    b_urun(cur)
    c_harita(cur)
    d_ayarlar(cur)
    log("\n>>> KEŞİF v18 TAMAM. Çıktının TAMAMINI yapıştır.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log(traceback.format_exc())
    try:
        with open("KESIF18-CIKTI.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(OUT))
        print("\n>>> KESIF18-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
