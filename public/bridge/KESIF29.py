"""NEBIM KEŞİF v29 — TEST ÜRÜNÜ BARKODLARI + FİYAT (salt-okunur).

A) 26PFD510410 kimlik + HCGECERLI durumu
B) Barkodları (renk/beden) + Lefkoşa (S01) stoğu
C) Son satış fiyatı (kolon adı şemadan tespit edilir)
D) YEDEK: S01'de stoklu, listede GEÇERLİ, TEK BAŞINA 1.000 TL üstü 8 ürün + barkod
Cikti: KESIF29-CIKTI.txt
"""
from __future__ import annotations

import traceback
from satis_kopru import load_config, connect

OUT = []
URUN = "26PFD510410"


def log(*a):
    s = " ".join(str(x) for x in a)
    print(s)
    OUT.append(s)


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


def kolonlar(cur, tablo):
    cur.execute("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS "
                "WHERE TABLE_NAME = ?", tablo)
    return [r[0] for r in cur.fetchall()]


def fiyat_kolonu(cur):
    """trInvoiceLine'da KDV dahil birim/satır tutarını taşıyan kolonu bul."""
    kols = kolonlar(cur, "trInvoiceLine")
    for aday in ("PriceVI", "AmountWithVAT", "Price", "UnitPrice",
                 "LineGrossAmount", "LineNetAmount", "Amount"):
        if aday in kols:
            return aday, kols
    return None, kols


@bolum("A) ÜRÜN KİMLİĞİ")
def a_kimlik(cur):
    cur.execute("SELECT TOP 1 ItemDescription FROM cdItemDesc WHERE ItemCode=?", URUN)
    r = cur.fetchone()
    log(f"  {URUN} — ad: {r[0] if r else '(bulunamadı)'}")
    cur.execute("SELECT COUNT(*) FROM prItemListContent "
                "WHERE ItemListCode=N'HCGECERLI' AND ItemCode=?", URUN)
    log(f"  HCGECERLI listesinde: {'EVET ✓' if cur.fetchone()[0] else 'HAYIR ✗'}")


@bolum("B) BARKODLAR + STOK")
def b_barkod(cur):
    bk = kolonlar(cur, "prItemBarcode")
    sec = [k for k in ("Barcode", "ColorCode", "ItemDim1Code", "ItemDim2Code",
                       "ItemDim3Code", "BarcodeTypeCode") if k in bk]
    cur.execute(f"SELECT TOP 60 {', '.join(sec)} FROM prItemBarcode "
                f"WITH(NOLOCK) WHERE ItemCode = ?", URUN)
    satirlar = cur.fetchall()
    log(f"  kolonlar: {' | '.join(sec)}   (toplam {len(satirlar)} barkod)")
    for r in satirlar:
        log("   " + " | ".join(str(x).strip() if x is not None else "-" for x in r))

    sk = kolonlar(cur, "trStock")
    grup = [k for k in ("WarehouseCode", "ColorCode", "ItemDim1Code") if k in sk]
    if not grup:
        log("  (trStock'ta beklenen kolonlar yok)")
        return
    cur.execute(f"""
        SELECT {', '.join(grup)}, SUM(Qty1)
        FROM trStock WITH(NOLOCK)
        WHERE ItemCode = ? AND ItemTypeCode = 1
        GROUP BY {', '.join(grup)}
        HAVING SUM(Qty1) > 0
        ORDER BY SUM(Qty1) DESC
        """, URUN)
    log(f"\n  STOK ({' | '.join(grup)} | adet):")
    bulundu = False
    for r in cur.fetchall():
        bulundu = True
        isaret = " <<< LEFKOŞA" if str(r[0]).strip().upper() == "S01" else ""
        log("   " + " | ".join(str(x).strip() if x is not None else "-"
                               for x in r) + isaret)
    if not bulundu:
        log("   (stok yok)")


@bolum("C) SON SATIŞ FİYATI")
def c_fiyat(cur):
    kol, kols = fiyat_kolonu(cur)
    if not kol:
        log(f"  fiyat kolonu bulunamadı. trInvoiceLine kolonları: {kols}")
        return
    log(f"  kullanılan kolon: trInvoiceLine.{kol}")
    cur.execute(f"""
        SELECT TOP 8 l.Qty1, l.{kol}, l.ItemDim1Code, h.InvoiceDate, h.StoreCode
        FROM trInvoiceLine l WITH(NOLOCK)
        JOIN trInvoiceHeader h WITH(NOLOCK)
          ON h.InvoiceHeaderID = l.InvoiceHeaderID
        WHERE l.ItemCode = ?
        ORDER BY h.InvoiceDate DESC
        """, URUN)
    for r in cur.fetchall():
        log(f"   adet={r[0]} | {kol}={r[1]} | beden={str(r[2]).strip()} | "
            f"{r[3]} | {r[4]}")


@bolum("D) YEDEK — TEK BAŞINA 1.000 TL ÜSTÜ, LEFKOŞA STOKLU, GEÇERLİ ÜRÜNLER")
def d_yedek(cur):
    kol, _ = fiyat_kolonu(cur)
    if not kol:
        log("  (fiyat kolonu yok, atlandı)")
        return
    cur.execute(f"""
        SELECT TOP 8 e.ItemCode, MAX(d.ItemDescription), MAX(b.Barcode),
               MAX(l.{kol}) AS fiyat, SUM(s.Qty1) AS stok
        FROM prItemListContent e WITH(NOLOCK)
        JOIN trStock s WITH(NOLOCK)
          ON s.ItemCode = e.ItemCode AND s.ItemTypeCode = 1
         AND s.WarehouseCode = N'S01'
        JOIN prItemBarcode b WITH(NOLOCK) ON b.ItemCode = e.ItemCode
        JOIN trInvoiceLine l WITH(NOLOCK) ON l.ItemCode = e.ItemCode
        LEFT JOIN cdItemDesc d WITH(NOLOCK) ON d.ItemCode = e.ItemCode
        WHERE e.ItemListCode = N'HCGECERLI'
        GROUP BY e.ItemCode
        HAVING SUM(s.Qty1) > 0 AND MAX(l.{kol}) >= 1000
        ORDER BY SUM(s.Qty1) DESC
        """)
    log("  ÜRÜN KODU | AD | BARKOD | son fiyat | S01 stok")
    satirlar = cur.fetchall()
    if not satirlar:
        log("   (bulunamadı)")
    for r in satirlar:
        log(f"   {str(r[0]).strip()} | {str(r[1])[:30]} | {str(r[2]).strip()} "
            f"| {r[3]} | {r[4]}")


def main():
    cfg = load_config()
    log(">>> KEŞİF v29 — test ürünü barkodları + fiyat (salt-okunur)")
    conn = connect(cfg)
    cur = conn.cursor()
    a_kimlik(cur)
    b_barkod(cur)
    c_fiyat(cur)
    d_yedek(cur)
    log("\n>>> KEŞİF v29 TAMAM. Çıktının TAMAMINI yapıştır.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log(traceback.format_exc())
    try:
        with open("KESIF29-CIKTI.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(OUT))
        print("\n>>> KESIF29-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
