# -*- coding: utf-8 -*-
"""NEBIM YÜKLE-9 — HCKMP'YE TUTAR KURALI BAĞLA (YAZAR!).

KESIF45: HC çek tipinin tabanı 1 = "Tutar Kuralındaki Tutardan Tutarlı".
HCKMP kurallarında AmountRuleCode BOŞ → motor çek kampanyasını kullanılabilir
saymıyor olabilir (DLL: MSGDiscountVoucherAmountExceedToAmountRuleAmount).

Bu script:
  1) cdAmountRule / prAmountRuleBracket yapısını ve mevcut kuralları DÖKER
  2) Mevcut bir tutar kuralını KALIP alıp 'HCTUTAR' kuralını 3 basamakla kurar:
        1000–1499.99 → 500 | 1500–1999.99 → 750 | 2000+ → 1000
  3) HCKMP kurallarına AmountRuleCode='HCTUTAR' yazar
  4) sp_ActivatedDiscountOffers ile resmi aktivasyonu tekrar çalıştırır
  5) Doğrular. Kolonları tanıyamazsa HİÇBİR ŞEY DEĞİŞTİRMEDEN durur.
Geri alma: GERIAL9
Cikti: YUKLE9-CIKTI.txt
"""
from __future__ import annotations

import re
import traceback
import uuid
from satis_kopru import load_config, connect

OUT = []
KOD = "HCKMP"
KURAL = "HCTUTAR"
BASAMAK = [(1000.0, 1499.99, 500.0), (1500.0, 1999.99, 750.0),
           (2000.0, 999999999.0, 1000.0)]


def log(*a):
    s = " ".join(str(x) for x in a)
    print(s)
    OUT.append(s)


def k(v, n=40):
    if v is None:
        return "NULL"
    if hasattr(v, "strftime"):
        return v.strftime("%Y-%m-%d")
    return str(v).strip()[:n]


def kolonlar(cur, t):
    cur.execute("SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS "
                "WHERE TABLE_NAME=? ORDER BY ORDINAL_POSITION", t)
    return [(r[0], r[1]) for r in cur.fetchall()]


def satirlar(cur, sql, *p):
    cur.execute(sql, *p)
    kols = [d[0] for d in cur.description]
    return [dict(zip(kols, r)) for r in cur.fetchall()]


def ekle(cur, tablo, d):
    """dict'i tabloya INSERT eder (RowGuid/tarih alanları yenilenir)."""
    d = dict(d)
    for c in list(d):
        cl = c.lower()
        if cl == "rowguid":
            d[c] = str(uuid.uuid4())
        elif cl in ("createdusername", "lastupdatedusername"):
            d[c] = "Sc"
        elif cl in ("createddate", "lastupdateddate"):
            d[c] = None  # aşağıda GETDATE()
    kols = list(d)
    degerler = []
    yer = []
    for c in kols:
        if c.lower() in ("createddate", "lastupdateddate"):
            yer.append("GETDATE()")
        else:
            yer.append("?")
            degerler.append(d[c])
    sql = (f"INSERT INTO [{tablo}] ({', '.join('['+c+']' for c in kols)}) "
           f"VALUES ({', '.join(yer)})")
    cur.execute(sql, *degerler)


def sec(adlar, *desenler):
    for p in desenler:
        for a in adlar:
            if re.fullmatch(p, a, flags=re.I):
                return a
    return None


def main():
    cfg = load_config()
    log(">>> YÜKLE-9 — HCKMP'ye tutar kuralı bağla")
    conn = connect(cfg)
    conn.autocommit = True
    cur = conn.cursor()

    # ── 1) YAPI VE MEVCUT KURALLAR ─────────────────────────────────
    log("\n=== 1) TUTAR KURALI TABLOLARI ===")
    ck = kolonlar(cur, "cdAmountRule")
    bk = kolonlar(cur, "prAmountRuleBracket")
    log(f"  cdAmountRule: {[c for c, _ in ck]}")
    log(f"  prAmountRuleBracket: {[c for c, _ in bk]}")
    if not ck or not bk:
        log("DURDU: tablolar bulunamadı.")
        return
    mevcut = satirlar(cur, "SELECT * FROM cdAmountRule WITH(NOLOCK)")
    log(f"  mevcut tutar kuralı: {[k(m.get('AmountRuleCode')) for m in mevcut]}")
    for m in mevcut[:2]:
        kod = m.get("AmountRuleCode")
        bs = satirlar(cur, "SELECT * FROM prAmountRuleBracket WITH(NOLOCK) "
                           "WHERE AmountRuleCode = ?", kod)
        log(f"  --- {k(kod)} basamakları ({len(bs)}):")
        for b in bs[:6]:
            log("     · " + " | ".join(f"{c}={k(v,12)}" for c, v in b.items()
                                       if c not in ("RowGuid", "AmountRuleCode")
                                       and "User" not in c and "Date" not in c))

    # kampanya kurallarında tutar kuralı kullanan var mı
    rk = [c for c, _ in kolonlar(cur, "prDiscountOfferRules")]
    tk = [c for c in rk if "amountrule" in c.lower()]
    log(f"  prDiscountOfferRules tutar-kuralı kolonları: {tk}")
    if "AmountRuleCode" in rk:
        cur.execute("SELECT DiscountOfferCode, DiscountOfferStageCode, AmountRuleCode "
                    "FROM prDiscountOfferRules WITH(NOLOCK) "
                    "WHERE ISNULL(AmountRuleCode,'') <> ''")
        r = cur.fetchall()
        log(f"  tutar kuralı bağlı kampanya kuralları: "
            f"{[(k(x[0],10), x[1], k(x[2],12)) for x in r][:10]}")
        cur.execute("SELECT DiscountOfferStageCode, AmountRuleCode FROM "
                    "prDiscountOfferRules WITH(NOLOCK) WHERE DiscountOfferCode=?", KOD)
        log(f"  HCKMP şu an: {[(x[0], k(x[1])) for x in cur.fetchall()]}")
    else:
        log("DURDU: prDiscountOfferRules.AmountRuleCode kolonu yok.")
        return

    # ── 2) KOLON TANIMA ────────────────────────────────────────────
    badlar = [c for c, _ in bk]
    alt = sec(badlar, r"(From|Begin|Min|Start)Amount", r".*FromAmount.*",
              r".*BeginAmount.*", r".*MinAmount.*")
    ust = sec(badlar, r"(To|End|Max)Amount", r".*ToAmount.*", r".*EndAmount.*",
              r".*MaxAmount.*")
    tutar = sec(badlar, r"DiscountAmount", r"Amount", r"VoucherAmount",
                r".*DiscountAmount.*")
    oran = sec(badlar, r"DiscountRate", r".*Rate.*")
    puan = sec(badlar, r"Point")
    ust_metin = ust or "(yok: basamak bir sonrakine kadar)"
    log(f"\n=== 2) KOLON TANIMA === alt={alt} üst={ust_metin} "
        f"tutar={tutar} oran={oran} puan={puan}")
    if not (alt and tutar):
        log("DURDU: basamak kolonları tanınamadı. HİÇBİR ŞEY DEĞİŞTİRİLMEDİ.")
        return
    # kalıp: BASAMAĞI OLAN ilk mevcut kural (boş kodlu kuralın basamağı yok)
    kalip_kod = None
    for m in mevcut:
        cur.execute("SELECT COUNT(*) FROM prAmountRuleBracket WHERE AmountRuleCode=?",
                    m["AmountRuleCode"])
        if cur.fetchone()[0] > 0:
            kalip_kod = m["AmountRuleCode"]
            break
    if not kalip_kod:
        log("DURDU: basamağı olan kalıp kural yok. HİÇBİR ŞEY DEĞİŞTİRİLMEDİ.")
        return
    kalip_kural = next(m for m in mevcut if m["AmountRuleCode"] == kalip_kod)

    cur.execute("SELECT COUNT(*) FROM cdAmountRule WHERE AmountRuleCode=?", KURAL)
    if cur.fetchone()[0]:
        log(f"  {KURAL} zaten var — yeniden oluşturulmayacak.")
    else:
        if not mevcut:
            log("DURDU: kalıp alınacak mevcut tutar kuralı yok.")
            return
        # ── 3) KURALI KALIPTAN OLUŞTUR ────────────────────────────
        log(f"\n=== 3) {KURAL} OLUŞTURULUYOR (kalıp: {k(kalip_kod)}) ===")
        kalip = dict(kalip_kural)
        kalip["AmountRuleCode"] = KURAL
        for c in list(kalip):
            if "Description" in c:
                kalip[c] = "Hediye Çeki Tutar Kuralı"
            elif c == "UseMultiplesOfValues":
                kalip[c] = 0          # katlama yok: 2000 TL'de 2×500 değil
            elif c == "IsBlocked":
                kalip[c] = 0
            elif c == "CurrencyCode" and not str(kalip[c] or "").strip():
                kalip[c] = "TRY"
        ekle(cur, "cdAmountRule", kalip)
        # açıklama tablosu varsa
        cur.execute("SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES "
                    "WHERE TABLE_NAME='cdAmountRuleDesc'")
        if cur.fetchone()[0]:
            dm = satirlar(cur, "SELECT * FROM cdAmountRuleDesc WITH(NOLOCK) "
                               "WHERE AmountRuleCode=?", kalip_kod)
            for d in dm[:2]:
                d = dict(d)
                d["AmountRuleCode"] = KURAL
                for c in d:
                    if "Description" in c:
                        d[c] = ("Hediye Çeki Tutar Kuralı" if d.get("LangCode") != "EN"
                                else "Gift Voucher Amount Rule")
                ekle(cur, "cdAmountRuleDesc", d)
            log(f"  açıklama satırı: {len(dm)}")
        kalip_b = satirlar(cur, "SELECT TOP 1 * FROM prAmountRuleBracket WITH(NOLOCK) "
                                "WHERE AmountRuleCode=?", kalip_kod)
        if not kalip_b:
            log("DURDU: kalıp basamak satırı yok.")
            return
        sira_kol = sec(badlar, r"LineNumber", r"SortOrder", r"BracketNo", r".*Line.*")
        for i, (a, u, t) in enumerate(BASAMAK, 1):
            b = dict(kalip_b[0])
            b["AmountRuleCode"] = KURAL
            b[alt] = a
            if ust:
                b[ust] = u
            b[tutar] = t
            if oran and oran != tutar:
                b[oran] = 0
            if puan and puan not in (alt, tutar):
                b[puan] = 0
            if sira_kol:
                b[sira_kol] = i
            ekle(cur, "prAmountRuleBracket", b)
        cur.execute("SELECT COUNT(*) FROM prAmountRuleBracket WHERE AmountRuleCode=?", KURAL)
        log(f"  basamak eklendi: {cur.fetchone()[0]}")

    # ── 4) HCKMP'YE BAĞLA ──────────────────────────────────────────
    log("\n=== 4) HCKMP KURALLARINA BAĞLA ===")
    cur.execute("IF OBJECT_ID('zzHCyedek_Kural') IS NULL CREATE TABLE zzHCyedek_Kural "
                "(Id int IDENTITY(1,1) PRIMARY KEY, Kod nvarchar(20), Alan nvarchar(60), "
                "EskiDeger nvarchar(200), YedekTarihi datetime)")
    cur.execute("SELECT DiscountOfferStageCode, AmountRuleCode FROM prDiscountOfferRules "
                "WHERE DiscountOfferCode=?", KOD)
    for st, eski in cur.fetchall():
        cur.execute("INSERT INTO zzHCyedek_Kural (Kod, Alan, EskiDeger, YedekTarihi) "
                    "VALUES (?, ?, ?, GETDATE())", KOD, f"AmountRuleCode@{st}", k(eski))
    cur.execute("UPDATE prDiscountOfferRules SET AmountRuleCode=? WHERE DiscountOfferCode=?",
                KURAL, KOD)
    for c in tk:
        if c != "AmountRuleCode" and c.lower().startswith("use"):
            cur.execute(f"UPDATE prDiscountOfferRules SET [{c}]=1 WHERE DiscountOfferCode=?", KOD)
            log(f"  {c}=1 yazıldı")
    log(f"  AmountRuleCode={KURAL} (her iki aşama)")

    # ── 5) RESMİ AKTİVASYON ────────────────────────────────────────
    log("\n=== 5) RESMİ AKTİVASYON ===")
    cur.execute("EXEC sp_ActivatedDiscountOffers @UserName=N'Sc', @DiscountOfferCode=N'HCKMP'")
    try:
        while cur.nextset():
            pass
    except Exception:
        pass
    log("  tamamlandı.")

    # ── 6) DOĞRULAMA ───────────────────────────────────────────────
    log("\n=== 6) DOĞRULAMA ===")
    cur.execute("SELECT DiscountOfferStageCode, AmountRuleCode FROM prDiscountOfferRules "
                "WITH(NOLOCK) WHERE DiscountOfferCode=?", KOD)
    log(f"  HCKMP kuralları: {[(x[0], k(x[1])) for x in cur.fetchall()]}")
    cur.execute(f"SELECT {alt}, {tutar} FROM prAmountRuleBracket WITH(NOLOCK) "
                f"WHERE AmountRuleCode=? ORDER BY {alt}", KURAL)
    log(f"  {KURAL} basamakları (alt sınır → çek tutarı): "
        f"{[(float(a), float(t)) for a, t in cur.fetchall()]}")
    cur.execute("SELECT IsActive FROM cdDiscountOffer WHERE DiscountOfferCode=?", KOD)
    log(f"  HCKMP aktif: {cur.fetchone()[0]}")
    for ad in ("qry_GetDiscountOfferProducts_R_1", "qry_GetDiscountOfferProducts_R_2"):
        cur.execute("SELECT modify_date FROM sys.objects WHERE name=?", ad)
        log(f"  {ad}: {cur.fetchone()[0]}")
    log("\n>>> POS'u KAPATIP AÇIN, yeni fiş (1.000 TL üstü) + çek deneyin.")
    log(">>> Geri almak için: GERIAL9")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log("\nHATA:")
        log(traceback.format_exc())
    try:
        with open("YUKLE9-CIKTI.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(OUT))
        print("\n>>> YUKLE9-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
