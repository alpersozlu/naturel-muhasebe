"""NEBIM KEŞİF v39 — ALIŞ/ETİKET ORANI + ETİKET-IND FİYAT LİSTELERİ (salt-okunur).

KESIF38 bulgusu: 1-BP-7-115 (13.11.2025, 299 satır) fiyatlı girilmiş; fiyat listeleri
iki grupta: ETİKET (etiket fiyatı) ve IND (indirimli/güncel satış fiyatı).
  A) 1-BP-7-115'in 299 satırı: BP birim fiyat ↔ ETİKET listesi ↔ IND listesi ↔ faturadan
     sonraki ilk perakende satış etiket fiyatı → oran istatistiği
  B) 174 barkod için ayrı ayrı: son ETİKET fiyatı ve son IND fiyatı (tarihleriyle)
  C) CSV
Cikti: KESIF39-CIKTI.txt   (hiçbir şey YAZMAZ, sadece SELECT)
"""
from __future__ import annotations

import statistics
import sys
import traceback

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


def f(x):
    if x is None:
        return None
    try:
        return float(x)
    except Exception:
        return None


def s(x):
    return "" if x is None else str(x).strip()


def para(x):
    return "-" if x is None else f"{x:,.2f}"


def h(x):
    if x is None:
        return ""
    if isinstance(x, float):
        return f"{x:.4f}".rstrip("0").rstrip(".")
    return str(x).replace(";", ",")


def values_cte():
    satirlar = []
    for no, bk, adet, env in EKSIK:
        satirlar.append(f"('E', {no}, N'{bk}', {adet}, {env})")
    for no, bk, adet, env in FAZLA:
        satirlar.append(f"('F', {no}, N'{bk}', {adet}, {env})")
    return ("S AS (SELECT * FROM (VALUES " + ",\n".join(satirlar) +
            ") v(Tip, SiraNo, Barcode, Adet, RaporEnvanter))")


def liste_apply(alias, grup_kosulu, item="l.ItemCode", color="l.ColorCode", dim="l.ItemDim1Code"):
    """Belirli fiyat grubundaki en güncel liste fiyatı (renk/beden uyumlu satır önce)."""
    return f"""
        OUTER APPLY (
            SELECT TOP 1 pl.Price, ph.PriceListDate, ph.PriceListNumber
            FROM trPriceListLine pl WITH(NOLOCK)
            JOIN trPriceListHeader ph WITH(NOLOCK) ON ph.PriceListHeaderID = pl.PriceListHeaderID
            WHERE pl.ItemCode = {item}
              AND (pl.ColorCode = {color} OR ISNULL(pl.ColorCode, '') = '')
              AND {grup_kosulu}
            ORDER BY CASE WHEN ISNULL(pl.ItemDim1Code,'') IN ('', {dim}) THEN 0 ELSE 1 END,
                     ph.PriceListDate DESC, ph.PriceListTime DESC) {alias}"""


ETIKET = "ph.PriceGroupCode LIKE N'ET%'"
IND = "ph.PriceGroupCode = N'IND'"

A_SATIR = []


@bolum("A) 1-BP-7-115 — BP FİYATI ↔ ETİKET / IND / İLK SATIŞ")
def a_fatura(cur):
    cur.execute(f"""
        SELECT l.ItemCode, l.ColorCode, l.ItemDim1Code, l.Qty1, c.PriceVI,
               et.Price, et.PriceListDate, ind.Price, ind.PriceListDate,
               ilk.PriceVI, ilk.InvoiceDate, ilk.NetBirim, d.ItemDescription
        FROM trInvoiceHeader hh WITH(NOLOCK)
        JOIN trInvoiceLine l WITH(NOLOCK) ON l.InvoiceHeaderID = hh.InvoiceHeaderID
        JOIN trInvoiceLineCurrency c WITH(NOLOCK) ON c.InvoiceLineID = l.InvoiceLineID
             AND c.CurrencyCode = hh.LocalCurrencyCode
        {liste_apply("et", ETIKET)}
        {liste_apply("ind", IND)}
        OUTER APPLY (
            SELECT TOP 1 c2.PriceVI, h2.InvoiceDate, c2.NetAmount / NULLIF(l2.Qty1, 0) AS NetBirim
            FROM trInvoiceLine l2 WITH(NOLOCK)
            JOIN trInvoiceHeader h2 WITH(NOLOCK) ON h2.InvoiceHeaderID = l2.InvoiceHeaderID
            JOIN trInvoiceLineCurrency c2 WITH(NOLOCK) ON c2.InvoiceLineID = l2.InvoiceLineID
                 AND c2.CurrencyCode = h2.LocalCurrencyCode
            WHERE l2.ItemCode = l.ItemCode AND l2.ColorCode = l.ColorCode
              AND h2.ProcessCode = 'R' AND h2.IsReturn = 0 AND h2.InvoiceDate >= hh.InvoiceDate
            ORDER BY h2.InvoiceDate ASC, h2.CreatedDate ASC) ilk
        OUTER APPLY (SELECT TOP 1 ItemDescription FROM cdItemDesc dd WITH(NOLOCK)
                     WHERE dd.ItemCode = l.ItemCode AND dd.LangCode = 'TR') d
        WHERE hh.InvoiceNumber = '1-BP-7-115' AND hh.ProcessCode = 'BP'
        ORDER BY l.ItemCode, l.ColorCode, l.ItemDim1Code""")
    rows = cur.fetchall()
    log(f"  satır: {len(rows)}")
    o_et, o_ind, o_ilk = [], [], []
    for r in rows:
        bp, et, ind, ilk = f(r[4]), f(r[5]), f(r[7]), f(r[9])
        A_SATIR.append([s(r[0]), s(r[1]), s(r[2]), f(r[3]), bp, et, s(r[6])[:10], ind, s(r[8])[:10],
                        ilk, s(r[10])[:10], f(r[11]), s(r[12])])
        if bp and et: o_et.append(bp / et)
        if bp and ind: o_ind.append(bp / ind)
        if bp and ilk: o_ilk.append(bp / ilk)

    def ist(ad, o):
        if not o:
            log(f"  {ad}: veri yok"); return
        med = statistics.median(o)
        yakin = sum(1 for x in o if abs(x - med) <= 0.01)
        log(f"  {ad}: n={len(o)} medyan={med:.4f} ort={statistics.mean(o):.4f} "
            f"min={min(o):.4f} max={max(o):.4f} | medyana ±0,01 içinde: {yakin}")
    ist("BP / ETİKET listesi", o_et)
    ist("BP / IND listesi", o_ind)
    ist("BP / ilk satış etiket fiyatı", o_ilk)


B_SATIR = []


@bolum("B) 174 BARKOD — SON ETİKET ve SON IND FİYATI")
def b_listeler(cur):
    cur.execute(f"""
        WITH {values_cte()}
        SELECT S.Tip, S.SiraNo, S.Barcode, et.Price, et.PriceListDate, et.PriceListNumber,
               ind.Price, ind.PriceListDate, ind.PriceListNumber
        FROM S
        OUTER APPLY (SELECT TOP 1 * FROM prItemBarcode bb WITH(NOLOCK)
                     WHERE bb.Barcode = S.Barcode) b
        {liste_apply("et", ETIKET, "b.ItemCode", "b.ColorCode", "b.ItemDim1Code")}
        {liste_apply("ind", IND, "b.ItemCode", "b.ColorCode", "b.ItemDim1Code")}
        ORDER BY S.Tip, S.SiraNo""")
    n_et = n_ind = 0
    for r in cur.fetchall():
        B_SATIR.append([s(r[0]), int(r[1]), s(r[2]), f(r[3]), s(r[4])[:10], s(r[5]),
                        f(r[6]), s(r[7])[:10], s(r[8])])
        n_et += r[3] is not None; n_ind += r[6] is not None
    log(f"  ETİKET fiyatı bulunan: {n_et} / {len(B_SATIR)} · IND fiyatı bulunan: {n_ind} / {len(B_SATIR)}")


@bolum("C) CSV")
def c_csv(cur):
    log("--- CSV-A-BASLA ---")
    log("ItemCode;Renk;Beden;Adet;BP;Etiket;EtiketTarih;IND;INDTarih;IlkSatisEtiket;IlkSatisTarih;IlkSatisNet;Aciklama")
    for r in A_SATIR:
        log(";".join(h(x) for x in r))
    log("--- CSV-A-BITIR ---")
    log("--- CSV-B-BASLA ---")
    log("Tip;No;Barkod;Etiket;EtiketTarih;EtiketListe;IND;INDTarih;INDListe")
    for r in B_SATIR:
        log(";".join(h(x) for x in r))
    log("--- CSV-B-BITIR ---")
    try:
        with open("KESIF39-SONUC.csv", "w", encoding="utf-8-sig") as fh:
            fh.write("\n".join(OUT))
    except Exception as e:
        log(f"  dosya yazılamadı: {e}")


def main():
    cfg = load_config()
    log(">>> KEŞİF v39 — alış/etiket oranı + ETİKET/IND listeleri (salt-okunur)")
    conn = connect(cfg)
    cur = conn.cursor()
    a_fatura(cur)
    b_listeler(cur)
    c_csv(cur)
    log("\n>>> KEŞİF v39 TAMAM. KESIF39-CIKTI.txt dosyasının TAMAMINI yapıştır.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log(traceback.format_exc())
    try:
        with open("KESIF39-CIKTI.txt", "w", encoding="utf-8") as fh:
            fh.write("\n".join(OUT))
        print("\n>>> KESIF39-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
