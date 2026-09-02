# -*- coding: utf-8 -*-
"""NEBIM YÜKLE-8 — KURAL TARİHLERİNİ ÇALIŞAN KAMPANYAYA GÖRE DÜZELT (YAZAR!).

KESIF36 bulgusu: HCKMP'nin İKİ kuralında da LastValidDate=1900-01-01
(SQL sıfır tarihi — YUKLE3'te şema varsayılanı olarak gelmiş). Kampanya
yükleniyor ama geçerlilik penceresi kapalı görünüyor.

Bu script:
  1) ÇALIŞAN bir kampanyayı referans alır (UNI2054 / IND / TSF1499)
  2) Referansın tarih alanlarını ve zaman dönemini HCKMP ile KIYASLAR
  3) Yedek alır (zzHCyedek_Kural)
  4) HCKMP kurallarının tarih alanlarını referansınkiyle aynı yapar
  5) Zaman dönemi (TimePeriodCode) da kapalıysa referansınkine çevirir
  6) Resmi aktivasyonu tekrar çalıştırır ve doğrular

Geri alma: GERIAL8
Cikti: YUKLE8-CIKTI.txt
"""
from __future__ import annotations

import traceback
from satis_kopru import load_config, connect

OUT = []
KOD = "HCKMP"
REFERANSLAR = ["UNI2054", "IND", "TSF1499", "%60HAZ26"]


def log(*a):
    s = " ".join(str(x) for x in a)
    print(s)
    OUT.append(s)


def bolum(ad):
    log(f"\n=== {ad} ===")


def kolon_bilgi(cur, tablo):
    cur.execute("SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS "
                "WHERE TABLE_NAME = ? ORDER BY ORDINAL_POSITION", tablo)
    return [(r[0], r[1]) for r in cur.fetchall()]


def satirlar(cur, sql, *p):
    cur.execute(sql, *p)
    kols = [d[0] for d in cur.description]
    return [dict(zip(kols, r)) for r in cur.fetchall()]


def gost(v):
    if v is None:
        return "NULL"
    if hasattr(v, "strftime"):
        return v.strftime("%Y-%m-%d")
    return str(v).strip()


def main():
    cfg = load_config()
    log(">>> YÜKLE-8 — kural tarihlerini çalışan kampanyaya göre düzelt")
    conn = connect(cfg)
    conn.autocommit = True
    cur = conn.cursor()

    kb = kolon_bilgi(cur, "prDiscountOfferRules")
    tarih_kols = [k for k, t in kb
                  if t in ("date", "datetime", "smalldatetime", "datetime2")
                  and "Created" not in k and "LastUpdated" not in k]
    log(f"  kuraldaki tarih alanları: {tarih_kols}")

    # ── 1) REFERANS KAMPANYA ──────────────────────────────────────
    bolum("1) REFERANS KAMPANYA SEÇİMİ")
    ref = None
    for r in REFERANSLAR:
        rs = satirlar(cur, "SELECT * FROM prDiscountOfferRules "
                           "WHERE DiscountOfferCode = ?", r)
        if rs:
            cur.execute("SELECT IsActive FROM cdDiscountOffer "
                        "WHERE DiscountOfferCode = ?", r)
            a = cur.fetchone()
            log(f"  {r}: {len(rs)} kural | aktif={a[0] if a else '?'}")
            if ref is None and a and a[0]:
                ref, ref_kod = rs[0], r
    if ref is None:
        log("DURDU: çalışan referans kampanya bulunamadı.")
        return
    log(f"  >>> referans: {ref_kod}")

    # ── 2) KIYAS ──────────────────────────────────────────────────
    bolum("2) TARİH VE DÖNEM KIYASI")
    hckmp = satirlar(cur, "SELECT * FROM prDiscountOfferRules "
                          "WHERE DiscountOfferCode = ? "
                          "ORDER BY DiscountOfferStageCode", KOD)
    if not hckmp:
        log("DURDU: HCKMP kuralı yok.")
        return
    log(f"  {'ALAN':<26} {'HCKMP(1)':<14} {'HCKMP(2)':<14} {ref_kod}")
    for k in tarih_kols + ["TimePeriodCode"]:
        if k not in ref:
            continue
        a = gost(hckmp[0].get(k))
        b = gost(hckmp[1].get(k)) if len(hckmp) > 1 else "-"
        c = gost(ref.get(k))
        isaret = "   << FARKLI" if (a != c or b != c) else ""
        log(f"  {k:<26} {a:<14} {b:<14} {c}{isaret}")

    # zaman dönemi tablosu
    tp_tablo = None
    cur.execute("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES "
                "WHERE TABLE_NAME LIKE '%TimePeriod%' "
                "AND TABLE_NAME NOT LIKE '%Desc%'")
    tt = [r[0] for r in cur.fetchall()]
    log(f"\n  zaman dönemi tabloları: {tt}")
    for t in tt[:2]:
        try:
            kodlar = {gost(hckmp[0].get("TimePeriodCode")),
                      gost(ref.get("TimePeriodCode"))}
            for kd in kodlar:
                rs = satirlar(cur, f"SELECT TOP 2 * FROM {t} WITH(NOLOCK) "
                                   f"WHERE TimePeriodCode = ?", kd)
                if not rs:
                    log(f"  {t}: dönem {kd} -> KAYIT YOK")
                for d in rs:
                    ozet = " | ".join(f"{k}={gost(v)}" for k, v in d.items()
                                      if v is not None
                                      and "RowGuid" not in k
                                      and "Created" not in k
                                      and "LastUpdated" not in k)
                    log(f"  {t} [{kd}]: {ozet[:200]}")
            tp_tablo = t
        except Exception as e:
            log(f"  {t}: HATA {str(e)[:90]}")

    # ── 3) DEĞİŞTİRİLECEKLER ──────────────────────────────────────
    bolum("3) UYGULANACAK DÜZELTMELER")
    degisecek = []
    for k in tarih_kols:
        if k not in ref:
            continue
        hedef = ref.get(k)
        for satir in hckmp:
            if gost(satir.get(k)) != gost(hedef):
                degisecek.append(k)
                break
    degisecek = sorted(set(degisecek))
    if not degisecek:
        log("  Tarih alanlarında fark YOK. Hiçbir şey değiştirilmedi.")
        log("  >>> Yukarıdaki kıyas analiz için yeterli.")
        return
    log(f"  düzeltilecek alanlar: {degisecek}")
    for k in degisecek:
        log(f"    {k}: {gost(hckmp[0].get(k))} -> {gost(ref.get(k))}")

    # ── 4) YEDEK ──────────────────────────────────────────────────
    bolum("4) YEDEK")
    cur.execute("IF OBJECT_ID('zzHCyedek_Kural') IS NULL "
                "SELECT * INTO zzHCyedek_Kural FROM prDiscountOfferRules "
                "WHERE DiscountOfferCode = N'HCKMP' "
                "ELSE INSERT INTO zzHCyedek_Kural "
                "SELECT * FROM prDiscountOfferRules "
                "WHERE DiscountOfferCode = N'HCKMP'")
    cur.execute("SELECT COUNT(*) FROM zzHCyedek_Kural")
    log(f"  zzHCyedek_Kural satır sayısı: {cur.fetchone()[0]}")

    # ── 5) DÜZELTME ───────────────────────────────────────────────
    bolum("5) DÜZELTME")
    for k in degisecek:
        cur.execute(f"UPDATE prDiscountOfferRules SET [{k}] = ? "
                    f"WHERE DiscountOfferCode = ?", ref.get(k), KOD)
        log(f"  {k} güncellendi.")

    # ── 6) AKTİVASYON ─────────────────────────────────────────────
    bolum("6) RESMİ AKTİVASYON")
    cur.execute("EXEC sp_ActivatedDiscountOffers @UserName=N'Sc', "
                "@DiscountOfferCode=N'HCKMP'")
    try:
        while cur.nextset():
            pass
    except Exception:
        pass
    log("  tamamlandı.")

    # ── 7) DOĞRULAMA ──────────────────────────────────────────────
    bolum("7) DOĞRULAMA")
    son = satirlar(cur, "SELECT * FROM prDiscountOfferRules "
                        "WHERE DiscountOfferCode = ? "
                        "ORDER BY DiscountOfferStageCode", KOD)
    for i, d in enumerate(son, 1):
        log(f"  kural {i}: " + " | ".join(
            f"{k}={gost(d.get(k))}" for k in degisecek + ["TimePeriodCode"]))
    cur.execute("SELECT IsActive FROM cdDiscountOffer WHERE DiscountOfferCode=?",
                KOD)
    log(f"  kampanya aktif: {cur.fetchone()[0]}")
    cur.execute("SELECT COUNT(*) FROM prDiscountOfferLocation "
                "WHERE DiscountOfferCode = ?", KOD)
    log(f"  lokasyon satırı: {cur.fetchone()[0]}")

    log("\n>>> POS'u KAPATIP AÇIN, yeni fiş + ürün + çek deneyin.")
    log(">>> Geri almak için: GERIAL8")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log("\nHATA:")
        log(traceback.format_exc())
    try:
        with open("YUKLE8-CIKTI.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(OUT))
        print("\n>>> YUKLE8-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
