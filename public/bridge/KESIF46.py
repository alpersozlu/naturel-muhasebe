# -*- coding: utf-8 -*-
"""NEBIM KEŞİF v46 — ÜRETİLMİŞ PROSEDÜRLER TEST ÜRÜNÜ İÇİN HCKMP DÖNDÜRÜYOR MU (salt-okunur).

DLL okuması: motor, kampanyayı ancak fişteki ürün HCKMP'nin KULLANIM (stage-2)
kümesindeyse kabul ediyor. O küme qry_GetDiscountOfferProducts_R_2'den gelir.
A) R_1 ve R_2'yi test ürünleriyle ÇALIŞTIR → dönen kampanya kodları
B) R_2 tanımında HCKMP geçen satırlar (üreticinin yazdığı koşul)
C) Aynı üründe çalışan bir kampanya (UNI2054/IND) için karşılaştırma
Cikti: KESIF46-CIKTI.txt
"""
from __future__ import annotations

import traceback
from satis_kopru import load_config, connect

OUT = []
URUNLER = ["26PFD510410", "26SFT442232", "26SFD161418", "26SFD151918"]


def log(*a):
    s = " ".join(str(x) for x in a)
    print(s)
    OUT.append(s)


def bolum(ad):
    def dekore(f):
        def sarili(*a, **kw):
            log(f"\n=== {ad} ===")
            try:
                return f(*a, **kw)
            except Exception as e:
                log(f"  HATA: {type(e).__name__}: {str(e)[:220]}")
        return sarili
    return dekore


@bolum("A) R_1 / R_2 ÇALIŞTIRMA (ürün → dönen kampanyalar)")
def a_calistir(cur):
    for u in URUNLER:
        cur.execute("SELECT COUNT(*) FROM prItemListContent WITH(NOLOCK) "
                    "WHERE ItemListCode=N'HCGECERLI' AND ItemCode=?", u)
        listede = cur.fetchone()[0] > 0
        log(f"\n  ürün {u}  (HCGECERLI'de: {'EVET' if listede else 'HAYIR'})")
        for ad in ("qry_GetDiscountOfferProducts_R_1", "qry_GetDiscountOfferProducts_R_2"):
            try:
                # POS da böyle çağırıyor: tek konumsal parametre ('|' ile birleşik kodlar)
                cur.execute(f"EXEC {ad} ?", u)
                kols = [d[0] for d in cur.description] if cur.description else []
                satir = cur.fetchall()
                kodlar = [str(r[0]).strip() for r in satir if r and r[0] is not None]
                hc = "HCKMP" in kodlar
                log(f"    {ad[-3:]}: {len(satir)} satır | kolonlar={kols[:6]} | "
                    f"kodlar={sorted(set(kodlar))[:12]} | HCKMP: {'VAR' if hc else 'YOK ✗'}")
                for r in [x for x in satir if str(x[0]).strip() == "HCKMP"][:3]:
                    log("      · " + " | ".join(str(v).strip() for v in r[:6]))
            except Exception as e:
                log(f"    {ad[-3:]}: HATA {str(e)[:120]}")


@bolum("D) UYUMLULUK BAYRAKLARI (fişteki %20 kampanyasıyla birlikte kullanılabilir mi)")
def d_bayrak(cur):
    cur.execute("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS "
                "WHERE TABLE_NAME='prDiscountOfferRules' AND COLUMN_NAME LIKE 'IsValidWith%'")
    kols = [r[0] for r in cur.fetchall()]
    log(f"  kolonlar: {kols}")
    if not kols:
        return
    cur.execute(f"SELECT DiscountOfferCode, DiscountOfferStageCode, {', '.join(kols)} "
                f"FROM prDiscountOfferRules WITH(NOLOCK) "
                f"WHERE DiscountOfferCode IN (N'HCKMP', N'IND', N'UNI2054', N'%60HAZ26')")
    for r in cur.fetchall():
        log(f"  {str(r[0]).strip():10} st{r[1]} | " +
            " | ".join(f"{k}={v}" for k, v in zip(kols, r[2:])))


@bolum("B) R_2 TANIMINDA HCKMP BÖLÜMÜ")
def b_tanim(cur):
    for ad in ("qry_GetDiscountOfferProducts_R_2", "qry_GetDiscountOfferProducts_R_1"):
        cur.execute("SELECT OBJECT_DEFINITION(OBJECT_ID(?))", ad)
        t = (cur.fetchone() or [""])[0] or ""
        satirlar = t.replace("\r", "").split("\n")
        log(f"\n  --- {ad}: {len(satirlar)} satır")
        idx = [i for i, s in enumerate(satirlar) if "HCKMP" in s]
        log(f"  HCKMP geçen satır no: {idx[:10]}")
        gosterilen = set()
        for i in idx[:3]:
            for j in range(max(0, i - 2), min(len(satirlar), i + 14)):
                if j in gosterilen:
                    continue
                gosterilen.add(j)
                log(f"   {j:4}| {satirlar[j].rstrip()[:150]}")
            log("   ...")


@bolum("C) KARŞILAŞTIRMA: UNI2054 BÖLÜMÜ (R_2)")
def c_kiyas(cur):
    cur.execute("SELECT OBJECT_DEFINITION(OBJECT_ID('qry_GetDiscountOfferProducts_R_2'))")
    t = (cur.fetchone() or [""])[0] or ""
    satirlar = t.replace("\r", "").split("\n")
    idx = [i for i, s in enumerate(satirlar) if "UNI2054" in s or "'IND'" in s]
    log(f"  UNI2054/IND geçen satır no: {idx[:8]}")
    for i in idx[:1]:
        for j in range(max(0, i - 2), min(len(satirlar), i + 14)):
            log(f"   {j:4}| {satirlar[j].rstrip()[:150]}")


def main():
    cfg = load_config()
    log(">>> KEŞİF v46 — üretilmiş prosedürler ürün için HCKMP döndürüyor mu (salt-okunur)")
    conn = connect(cfg)
    cur = conn.cursor()
    a_calistir(cur)
    b_tanim(cur)
    c_kiyas(cur)
    d_bayrak(cur)
    log("\n>>> KEŞİF v46 TAMAM. Çıktının TAMAMINI yapıştır.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log(traceback.format_exc())
    try:
        with open("KESIF46-CIKTI.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(OUT))
        print("\n>>> KESIF46-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
