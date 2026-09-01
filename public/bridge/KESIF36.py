# -*- coding: utf-8 -*-
"""NEBIM KEŞİF v36 — HCKMP vs ÇALIŞAN KAMPANYA: TAM KIYAS (salt-okunur).

Metod doğru çıktı (DefV01 = Def_Voucher = tip 3). Geriye kampanya
kurulumunda EKSİK PARÇA kaldı. Bu script HCKMP'yi çalışan kampanyalarla
İLGİLİ TÜM TABLOLARDA kıyaslar; hangi tabloda onlarda satır varken bizde
yoksa eksik orada görünür.

A) DiscountOfferCode kolonu olan tüm tablolarda satır sayısı kıyası
B) DefV01/DefV02 metodunun zorunlu parametreleri
C) HCKMP'nin parametre değerleri (muhtemelen boş)
D) Çalışan kampanyanın parametre değerleri (şablon)
E) HCKMP kural satırlarının TÜM kolonları
Cikti: KESIF36-CIKTI.txt
"""
from __future__ import annotations

import traceback
from satis_kopru import load_config, connect

OUT = []
BIZ = "HCKMP"
REFLER = ["IND", "UNI2054", "TSF1499"]


def log(*a):
    s = " ".join(str(x) for x in a)
    print(s)
    OUT.append(s)


def bolum(ad):
    log(f"\n=== {ad} ===")


def main():
    cfg = load_config()
    log(">>> KEŞİF v36 — HCKMP vs çalışan kampanya tam kıyas")
    conn = connect(cfg)
    cur = conn.cursor()

    # ── A) TÜM TABLOLARDA SATIR KIYASI ────────────────────────────
    bolum("A) İLGİLİ TÜM TABLOLARDA SATIR KIYASI")
    cur.execute("""
        SELECT c.TABLE_NAME FROM INFORMATION_SCHEMA.COLUMNS c
        JOIN INFORMATION_SCHEMA.TABLES t
          ON t.TABLE_NAME = c.TABLE_NAME AND t.TABLE_TYPE = 'BASE TABLE'
        WHERE c.COLUMN_NAME = 'DiscountOfferCode'
        ORDER BY c.TABLE_NAME
        """)
    tablolar = [r[0] for r in cur.fetchall()]
    log(f"  DiscountOfferCode kolonu olan tablo: {len(tablolar)}")
    baslik = f"  {'TABLO':38} {BIZ:>7}"
    for k in REFLER:
        baslik += f" {k:>8}"
    log(baslik + "   << DİKKAT")
    for t in tablolar:
        try:
            sayilar = []
            for kod in [BIZ] + REFLER:
                cur.execute(f"SELECT COUNT(*) FROM {t} WITH(NOLOCK) "
                            f"WHERE DiscountOfferCode = ?", kod)
                sayilar.append(cur.fetchone()[0])
            if sum(sayilar) == 0:
                continue
            uyari = ""
            if sayilar[0] == 0 and max(sayilar[1:]) > 0:
                uyari = "   << EKSİK OLABİLİR"
            satir = f"  {t:38} {sayilar[0]:>7}"
            for s in sayilar[1:]:
                satir += f" {s:>8}"
            log(satir + uyari)
        except Exception as e:
            log(f"  {t:38} HATA {str(e)[:50]}")

    # ── B) DefV01 PARAMETRELERİ ───────────────────────────────────
    bolum("B) DefV01 / DefV02 METODUNUN PARAMETRELERİ")
    cur.execute("""
        SELECT DiscountOfferMethodCode, ParameterName, TypeName, IsRequired,
               SortOrder
        FROM prDiscountOfferMethodParameter WITH(NOLOCK)
        WHERE DiscountOfferMethodCode IN ('DefV01','DefV02')
        ORDER BY DiscountOfferMethodCode, SortOrder
        """)
    satirlar = cur.fetchall()
    if not satirlar:
        log("  (DefV01/DefV02 için parametre TANIMI YOK — "
            "yani parametre beklenmiyor)")
    for r in satirlar:
        z = "ZORUNLU" if r[3] else "opsiyonel"
        log(f"  {str(r[0]).strip():10} {str(r[1]).strip():42} "
            f"{str(r[2]).strip():16} {z}")

    # ── C/D) PARAMETRE DEĞERLERİ ──────────────────────────────────
    for kod in [BIZ] + REFLER[:2]:
        bolum(f"{'C' if kod == BIZ else 'D'}) {kod} PARAMETRE DEĞERLERİ")
        try:
            cur.execute("SELECT * FROM prDiscountOfferParameterValue "
                        "WITH(NOLOCK) WHERE DiscountOfferCode = ?", kod)
            kols = [d[0] for d in cur.description]
            rows = cur.fetchall()
            log(f"  {len(rows)} satır | kolonlar: {kols}")
            for r in rows[:14]:
                log("   · " + " | ".join(
                    (str(x).strip() if x is not None else "-")
                    for x in r)[:150])
        except Exception as e:
            log(f"  HATA: {str(e)[:120]}")

    # ── E) HCKMP KURALLARININ TÜM KOLONLARI ───────────────────────
    bolum("E) HCKMP KURAL SATIRLARININ DOLU ALANLARI")
    cur.execute("SELECT * FROM prDiscountOfferRules WITH(NOLOCK) "
                "WHERE DiscountOfferCode = ?", BIZ)
    kols = [d[0] for d in cur.description]
    for r in cur.fetchall():
        d = dict(zip(kols, r))
        dolu = []
        for k, v in d.items():
            if v is None:
                continue
            s = str(v).strip()
            if s in ("", "0", "False", "0.0000", "0.00"):
                continue
            if hasattr(v, "strftime"):
                s = v.strftime("%Y-%m-%d")
            dolu.append(f"{k}={s}")
        log("  --- kural: " + " | ".join(dolu)[:900])

    log("\n>>> KEŞİF v36 TAMAM. Çıktının TAMAMINI yapıştır.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log(traceback.format_exc())
    try:
        with open("KESIF36-CIKTI.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(OUT))
        print("\n>>> KESIF36-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
