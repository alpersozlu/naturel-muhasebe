"""NEBIM KEŞİF v37 — MAĞUSA SAYIM FARKLARININ PARASAL DEĞERİ (salt-okunur).

Sayım tarihi 01.09.2026, mağaza S02 (Mağusa). Eksik 83 satır / 170 adet,
fazla 91 satır / 106 adet. Barkodlar bu dosyaya gömülüdür.

Bölümler:
  A) Şema keşfi: maliyet/fiyat-listesi tabloları, ProcessCode dağılımı
  B) Barkod -> ürün kimliği (prItemBarcode) + eşleşmeyenler
  C) Anlık S02 stoku (trStock)
  D) Son ALIŞ (perakende dışı fatura) birim fiyatı = maliyet adayı
  E) Son PERAKENDE satış birim fiyatı (KDV dahil)
  F) Fiyat listeleri (trPriceListHeader/Line varsa, tip bazında)
  G) Keşfedilen maliyet tablolarından örnek satırlar
  H) TOPLAMLAR + CSV (KESIF37-SONUC.csv de yazılır)
Cikti: KESIF37-CIKTI.txt   (hiçbir şey YAZMAZ, sadece SELECT)
"""
from __future__ import annotations

import sys
import traceback
from decimal import Decimal

from satis_kopru import load_config, connect

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

OUT = []


def log(*a):
    s = " ".join(str(x) for x in a)
    print(s)
    OUT.append(s)


# (sıra no, barkod, fark adedi, rapordaki envanter)
EKSIK = [
    (1, "8683691366925", 1, 13),
    (2, "8683691819407", 2, 54),
    (3, "5471606752337", 2, 37),
    (4, "5471701283040", 68, 125),
    (5, "5471702002039", 1, 3),
    (6, "8683691700460", 1, 5),
    (7, "5471610360061", 2, 5),
    (8, "5471609971643", 1, 2),
    (9, "5471700322924", 2, 7),
    (10, "5471701140671", 1, 4),
    (11, "8683691923036", 1, 1),
    (12, "8683691455988", 3, 3),
    (13, "8684868036412", 1, 4),
    (14, "5471701618262", 1, 3),
    (15, "5471701918171", 1, 2),
    (16, "5471701918188", 1, 2),
    (17, "5471701918201", 1, 2),
    (18, "8683691109836", 1, 1),
    (19, "8683691332937", 1, 1),
    (20, "8683691270390", 1, 2),
    (21, "8683691270772", 1, 5),
    (22, "8683691262661", 1, 2),
    (23, "8683691263088", 1, 7),
    (24, "8683691263095", 1, 2),
    (25, "8683691195747", 1, 3),
    (26, "8683691236754", 1, 2),
    (27, "8683691239519", 1, 2),
    (28, "8683691238024", 1, 2),
    (29, "8683691265815", 1, 5),
    (30, "8683691266102", 1, 5),
    (31, "8683691282386", 1, 2),
    (32, "8683691201356", 1, 1),
    (33, "8683691337208", 1, 1),
    (34, "8683691337901", 1, 1),
    (35, "8683691657078", 1, 2),
    (36, "8683691561597", 1, 1),
    (37, "8683691646638", 1, 2),
    (38, "8683691646645", 1, 1),
    (39, "8683691646652", 2, 3),
    (40, "8683691506185", 1, 1),
    (41, "8683691521867", 1, 1),
    (42, "8683691783678", 1, 4),
    (43, "8683691772566", 1, 1),
    (44, "8683691662812", 1, 1),
    (45, "8683691729690", 1, 1),
    (46, "8684868071765", 1, 1),
    (47, "8684868143707", 1, 1),
    (48, "8684868145367", 2, 2),
    (49, "8684868154741", 1, 1),
    (50, "8683691829420", 1, 1),
    (51, "8683691850509", 1, 1),
    (52, "8683691850707", 4, 8),
    (53, "8683691998546", 1, 1),
    (54, "8684868010474", 1, 1),
    (55, "8683691999352", 1, 2),
    (56, "8683691936579", 1, 1),
    (57, "8683691824463", 1, 1),
    (58, "8683691913396", 1, 1),
    (59, "8683691847080", 1, 2),
    (60, "8684868178105", 1, 3),
    (61, "8684868022811", 1, 1),
    (62, "8684868022828", 2, 2),
    (63, "8684868022453", 2, 2),
    (64, "8684868115421", 1, 1),
    (65, "8684868059954", 2, 2),
    (66, "8684868184915", 1, 2),
    (67, "8684868180665", 1, 2),
    (68, "8684868195232", 1, 1),
    (69, "8684868387255", 1, 1),
    (70, "8684868196277", 1, 1),
    (71, "8684868400961", 2, 3),
    (72, "8684868380683", 1, 2),
    (73, "8684868352062", 1, 1),
    (74, "8684868384360", 1, 1),
    (75, "8684868351485", 1, 1),
    (76, "8684868378093", 1, 1),
    (77, "8684868313704", 1, 1),
    (78, "8684868280556", 1, 1),
    (79, "8684868178709", 1, 1),
    (80, "8684868233569", 1, 2),
    (81, "8684868237659", 1, 1),
    (82, "4010481379201", 2, 3),
    (83, "8681558491773", 5, 29),
]

FAZLA = [
    (1, "8683691819469", 2, 49),
    (2, "5471609393575", 3, 19),
    (3, "5471702002084", 1, 2),
    (4, "8683691700262", 1, 3),
    (5, "8683691700422", 1, 3),
    (6, "5471609619422", 2, 7),
    (7, "5471609971629", 1, 3),
    (8, "5471610197827", 1, 2),
    (9, "5471610360108", 1, 8),
    (10, "5471700122760", 1, 3),
    (11, "5471701140800", 1, 2),
    (12, "5471701411955", 3, 4),
    (13, "5471701759651", 1, 0),
    (14, "5471701743858", 1, 1),
    (15, "8683691010712", 1, 2),
    (16, "8683691332944", 1, 0),
    (17, "8683691270284", 1, 0),
    (18, "8683691197345", 1, 2),
    (19, "8683691262593", 1, 0),
    (20, "8683691263071", 1, 2),
    (21, "8683691263255", 1, 4),
    (22, "8683691195624", 1, 0),
    (23, "8683691196140", 1, 1),
    (24, "8683691236747", 1, 0),
    (25, "8683691239540", 1, 1),
    (26, "8683691238000", 1, 1),
    (27, "8683691265808", 1, 4),
    (28, "8683691266119", 1, 0),
    (29, "8683691241130", 1, 0),
    (30, "8683691200366", 1, 0),
    (31, "8683691913310", 1, 1),
    (32, "8684868027885", 1, 0),
    (33, "8683691536915", 1, 0),
    (34, "8683691606243", 1, 0),
    (35, "8683691676710", 1, 0),
    (36, "8683691757297", 1, 1),
    (37, "8683691757242", 2, 1),
    (38, "8684868071802", 1, 2),
    (39, "8684868072113", 1, 4),
    (40, "8684868144919", 1, 0),
    (41, "8683691850837", 1, 3),
    (42, "8684868004091", 1, 1),
    (43, "8684868010115", 1, 2),
    (44, "8683691936593", 1, 0),
    (45, "8683691820915", 1, 0),
    (46, "8683691881978", 1, 0),
    (47, "8683691872044", 1, 0),
    (48, "8683691872068", 1, 2),
    (49, "8683691872075", 1, 0),
    (50, "8683691872082", 1, 0),
    (51, "8683691873478", 1, 2),
    (52, "8683691873485", 1, 0),
    (53, "8683691873539", 1, 1),
    (54, "8683691873553", 1, 2),
    (55, "8683691873577", 1, 0),
    (56, "8683691806605", 1, 0),
    (57, "8683691806834", 1, 3),
    (58, "8683691806889", 1, 1),
    (59, "8683691807923", 1, 0),
    (60, "8683691807930", 2, 0),
    (61, "8683691807947", 1, 0),
    (62, "8683691807954", 1, 0),
    (63, "8684868178099", 1, 3),
    (64, "8684868086271", 1, 0),
    (65, "8684868184526", 1, 0),
    (66, "8684868184540", 1, 0),
    (67, "8684868179423", 1, 1),
    (68, "8684868179508", 1, 2),
    (69, "8684868180528", 1, 1),
    (70, "8684868180535", 1, 0),
    (71, "8684868336789", 1, 0),
    (72, "8684868336802", 1, 0),
    (73, "8684868387309", 1, 1),
    (74, "8684868406369", 1, 2),
    (75, "8684868352178", 1, 0),
    (76, "8684868351492", 1, 0),
    (77, "8684868356855", 1, 0),
    (78, "8684868374729", 1, 0),
    (79, "8684868346641", 1, 0),
    (80, "8684868280549", 1, 0),
    (81, "8684868202503", 1, 0),
    (82, "8684868178716", 1, 0),
    (83, "8684868260473", 1, 0),
    (84, "8684868199322", 1, 0),
    (85, "8684868421744", 1, 0),
    (86, "8684868421751", 2, 0),
    (87, "8684868421768", 2, 0),
    (88, "8684868421775", 1, 0),
    (89, "8684868421782", 1, 0),
    (90, "8681558491766", 5, 0),
    (91, "4003424121210", 2, 106),
]


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


def kolonlar(cur, tablo):
    cur.execute("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS "
                "WHERE TABLE_NAME = ? ORDER BY ORDINAL_POSITION", tablo)
    return [r[0] for r in cur.fetchall()]


def tablo_var(cur, tablo):
    cur.execute("SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = ?", tablo)
    return cur.fetchone()[0] > 0


def f(x):
    if x is None:
        return None
    if isinstance(x, Decimal):
        return float(x)
    try:
        return float(x)
    except Exception:
        return None


def s(x):
    return "" if x is None else str(x).strip()


def para(x):
    return "-" if x is None else f"{x:,.2f}"


def values_cte():
    """Barkod setini inline VALUES olarak verir (temp tablo YOK)."""
    satirlar = []
    for no, bk, adet, env in EKSIK:
        satirlar.append(f"('E', {no}, N'{bk}', {adet}, {env})")
    for no, bk, adet, env in FAZLA:
        satirlar.append(f"('F', {no}, N'{bk}', {adet}, {env})")
    return ("S AS (SELECT * FROM (VALUES " + ",\n".join(satirlar) +
            ") v(Tip, SiraNo, Barcode, Adet, RaporEnvanter))")


# barkod -> satır sözlüğü (CSV için)
KAYIT = {}
for tip, liste in (("E", EKSIK), ("F", FAZLA)):
    for no, bk, adet, env in liste:
        KAYIT[(tip, bk)] = {"Tip": tip, "No": no, "Barkod": bk, "Adet": adet,
                            "RaporEnvanter": env}

FL_TIPLERI = []   # fiyat listesi tipleri (F bölümünde dolar)
KESFEDILEN_TABLOLAR = []


@bolum("A) ŞEMA KEŞFİ")
def a_sema(cur):
    global KESFEDILEN_TABLOLAR
    cur.execute("""
        SELECT TABLE_NAME, TABLE_TYPE FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_NAME LIKE '%Cost%' OR TABLE_NAME LIKE '%PriceList%'
           OR TABLE_NAME LIKE '%Purchase%' OR TABLE_NAME LIKE '%Maliyet%'
        ORDER BY TABLE_TYPE, TABLE_NAME""")
    rows = cur.fetchall()
    log(f"  Adında Cost/PriceList/Purchase geçen tablo/görünüm: {len(rows)}")
    for r in rows[:80]:
        log(f"   {r[1][:5]} {r[0]}")
    KESFEDILEN_TABLOLAR = [r[0] for r in rows if r[1] == "BASE TABLE"
                           and ("Cost" in r[0])]

    cur.execute("""
        SELECT TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE COLUMN_NAME LIKE '%Cost%' AND TABLE_NAME LIKE 'tr%'
        ORDER BY TABLE_NAME, COLUMN_NAME""")
    rows = cur.fetchall()
    log(f"\n  'Cost' geçen kolonlar (tr* tabloları, ilk 80 / {len(rows)}):")
    for r in rows[:80]:
        log(f"   {r[0]}.{r[1]}")

    for t in ("trInvoiceLineCurrency", "trStock", "trInvoiceHeader"):
        log(f"\n  {t} kolonları: " + ", ".join(kolonlar(cur, t)))

    log("\n  trInvoiceHeader ProcessCode dağılımı (CompanyCode=1):")
    hk = kolonlar(cur, "trInvoiceHeader")
    ek = ", InvoiceTypeCode" if "InvoiceTypeCode" in hk else ""
    cur.execute(f"""
        SELECT ProcessCode{ek}, IsReturn, COUNT(*), MIN(InvoiceDate), MAX(InvoiceDate)
        FROM trInvoiceHeader WITH(NOLOCK) WHERE CompanyCode = 1
        GROUP BY ProcessCode{ek}, IsReturn ORDER BY ProcessCode{ek}, IsReturn""")
    for r in cur.fetchall():
        log("   " + " | ".join(s(x) for x in r))
    if tablo_var(cur, "cdProcessDesc"):
        try:
            cur.execute("SELECT ProcessCode, ProcessDescription FROM cdProcessDesc "
                        "WHERE LangCode='TR' ORDER BY ProcessCode")
            log("  ProcessCode açıklamaları: " +
                "; ".join(f"{s(r[0])}={s(r[1])}" for r in cur.fetchall()))
        except Exception as e:
            log(f"  (cdProcessDesc okunamadı: {e})")


@bolum("B) BARKOD -> ÜRÜN KİMLİĞİ")
def b_kimlik(cur):
    cur.execute(f"""
        WITH {values_cte()}
        SELECT S.Tip, S.Barcode, b.ItemTypeCode, b.ItemCode, b.ColorCode,
               b.ItemDim1Code, d.ItemDescription
        FROM S
        OUTER APPLY (SELECT TOP 1 * FROM prItemBarcode bb WITH(NOLOCK)
                     WHERE bb.Barcode = S.Barcode) b
        OUTER APPLY (SELECT TOP 1 ItemDescription FROM cdItemDesc dd WITH(NOLOCK)
                     WHERE dd.ItemCode = b.ItemCode AND dd.LangCode = 'TR') d
        ORDER BY S.Tip, S.SiraNo""")
    eslesmeyen = []
    n = 0
    for r in cur.fetchall():
        k = (s(r[0]), s(r[1]))
        if r[3] is None:
            eslesmeyen.append(k)
            continue
        n += 1
        KAYIT[k].update({"ItemTypeCode": s(r[2]), "ItemCode": s(r[3]),
                         "Renk": s(r[4]), "Beden": s(r[5]), "Aciklama": s(r[6])})
    log(f"  eşleşen: {n} / {len(KAYIT)}")
    if eslesmeyen:
        log("  EŞLEŞMEYEN barkodlar: " + ", ".join(f"{t}:{b}" for t, b in eslesmeyen))
    else:
        log("  eşleşmeyen barkod yok ✓")


@bolum("C) ANLIK S02 STOKU")
def c_stok(cur):
    cur.execute(f"""
        WITH {values_cte()}
        SELECT S.Tip, S.Barcode, S.RaporEnvanter,
               (SELECT SUM(st.Qty1) FROM trStock st WITH(NOLOCK)
                 WHERE st.ItemCode = b.ItemCode AND st.ColorCode = b.ColorCode
                   AND st.ItemDim1Code = b.ItemDim1Code AND st.WarehouseCode = 'S02') AS StokS02,
               (SELECT SUM(st.Qty1) FROM trStock st WITH(NOLOCK)
                 WHERE st.ItemCode = b.ItemCode AND st.ColorCode = b.ColorCode
                   AND st.ItemDim1Code = b.ItemDim1Code) AS StokTum
        FROM S
        OUTER APPLY (SELECT TOP 1 * FROM prItemBarcode bb WITH(NOLOCK)
                     WHERE bb.Barcode = S.Barcode) b
        ORDER BY S.Tip, S.SiraNo""")
    farkli = 0
    for r in cur.fetchall():
        k = (s(r[0]), s(r[1]))
        st = f(r[3]); KAYIT[k]["StokS02"] = st; KAYIT[k]["StokTum"] = f(r[4])
        if st is not None and int(st) != int(r[2]):
            farkli += 1
    log(f"  trStock S02 toplamı rapordaki envanterden farklı olan satır: {farkli} "
        f"(sayımdan bu yana satış/transfer olabilir; bilgi amaçlı)")


@bolum("D) SON ALIŞ (perakende dışı fatura) = MALİYET ADAYI")
def d_alis(cur):
    hk = kolonlar(cur, "trInvoiceHeader")
    ck = kolonlar(cur, "trInvoiceLineCurrency")
    lk = kolonlar(cur, "trInvoiceLine")
    pve = "c.PriceVE" if "PriceVE" in ck else "NULL"
    net = "c.NetAmount" if "NetAmount" in ck else "NULL"
    doc = ("h.DocCurrencyCode" if "DocCurrencyCode" in hk else "NULL")
    docjoin = ""
    docsel = "NULL AS DocPriceVE"
    if "DocCurrencyCode" in hk:
        docjoin = ("LEFT JOIN trInvoiceLineCurrency cd WITH(NOLOCK) ON cd.InvoiceLineID = l.InvoiceLineID "
                   "AND cd.CurrencyCode = h.DocCurrencyCode AND h.DocCurrencyCode <> h.LocalCurrencyCode")
        docsel = ("cd.PriceVE AS DocPriceVE" if "PriceVE" in ck else "cd.PriceVI AS DocPriceVE")
    wh = "h.WarehouseCode" if "WarehouseCode" in hk else "NULL"
    itc = "h.InvoiceTypeCode" if "InvoiceTypeCode" in hk else "NULL"
    vat = "l.VatRate" if "VatRate" in lk else "NULL"
    cak = kolonlar(cur, "cdCurrAcc")
    cari_ad = next((c for c in ("CurrAccDescription", "FirstLastName", "CurrAccDesc") if c in cak), "NULL")
    cur.execute(f"""
        WITH {values_cte()}
        SELECT S.Tip, S.Barcode, a.InvoiceDate, a.ProcessCode, a.InvoiceTypeCode, a.CurrAccCode,
               ca.CurrAccDescription, a.StoreCode, a.WarehouseCode, a.Qty1, a.VatRate,
               a.PriceVE, a.PriceVI, a.NetAmount, a.DocCurrencyCode, a.DocPriceVE, a.Eslesme,
               a.InvoiceNumber
        FROM S
        OUTER APPLY (SELECT TOP 1 * FROM prItemBarcode bb WITH(NOLOCK)
                     WHERE bb.Barcode = S.Barcode) b
        OUTER APPLY (
            SELECT TOP 1 h.InvoiceDate, h.ProcessCode, {itc} AS InvoiceTypeCode, h.CurrAccCode,
                   h.StoreCode, {wh} AS WarehouseCode, l.Qty1, {vat} AS VatRate,
                   {pve} AS PriceVE, c.PriceVI, {net} AS NetAmount,
                   {doc} AS DocCurrencyCode, {docsel}, h.InvoiceNumber,
                   CASE WHEN l.ColorCode = b.ColorCode AND l.ItemDim1Code = b.ItemDim1Code THEN 1
                        WHEN l.ColorCode = b.ColorCode THEN 2 ELSE 3 END AS Eslesme
            FROM trInvoiceLine l WITH(NOLOCK)
            JOIN trInvoiceHeader h WITH(NOLOCK) ON h.InvoiceHeaderID = l.InvoiceHeaderID
            JOIN trInvoiceLineCurrency c WITH(NOLOCK) ON c.InvoiceLineID = l.InvoiceLineID
                 AND c.CurrencyCode = h.LocalCurrencyCode
            {docjoin}
            WHERE l.ItemCode = b.ItemCode AND h.ProcessCode <> 'R' AND h.IsReturn = 0
            ORDER BY Eslesme, h.InvoiceDate DESC, h.CreatedDate DESC) a
        OUTER APPLY (SELECT TOP 1 {cari_ad} AS CurrAccDescription FROM cdCurrAcc cc WITH(NOLOCK)
                     WHERE cc.CurrAccCode = a.CurrAccCode) ca
        ORDER BY S.Tip, S.SiraNo""")
    yok = 0; pc = {}
    for r in cur.fetchall():
        k = (s(r[0]), s(r[1]))
        if r[2] is None:
            yok += 1; continue
        q = f(r[9]) or 0
        netb = (f(r[13]) / q) if (f(r[13]) is not None and q) else None
        KAYIT[k].update({"AlisTarih": s(r[2])[:10], "AlisProcess": s(r[3]), "AlisTip": s(r[4]),
                         "AlisCari": s(r[5]), "AlisCariAd": s(r[6]), "AlisMagaza": s(r[7]),
                         "AlisDepo": s(r[8]), "AlisKDV": f(r[10]), "AlisPriceVE": f(r[11]),
                         "AlisPriceVI": f(r[12]), "AlisNetBirim": netb, "AlisDoviz": s(r[14]),
                         "AlisDovizPriceVE": f(r[15]), "AlisEslesme": s(r[16]), "AlisFis": s(r[17])})
        pc[s(r[3])] = pc.get(s(r[3]), 0) + 1
    log(f"  alış kaydı bulunamayan satır: {yok} / {len(KAYIT)}")
    log(f"  bulunanların ProcessCode dağılımı: {pc}")
    ornek = [v for v in KAYIT.values() if v.get("AlisTarih")][:5]
    for v in ornek:
        log(f"   örn {v['Barkod']} {v.get('ItemCode')} → {v['AlisTarih']} {v['AlisProcess']} "
            f"{v['AlisCari']} {v['AlisCariAd']} VE={para(v['AlisPriceVE'])} VI={para(v['AlisPriceVI'])} "
            f"döviz={v['AlisDoviz']} {para(v['AlisDovizPriceVE'])} eşleşme={v['AlisEslesme']}")


@bolum("E) SON PERAKENDE SATIŞ FİYATI (KDV dahil)")
def e_satis(cur):
    ck = kolonlar(cur, "trInvoiceLineCurrency")
    net = "c.NetAmount" if "NetAmount" in ck else "NULL"
    cur.execute(f"""
        WITH {values_cte()}
        SELECT S.Tip, S.Barcode, a.InvoiceDate, a.StoreCode, a.PriceVI, a.NetAmount, a.Qty1, a.Eslesme
        FROM S
        OUTER APPLY (SELECT TOP 1 * FROM prItemBarcode bb WITH(NOLOCK)
                     WHERE bb.Barcode = S.Barcode) b
        OUTER APPLY (
            SELECT TOP 1 h.InvoiceDate, h.StoreCode, c.PriceVI, {net} AS NetAmount, l.Qty1,
                   CASE WHEN l.ColorCode = b.ColorCode THEN 1 ELSE 2 END AS Eslesme
            FROM trInvoiceLine l WITH(NOLOCK)
            JOIN trInvoiceHeader h WITH(NOLOCK) ON h.InvoiceHeaderID = l.InvoiceHeaderID
            JOIN trInvoiceLineCurrency c WITH(NOLOCK) ON c.InvoiceLineID = l.InvoiceLineID
                 AND c.CurrencyCode = h.LocalCurrencyCode
            WHERE l.ItemCode = b.ItemCode AND h.ProcessCode = 'R' AND h.IsReturn = 0
            ORDER BY Eslesme, h.InvoiceDate DESC, h.CreatedDate DESC) a
        ORDER BY S.Tip, S.SiraNo""")
    yok = 0
    for r in cur.fetchall():
        k = (s(r[0]), s(r[1]))
        if r[2] is None:
            yok += 1; continue
        q = f(r[6]) or 0
        netb = (f(r[5]) / q) if (f(r[5]) is not None and q) else None
        KAYIT[k].update({"SatisTarih": s(r[2])[:10], "SatisMagaza": s(r[3]),
                         "SatisPriceVI": f(r[4]), "SatisNetBirim": netb, "SatisEslesme": s(r[7])})
    log(f"  perakende satışı hiç olmayan satır: {yok} / {len(KAYIT)}")


@bolum("F) FİYAT LİSTELERİ")
def f_fiyat_listesi(cur):
    global FL_TIPLERI
    if not tablo_var(cur, "trPriceListLine") or not tablo_var(cur, "trPriceListHeader"):
        log("  trPriceListHeader/Line yok — atlandı"); return
    hk = kolonlar(cur, "trPriceListHeader"); lk = kolonlar(cur, "trPriceListLine")
    log("  trPriceListHeader: " + ", ".join(hk))
    log("  trPriceListLine: " + ", ".join(lk))
    tarih = next((c for c in ("PriceListDate", "ValidFrom", "StartDate", "CreatedDate",
                              "LastUpdatedDate") if c in hk), None)
    fiyat = next((c for c in ("Price", "PriceVI", "UnitPrice", "SalesPrice") if c in lk), None)
    tip = "PriceListTypeCode" if "PriceListTypeCode" in hk else None
    if not (tarih and fiyat and "ItemCode" in lk and "PriceListHeaderID" in lk):
        log("  beklenen kolonlar yok — sorgu atlandı"); return
    if tip:
        cur.execute(f"SELECT {tip}, COUNT(*), MAX({tarih}) FROM trPriceListHeader WITH(NOLOCK) "
                    f"GROUP BY {tip} ORDER BY {tip}")
        tipler = cur.fetchall()
        log("  tipler (tip | liste sayısı | son tarih): " +
            "; ".join(" | ".join(s(x) for x in r) for r in tipler))
        if tablo_var(cur, "cdPriceListTypeDesc"):
            try:
                cur.execute("SELECT PriceListTypeCode, PriceListTypeDescription FROM cdPriceListTypeDesc "
                            "WHERE LangCode='TR'")
                log("  tip açıklamaları: " + "; ".join(f"{s(r[0])}={s(r[1])}" for r in cur.fetchall()))
            except Exception as e:
                log(f"  (cdPriceListTypeDesc okunamadı: {e})")
        FL_TIPLERI = [s(r[0]) for r in tipler][:6]
    else:
        FL_TIPLERI = ["TUM"]
    renk = ("(pl.ColorCode = b.ColorCode OR ISNULL(pl.ColorCode,'') = '')"
            if "ColorCode" in lk else "1=1")
    beden = ("CASE WHEN ISNULL(pl.ItemDim1Code,'') IN ('', b.ItemDim1Code) THEN 0 ELSE 1 END"
             if "ItemDim1Code" in lk else "0")
    cur_col = "pl.CurrencyCode" if "CurrencyCode" in lk else ("ph.CurrencyCode" if "CurrencyCode" in hk else "NULL")
    for t in FL_TIPLERI:
        kosul = f"AND ph.{tip} = N'{t}'" if tip else ""
        cur.execute(f"""
            WITH {values_cte()}
            SELECT S.Tip, S.Barcode, x.Fiyat, x.Tarih, x.Doviz
            FROM S
            OUTER APPLY (SELECT TOP 1 * FROM prItemBarcode bb WITH(NOLOCK)
                         WHERE bb.Barcode = S.Barcode) b
            OUTER APPLY (
                SELECT TOP 1 pl.{fiyat} AS Fiyat, ph.{tarih} AS Tarih, {cur_col} AS Doviz
                FROM trPriceListLine pl WITH(NOLOCK)
                JOIN trPriceListHeader ph WITH(NOLOCK) ON ph.PriceListHeaderID = pl.PriceListHeaderID
                WHERE pl.ItemCode = b.ItemCode AND {renk} {kosul}
                ORDER BY {beden}, ph.{tarih} DESC) x
            ORDER BY S.Tip, S.SiraNo""")
        n = 0
        for r in cur.fetchall():
            if r[2] is None:
                continue
            n += 1
            KAYIT[(s(r[0]), s(r[1]))][f"FL_{t}"] = f(r[2])
            KAYIT[(s(r[0]), s(r[1]))][f"FL_{t}_Tarih"] = s(r[3])[:10]
            KAYIT[(s(r[0]), s(r[1]))][f"FL_{t}_Doviz"] = s(r[4])
        log(f"  tip {t}: fiyat bulunan satır {n} / {len(KAYIT)}")


@bolum("G) MALİYET TABLOLARINDAN ÖRNEK")
def g_maliyet_tablolari(cur):
    if not KESFEDILEN_TABLOLAR:
        log("  adında 'Cost' geçen temel tablo yok"); return
    ornek = next((v for v in KAYIT.values() if v.get("ItemCode")), None)
    for t in KESFEDILEN_TABLOLAR[:6]:
        kol = kolonlar(cur, t)
        log(f"\n  {t}: " + ", ".join(kol))
        try:
            cur.execute(f"SELECT COUNT(*) FROM {t} WITH(NOLOCK)")
            log(f"   satır sayısı: {cur.fetchone()[0]}")
            if ornek and "ItemCode" in kol:
                cur.execute(f"SELECT TOP 3 * FROM {t} WITH(NOLOCK) WHERE ItemCode = ?", ornek["ItemCode"])
                for r in cur.fetchall():
                    log("   " + " | ".join(s(x) for x in r)[:400])
            else:
                cur.execute(f"SELECT TOP 2 * FROM {t} WITH(NOLOCK)")
                for r in cur.fetchall():
                    log("   " + " | ".join(s(x) for x in r)[:400])
        except Exception as e:
            log(f"   okunamadı: {e}")


@bolum("H) TOPLAMLAR + CSV")
def h_toplam(cur):
    def toplam(tip, alan):
        tut = 0.0; adet_var = 0; adet_yok = 0
        for v in KAYIT.values():
            if v["Tip"] != tip:
                continue
            x = v.get(alan)
            if x is None:
                adet_yok += v["Adet"]
            else:
                tut += x * v["Adet"]; adet_var += v["Adet"]
        return tut, adet_var, adet_yok

    alanlar = [("AlisPriceVE", "SON ALIŞ KDV hariç birim (maliyet)"),
               ("AlisPriceVI", "SON ALIŞ KDV dahil birim"),
               ("SatisPriceVI", "SON PERAKENDE SATIŞ KDV dahil birim"),
               ("SatisNetBirim", "SON PERAKENDE SATIŞ net birim (indirim sonrası)")]
    for t in FL_TIPLERI:
        alanlar.append((f"FL_{t}", f"FİYAT LİSTESİ tip {t}"))
    for alan, ad in alanlar:
        e = toplam("E", alan); fz = toplam("F", alan)
        log(f"\n  {ad}:")
        log(f"   EKSİK : {para(e[0])} TL  (fiyatı olan {e[1]} adet, fiyatsız {e[2]} adet)")
        log(f"   FAZLA : {para(fz[0])} TL  (fiyatı olan {fz[1]} adet, fiyatsız {fz[2]} adet)")
        log(f"   NET   : {para(fz[0]-e[0])} TL  (fazla - eksik)")

    kolon = ["Tip", "No", "Barkod", "Adet", "RaporEnvanter", "ItemCode", "Renk", "Beden", "Aciklama",
             "StokS02", "StokTum", "AlisTarih", "AlisProcess", "AlisTip", "AlisCari", "AlisCariAd",
             "AlisMagaza", "AlisDepo", "AlisFis", "AlisKDV", "AlisPriceVE", "AlisPriceVI", "AlisNetBirim",
             "AlisDoviz", "AlisDovizPriceVE", "AlisEslesme", "SatisTarih", "SatisMagaza",
             "SatisPriceVI", "SatisNetBirim", "SatisEslesme"]
    for t in FL_TIPLERI:
        kolon += [f"FL_{t}", f"FL_{t}_Tarih", f"FL_{t}_Doviz"]

    def hucre(x):
        if x is None:
            return ""
        if isinstance(x, float):
            return f"{x:.4f}".rstrip("0").rstrip(".")
        return str(x).replace(";", ",").replace("\n", " ")

    satirlar = [";".join(kolon)]
    for v in sorted(KAYIT.values(), key=lambda v: (v["Tip"], v["No"])):
        satirlar.append(";".join(hucre(v.get(c)) for c in kolon))
    try:
        with open("KESIF37-SONUC.csv", "w", encoding="utf-8-sig") as fh:
            fh.write("\n".join(satirlar))
        log("\n  KESIF37-SONUC.csv yazıldı (Excel'de açılır).")
    except Exception as e:
        log(f"\n  CSV yazılamadı: {e}")
    log("\n--- CSV-BASLA ---")
    for sat in satirlar:
        log(sat)
    log("--- CSV-BITIR ---")


def main():
    cfg = load_config()
    log(">>> KEŞİF v37 — Mağusa sayım farkları parasal değer (salt-okunur)")
    log(f"    eksik {len(EKSIK)} satır / {sum(x[2] for x in EKSIK)} adet · "
        f"fazla {len(FAZLA)} satır / {sum(x[2] for x in FAZLA)} adet")
    conn = connect(cfg)
    cur = conn.cursor()
    a_sema(cur)
    b_kimlik(cur)
    c_stok(cur)
    d_alis(cur)
    e_satis(cur)
    f_fiyat_listesi(cur)
    g_maliyet_tablolari(cur)
    h_toplam(cur)
    log("\n>>> KEŞİF v37 TAMAM. KESIF37-CIKTI.txt dosyasının TAMAMINI yapıştır "
        "(veya KESIF37-SONUC.csv dosyasını gönder).")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log(traceback.format_exc())
    try:
        with open("KESIF37-CIKTI.txt", "w", encoding="utf-8") as fh:
            fh.write("\n".join(OUT))
        print("\n>>> KESIF37-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
