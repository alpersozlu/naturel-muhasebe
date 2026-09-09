"""NEBIM KEŞİF 42 — "STOK YOK" DİYE İŞLENEMEYEN 13 SATIRIN BUGÜNKÜ DURUMU (salt-okunur)

Lefkoşa (S01): zamanında "stok yok" diye Nebim'e girilemeyen 13 satış satırı
(Excel listesi) bugün stok kontrolünden sonra girilmiş; personel notuna göre
yalnız 3 satır (26SFT460718 37 SİYAH, 26SFT493714 36 SİYAH, 25SFT460240 36 KAHVE)
stok olmadığı için yine girilememiş. Bu script her satır için Nebim'den:

  A) Şema (trStock tarih/tip/belge-no kolonları, sunucu tarihi)
  B) Ürün kodunun Nebim'deki TÜM renk/beden varyantları + depo bazında anlık stok
     (istenen varyant ◀ ile; stoğu 0 olan varyantlar kısaltılır)
  C) İstenen 13 varyant: S01 dün kapanış stoku → bugünkü hareketler → şimdiki stok,
     diğer depolardaki stok
  D) Bugün (ve dün) S01'de bu ürün kodlarına kesilen perakende fiş satırları
     (saat, müşteri, renk, beden) — köprünün 14:19'dan sonra görmediği girişler dahil
  E) İstenen varyantların S01'deki son 5 stok hareketi (stok ne zaman 0'a düştü?)
  F) ÖZET: her satır için GİRİLDİ / GİRİLMEDİ + stok; personelin 3'lü notuyla karşılaştırma
Çıktı: KESIF42-CIKTI.txt   (hiçbir şey YAZMAZ, sadece SELECT)
"""
from __future__ import annotations

import sys
import traceback
from collections import defaultdict
from datetime import date, datetime, timedelta
from decimal import Decimal

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

STORE = "S01"       # Lefkoşa (bugünkü girişler bu mağazada görüldü)
KONTROL_TARIHI = date(2026, 9, 9)   # stok kontrolü + girişlerin yapıldığı gün ("BUGÜN"); yarın çalıştırılsa da bu güne bakar
DEPOLAR = ["S01", "S02", "S03", "M00", "D00"]

# (sıra, ItemCode, beden(ItemDim1Code), Excel'deki renk, beklenen ColorCode, personel notu "stok yok" mu)
LISTE = [
    (1,  "25SFT463814", "37", "SİYAH",              "11", False),
    (2,  "26SFT442118", "38", "KREM",               "ZA", False),
    (3,  "26SFT698110", "40", "MAVİ",               "36", False),
    (4,  "26PFD150610", "38", "VİZON",              "S5", False),
    (5,  "25SFT460240", "36", "KAHVE",              "25", True),
    (6,  "25SFT4635M7", "36", "NATUREL",            "C2", False),
    (7,  "25SFT4501PV", "38", "TRANSPARAN (ŞEFFAF)", "SD", False),
    (8,  "21WGE64011M", "L",  "BRUNO CEKET SİYAH",  "11", False),
    (9,  "26SFT493714", "36", "SİYAH",              "11", True),
    (10, "25WBT285814", "00", "SİYAH ÇANTA",        "11", False),
    (11, "26PFD202010", "39", "KAHVE",              "25", False),
    (12, "26SFT460718", "37", "SİYAH",              "11", True),
    (13, "26SFT493714", "36", "BRONZ",              "39", False),
]

OUT = []


def log(*a):
    s_ = " ".join(str(x) for x in a)
    print(s_)
    OUT.append(s_)


def bolum(baslik):
    def dekore(fn):
        def sarili(*a, **k):
            log(f"\n===== {baslik} =====")
            try:
                return fn(*a, **k)
            except Exception:
                log("BÖLÜM HATASI:\n" + traceback.format_exc())
        return sarili
    return dekore


def f(x):
    if x is None:
        return 0.0
    if isinstance(x, Decimal):
        return float(x)
    try:
        return float(x)
    except Exception:
        return 0.0


def s(x):
    return "" if x is None else str(x).strip()


def q(x):
    v = f(x)
    return str(int(v)) if abs(v - int(v)) < 1e-9 else f"{v:.2f}"


def tm(x):
    """time/datetime/str -> HH:MM:SS"""
    if x is None:
        return ""
    if isinstance(x, datetime):
        return x.strftime("%H:%M:%S")
    if hasattr(x, "strftime"):
        try:
            return x.strftime("%H:%M:%S")
        except Exception:
            pass
    return str(x)[-8:] if len(str(x)) > 8 else str(x)


def kolonlar(cur, tablo):
    cur.execute("SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS "
                "WHERE TABLE_NAME = ? ORDER BY ORDINAL_POSITION", tablo)
    return [(r[0], r[1]) for r in cur.fetchall()]


def tablo_var(cur, tablo):
    cur.execute("SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = ?", tablo)
    return cur.fetchone()[0] > 0


def key3(item, color, dim1):
    return (s(item).upper(), s(color).upper(), s(dim1).upper())


class Sema:
    st_date = "DocumentDate"
    st_created = "CreatedDate"
    tip_cols = []
    docno = None
    renk_tablo = False
    bugun = None
    dun = None
    inv_time = False
    inv_created = False
    cari_ad = None


SEMA = Sema()
VARYANT = {}          # (item, color, dim1) -> {depo: stok}
RENK_AD = {}          # (item, color) -> açıklama
URUN_AD = {}          # item -> açıklama
SONUC = {}            # sıra -> dict


# ---------------------------------------------------------------- A
@bolum("A) ŞEMA + SUNUCU TARİHİ")
def a_sema(cur):
    cur.execute("SELECT CAST(GETDATE() AS date), GETDATE()")
    r = cur.fetchone()
    SEMA.bugun = KONTROL_TARIHI
    SEMA.dun = SEMA.bugun - timedelta(days=1)
    log(f"  Nebim sunucu saati: {r[1]}  → kontrol günü (BUGÜN) = {SEMA.bugun}, DÜN = {SEMA.dun}")
    names = [c for c, _ in kolonlar(cur, "trStock")]
    if "DocumentDate" not in names:
        for cand in ("TransDate", "StockDate", "OperationDate", "CreatedDate"):
            if cand in names:
                SEMA.st_date = cand
                break
    SEMA.st_created = "CreatedDate" if "CreatedDate" in names else SEMA.st_date
    SEMA.tip_cols = [c for c in ("TransTypeCode", "ProcessCode", "InnerProcessCode") if c in names]
    SEMA.docno = next((c for c in ("DocumentNumber", "InvoiceNumber", "ShipmentNumber", "InnerNumber")
                       if c in names), None)
    log(f"  trStock: tarih={SEMA.st_date} giriş={SEMA.st_created} tip={SEMA.tip_cols} belge={SEMA.docno}")
    SEMA.renk_tablo = tablo_var(cur, "cdColorDesc")
    hk = [c for c, _ in kolonlar(cur, "trInvoiceHeader")]
    SEMA.inv_time = "InvoiceTime" in hk
    SEMA.inv_created = "CreatedDate" in hk
    ck = [c for c, _ in kolonlar(cur, "cdCurrAcc")]
    SEMA.cari_ad = next((c for c in ("CurrAccDescription", "CurrAccDesc", "Description") if c in ck), None)
    log(f"  cdColorDesc var: {SEMA.renk_tablo} | InvoiceTime: {SEMA.inv_time} | header CreatedDate: {SEMA.inv_created} | cari ad kolonu: {SEMA.cari_ad}")
    # depo adları
    try:
        cur.execute("SELECT WarehouseCode, WarehouseDescription FROM cdWarehouseDesc WITH(NOLOCK) WHERE LangCode='TR'")
        log("  depolar: " + "; ".join(f"{s(r[0])}={s(r[1])}" for r in cur.fetchall()))
    except Exception as e:
        log(f"  cdWarehouseDesc okunamadı: {str(e)[:80]}")


# ---------------------------------------------------------------- B
@bolum("B) ÜRÜN KODLARININ TÜM RENK/BEDEN VARYANTLARI — DEPO BAZINDA ANLIK STOK")
def b_varyant(cur):
    kodlar = sorted({x[1] for x in LISTE})
    vals = ",".join(f"(N'{k}')" for k in kodlar)
    renk_sel = "ISNULL(cd.ColorDescription,'')" if SEMA.renk_tablo else "''"
    renk_join = ("LEFT JOIN cdColorDesc cd WITH(NOLOCK) ON cd.ColorCode = st.ColorCode AND cd.LangCode = 'TR'"
                 if SEMA.renk_tablo else "")
    cur.execute(f"""
        WITH S AS (SELECT * FROM (VALUES {vals}) v(ItemCode))
        SELECT st.ItemCode, st.ColorCode, {renk_sel}, st.ItemDim1Code, st.WarehouseCode,
               SUM(ISNULL(st.In_Qty1,0)) - SUM(ISNULL(st.Out_Qty1,0)), COUNT(*)
        FROM S JOIN trStock st WITH(NOLOCK) ON st.ItemCode = S.ItemCode
        {renk_join}
        GROUP BY st.ItemCode, st.ColorCode, {renk_sel}, st.ItemDim1Code, st.WarehouseCode
        ORDER BY st.ItemCode, st.ColorCode, st.ItemDim1Code, st.WarehouseCode""")
    for r in cur.fetchall():
        k = key3(r[0], r[1], r[3])
        VARYANT.setdefault(k, {})[s(r[4])] = VARYANT.get(k, {}).get(s(r[4]), 0.0) + f(r[5])
        if s(r[2]):
            RENK_AD[(k[0], k[1])] = s(r[2])
    # ürün adları
    try:
        cur.execute(f"""
            WITH S AS (SELECT * FROM (VALUES {vals}) v(ItemCode))
            SELECT S.ItemCode, d.ItemDescription FROM S
            OUTER APPLY (SELECT TOP 1 ItemDescription FROM cdItemDesc dd WITH(NOLOCK)
                         WHERE dd.ItemCode = S.ItemCode AND dd.LangCode='TR') d""")
        for r in cur.fetchall():
            URUN_AD[s(r[0]).upper()] = s(r[1])
    except Exception as e:
        log(f"  cdItemDesc okunamadı: {str(e)[:80]}")

    istenen = {key3(x[1], x[4], x[2]) for x in LISTE}
    for kod in kodlar:
        log(f"\n  {kod}  {URUN_AD.get(kod.upper(), '')}")
        keys = sorted(k for k in VARYANT if k[0] == kod.upper())
        if not keys:
            log("    ⚠ trStock'ta bu ürün koduna ait HİÇ hareket yok")
            continue
        gizli = 0
        for k in keys:
            depo = VARYANT[k]
            toplam = sum(depo.values())
            ist = k in istenen
            if not ist and abs(toplam) < 1e-9 and all(abs(v) < 1e-9 for v in depo.values()):
                gizli += 1
                continue
            depo_str = " ".join(f"{d_}:{q(v)}" for d_, v in sorted(depo.items()) if abs(v) > 1e-9) or "hepsi 0"
            log(f"    {'◀' if ist else ' '} renk {k[1]:<3} {RENK_AD.get((k[0], k[1]), ''):<14} beden {k[2]:<4} | {depo_str}")
        if gizli:
            log(f"      (+{gizli} varyant: tüm depolarda stok 0, gizlendi)")


# ---------------------------------------------------------------- C
@bolum("C) İSTENEN 13 VARYANT — S01 DÜN KAPANIŞ → BUGÜNKÜ HAREKET → ŞİMDİ")
def c_stok(cur):
    vals = ",".join(f"({i},N'{it}',N'{cc}',N'{dm}')" for i, it, dm, _r, cc, _n in LISTE)
    cur.execute(f"""
        WITH S AS (SELECT * FROM (VALUES {vals}) v(Sira, ItemCode, ColorCode, ItemDim1Code))
        SELECT S.Sira, st.WarehouseCode,
               SUM(CASE WHEN st.{SEMA.st_date} < ? THEN ISNULL(st.In_Qty1,0)-ISNULL(st.Out_Qty1,0) ELSE 0 END),
               SUM(ISNULL(st.In_Qty1,0)-ISNULL(st.Out_Qty1,0)),
               SUM(CASE WHEN st.{SEMA.st_date} >= ? THEN ISNULL(st.In_Qty1,0) ELSE 0 END),
               SUM(CASE WHEN st.{SEMA.st_date} >= ? THEN ISNULL(st.Out_Qty1,0) ELSE 0 END),
               COUNT(*)
        FROM S JOIN trStock st WITH(NOLOCK)
          ON st.ItemCode = S.ItemCode AND st.ColorCode = S.ColorCode AND st.ItemDim1Code = S.ItemDim1Code
        GROUP BY S.Sira, st.WarehouseCode ORDER BY S.Sira, st.WarehouseCode""",
        (SEMA.bugun, SEMA.bugun, SEMA.bugun))
    depo = defaultdict(dict)
    for r in cur.fetchall():
        depo[int(r[0])][s(r[1])] = (f(r[2]), f(r[3]), f(r[4]), f(r[5]), int(r[6]))
    # bugünkü hareket satırları (belge tarihi bugün VEYA giriş tarihi bugün)
    tip_sel = "".join(f", st.{c}" for c in SEMA.tip_cols)
    docno = f"st.{SEMA.docno}" if SEMA.docno else "NULL"
    cur.execute(f"""
        WITH S AS (SELECT * FROM (VALUES {vals}) v(Sira, ItemCode, ColorCode, ItemDim1Code))
        SELECT S.Sira, st.WarehouseCode, st.{SEMA.st_date}, st.{SEMA.st_created}{tip_sel}, {docno},
               ISNULL(st.In_Qty1,0), ISNULL(st.Out_Qty1,0)
        FROM S JOIN trStock st WITH(NOLOCK)
          ON st.ItemCode = S.ItemCode AND st.ColorCode = S.ColorCode AND st.ItemDim1Code = S.ItemDim1Code
        WHERE st.{SEMA.st_date} >= ? OR st.{SEMA.st_created} >= ?
        ORDER BY S.Sira, st.{SEMA.st_created}""", (SEMA.dun, SEMA.dun))
    nt = len(SEMA.tip_cols)
    bugun_har = defaultdict(list)
    for r in cur.fetchall():
        tips = " ".join(f"{c}={s(v)}" for c, v in zip(SEMA.tip_cols, r[4:4 + nt]))
        bugun_har[int(r[0])].append(
            f"{s(r[1])} belge {str(r[2])[:10]} giriş {str(r[3])[:16]} {tips} {s(r[4 + nt])} +{q(r[5 + nt])} -{q(r[6 + nt])}")
    for i, it, dm, renk, cc, notu in LISTE:
        d_ = depo.get(i, {})
        s01 = d_.get(STORE)
        diger = " ".join(f"{k}:{q(v[1])}" for k, v in sorted(d_.items()) if k != STORE and abs(v[1]) > 1e-9) or "-"
        ad = RENK_AD.get((it.upper(), cc.upper()), "?")
        if s01 is None:
            durum = f"S01'de HİÇ hareket yok | diğer depolar: {diger}"
            SONUC[i] = dict(dun=None, simdi=None, giris=0, cikis=0)
        else:
            durum = (f"S01 dün kapanış {q(s01[0])} → bugün +{q(s01[2])} −{q(s01[3])} → ŞİMDİ {q(s01[1])} "
                     f"| diğer depolar: {diger}")
            SONUC[i] = dict(dun=s01[0], simdi=s01[1], giris=s01[2], cikis=s01[3])
        SONUC[i].update(diger=diger, renk_ad=ad)
        log(f"  {i:>2}. {it} {dm:<3} {renk:<20} (renk kodu {cc}={ad}) {'[personel: STOK YOK]' if notu else ''}")
        log(f"      {durum}")
        for h in bugun_har.get(i, []):
            log(f"      • {h}")


# ---------------------------------------------------------------- D
@bolum("D) DÜN+BUGÜN S01 PERAKENDE FİŞ SATIRLARI — bu ürün kodları")
def d_fisler(cur):
    kodlar = sorted({x[1] for x in LISTE})
    vals = ",".join(f"(N'{k}')" for k in kodlar)
    t_sel = "h.InvoiceTime" if SEMA.inv_time else "NULL"
    c_sel = "h.CreatedDate" if SEMA.inv_created else "NULL"
    cari = (f"(SELECT TOP 1 {SEMA.cari_ad} FROM cdCurrAcc ca WITH(NOLOCK) WHERE ca.CurrAccCode = h.CurrAccCode)"
            if SEMA.cari_ad else "NULL")
    renk_sel = ("(SELECT TOP 1 ColorDescription FROM cdColorDesc cd WITH(NOLOCK) WHERE cd.ColorCode = l.ColorCode AND cd.LangCode='TR')"
                if SEMA.renk_tablo else "NULL")
    cur.execute(f"""
        WITH S AS (SELECT * FROM (VALUES {vals}) v(ItemCode))
        SELECT h.InvoiceNumber, h.InvoiceDate, {t_sel}, {c_sel}, h.StoreCode, h.IsReturn,
               h.CurrAccCode, {cari}, l.ItemCode, l.ColorCode, {renk_sel}, l.ItemDim1Code, l.Qty1
        FROM trInvoiceLine l WITH(NOLOCK)
        JOIN trInvoiceHeader h WITH(NOLOCK) ON h.InvoiceHeaderID = l.InvoiceHeaderID
        JOIN S ON S.ItemCode = l.ItemCode
        WHERE h.CompanyCode = ? AND h.ProcessCode = 'R' AND h.InvoiceDate >= ?
        ORDER BY h.InvoiceDate, {t_sel if SEMA.inv_time else 'h.InvoiceNumber'}, h.InvoiceNumber""",
        (CC, SEMA.dun))
    rows = cur.fetchall()
    log(f"  {len(rows)} satır (InvoiceDate ≥ {SEMA.dun}, tüm mağazalar):")
    istenen = {key3(x[1], x[4], x[2]): x[0] for x in LISTE}
    for r in rows:
        k = key3(r[8], r[9], r[11])
        sira = istenen.get(k)
        isaret = f"◀ liste #{sira}" if sira else "  (listede yok: başka renk/beden)"
        log(f"   {s(r[0])} {str(r[1])[:10]} {tm(r[2]):<8} giriş {str(r[3])[:16]:<16} {s(r[4])} {'İADE' if r[5] else '    '} "
            f"{s(r[8])} {s(r[9])}={s(r[10]):<10} {s(r[11]):<4} x{q(r[12])} | {s(r[7])} ({s(r[6])}) {isaret}")
        if sira and s(r[4]) == STORE and not r[5] and str(r[1])[:10] == str(SEMA.bugun):
            SONUC.setdefault(sira, {}).setdefault("fisler", []).append(f"{s(r[0])} {tm(r[2])[:5]} {s(r[7])}")
    # bugün S01'de toplam fiş sayısı (köprü kıyası için)
    cur.execute(f"""SELECT COUNT(DISTINCT h.InvoiceNumber), COUNT(*) FROM trInvoiceLine l WITH(NOLOCK)
                    JOIN trInvoiceHeader h WITH(NOLOCK) ON h.InvoiceHeaderID = l.InvoiceHeaderID
                    WHERE h.CompanyCode = ? AND h.ProcessCode='R' AND h.StoreCode = ? AND h.InvoiceDate = ?""",
                (CC, STORE, SEMA.bugun))
    r = cur.fetchone()
    log(f"  bugün {STORE}: {r[0]} fiş / {r[1]} satır (köprü 14:19'da 41 satır görmüştü)")


# ---------------------------------------------------------------- E
@bolum("E) İSTENEN VARYANTLARIN S01'DEKİ SON 5 STOK HAREKETİ")
def e_son(cur):
    vals = ",".join(f"({i},N'{it}',N'{cc}',N'{dm}')" for i, it, dm, _r, cc, _n in LISTE)
    tip_sel = "".join(f", st.{c}" for c in SEMA.tip_cols)
    docno = f"st.{SEMA.docno}" if SEMA.docno else "NULL"
    cur.execute(f"""
        WITH S AS (SELECT * FROM (VALUES {vals}) v(Sira, ItemCode, ColorCode, ItemDim1Code))
        SELECT S.Sira, x.WarehouseCode, x.BelgeT, x.GirisT{tip_sel.replace('st.', 'x.')}, x.DocNo, x.Qin, x.Qout
        FROM S
        OUTER APPLY (SELECT TOP 5 st.WarehouseCode, st.{SEMA.st_date} AS BelgeT, st.{SEMA.st_created} AS GirisT
                            {tip_sel}, {docno} AS DocNo, ISNULL(st.In_Qty1,0) AS Qin, ISNULL(st.Out_Qty1,0) AS Qout
                     FROM trStock st WITH(NOLOCK)
                     WHERE st.WarehouseCode = ? AND st.ItemCode = S.ItemCode AND st.ColorCode = S.ColorCode
                       AND st.ItemDim1Code = S.ItemDim1Code
                     ORDER BY st.{SEMA.st_date} DESC, st.{SEMA.st_created} DESC) x
        ORDER BY S.Sira, x.BelgeT DESC, x.GirisT DESC""", (STORE,))
    nt = len(SEMA.tip_cols)
    son = defaultdict(list)
    for r in cur.fetchall():
        if r[1] is None:
            continue
        tips = " ".join(f"{c}={s(v)}" for c, v in zip(SEMA.tip_cols, r[4:4 + nt]))
        son[int(r[0])].append(f"{str(r[2])[:10]} (giriş {str(r[3])[:16]}) {tips} {s(r[4 + nt])} +{q(r[5 + nt])} -{q(r[6 + nt])}")
    for i, it, dm, renk, cc, notu in LISTE:
        log(f"  {i:>2}. {it} {cc} {dm} {renk}:")
        for h in son.get(i, []) or ["S01'de hareket yok"]:
            log(f"      {h}")


# ---------------------------------------------------------------- F
@bolum("F) ÖZET — Excel listesi × Nebim")
def f_ozet():
    log("  #  Ürün         Beden Renk                 | S01 dün→şimdi | bugün S01 fiş | Nebim'e göre | personel notu")
    uyum = 0
    for i, it, dm, renk, cc, notu in LISTE:
        r = SONUC.get(i, {})
        fis = r.get("fisler") or []
        if r.get("dun") is None:
            stok_str = "S01 hareket yok"
        else:
            stok_str = f"{q(r['dun'])} → {q(r['simdi'])}"
        if fis:
            nebim = "GİRİLDİ: " + "; ".join(fis)
        elif r.get("simdi") is not None and r["simdi"] > 0:
            nebim = f"GİRİLMEDİ, ama S01 stok {q(r['simdi'])} (girilebilir)"
        else:
            nebim = "GİRİLMEDİ, S01 stok 0/yok (girilemez)"
        pers = "STOK YOK (girilemedi)" if notu else "girildi (varsayım)"
        ok = (bool(fis) and not notu) or (not fis and notu)
        uyum += ok
        log(f"  {i:>2} {it:<12} {dm:<5} {renk:<20} | {stok_str:<13} | {len(fis)} | {nebim} | {pers} {'✓' if ok else '✗ UYUŞMUYOR'}")
    log(f"  → {uyum}/{len(LISTE)} satır personel notuyla uyumlu.")
    log("  Not: 'GİRİLDİ' = bugün S01'de aynı renk+beden ile perakende fiş var. Aynı ürün başka renkle "
        "girildiyse D bölümünde '(listede yok: başka renk/beden)' satırına bak (örn. 26SFT460718 BEYAZ 37).")


CC = 1


def main():
    global CC
    from satis_kopru import load_config, connect
    cfg = load_config()
    CC = cfg.get("company_code", 1)
    log(f">>> KEŞİF 42 — işlenemeyen 13 satırın stok/giriş durumu (salt-okunur) · çalıştırma {datetime.now():%Y-%m-%d %H:%M}")
    conn = connect(cfg)
    cur = conn.cursor()
    a_sema(cur)
    b_varyant(cur)
    c_stok(cur)
    d_fisler(cur)
    e_son(cur)
    f_ozet()
    log("\n>>> KEŞİF 42 TAMAM. Çıktının TAMAMINI yapıştır (KESIF42-CIKTI.txt).")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log(traceback.format_exc())
    try:
        with open("KESIF42-CIKTI.txt", "w", encoding="utf-8") as fh:
            fh.write("\n".join(OUT))
        print("\n>>> KESIF42-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
