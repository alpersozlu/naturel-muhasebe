"""NEBIM KEŞİF v38 — MALİYET KAYNAĞI ARAMA (salt-okunur). KESIF37'nin devamı.

KESIF37 bulgusu: tüm girişler 'BP' faturası, birim fiyatlar 0 (tek istisna 1-BP-7-115).
Bu script maliyetin Nebim'de başka bir yerde olup olmadığını arar:
  A) BP faturaları listesi: hangi faturalarda fiyat var? (+ ProcessCode açıklaması)
  B) 174 barkod için fiyatı > 0 olan SON BP satırı (maliyet adayı)
  C) Maliyet modülü tabloları (trEndOfPeriodInventory, trCostOfGoodsSold*) dolu mu?
  D) Anlık S02 stoku (In_Qty1 - Out_Qty1) ↔ rapor envanteri
  E) Fiyat listesi başlıkları: IsTaxIncluded / PriceGroupCode dağılımı
  F) Cari 32001001 kimliği
  G) CSV
Cikti: KESIF38-CIKTI.txt   (hiçbir şey YAZMAZ, sadece SELECT)
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
    try:
        return float(x)
    except Exception:
        return None


def s(x):
    return "" if x is None else str(x).strip()


def para(x):
    return "-" if x is None else f"{x:,.2f}"


def values_cte():
    satirlar = []
    for no, bk, adet, env in EKSIK:
        satirlar.append(f"('E', {no}, N'{bk}', {adet}, {env})")
    for no, bk, adet, env in FAZLA:
        satirlar.append(f"('F', {no}, N'{bk}', {adet}, {env})")
    return ("S AS (SELECT * FROM (VALUES " + ",\n".join(satirlar) +
            ") v(Tip, SiraNo, Barcode, Adet, RaporEnvanter))")


BARKOD_APPLY = ("OUTER APPLY (SELECT TOP 1 * FROM prItemBarcode bb WITH(NOLOCK) "
                "WHERE bb.Barcode = S.Barcode) b")

KAYIT = {}
for tip, liste in (("E", EKSIK), ("F", FAZLA)):
    for no, bk, adet, env in liste:
        KAYIT[(tip, bk)] = {"Tip": tip, "No": no, "Barkod": bk, "Adet": adet,
                            "RaporEnvanter": env}


@bolum("A) BP FATURALARI — HANGİLERİNDE FİYAT VAR?")
def a_bp(cur):
    for t in ("bsProcessDesc", "cdProcessDesc"):
        if tablo_var(cur, t):
            try:
                cur.execute(f"SELECT ProcessCode, ProcessDescription FROM {t} WITH(NOLOCK) "
                            "WHERE ProcessCode IN ('BP','R','WP','WS') ORDER BY ProcessCode")
                log(f"  {t}: " + "; ".join(f"{s(r[0])}={s(r[1])}" for r in cur.fetchall()))
            except Exception as e:
                log(f"  ({t} okunamadı: {str(e)[:120]})")
    cur.execute("""
        SELECT h.InvoiceNumber, h.InvoiceDate, h.CurrAccCode, h.WarehouseCode, h.StoreCode,
               COUNT(*) AS Satir, SUM(l.Qty1) AS Adet,
               SUM(c.AmountVI) AS AmountVI, SUM(c.NetAmount) AS Net,
               SUM(CASE WHEN c.PriceVI > 0 THEN 1 ELSE 0 END) AS FiyatliSatir,
               h.Description
        FROM trInvoiceHeader h WITH(NOLOCK)
        JOIN trInvoiceLine l WITH(NOLOCK) ON l.InvoiceHeaderID = h.InvoiceHeaderID
        JOIN trInvoiceLineCurrency c WITH(NOLOCK) ON c.InvoiceLineID = l.InvoiceLineID
             AND c.CurrencyCode = h.LocalCurrencyCode
        WHERE h.ProcessCode = 'BP' AND h.CompanyCode = 1
        GROUP BY h.InvoiceHeaderID, h.InvoiceNumber, h.InvoiceDate, h.CurrAccCode,
                 h.WarehouseCode, h.StoreCode, h.Description
        ORDER BY h.InvoiceDate, h.InvoiceNumber""")
    rows = cur.fetchall()
    fiyatli = [r for r in rows if (r[9] or 0) > 0]
    log(f"  BP fatura sayısı: {len(rows)} · fiyatlı satırı olan fatura: {len(fiyatli)}")
    log("  fiş | tarih | cari | depo | mağaza | satır | adet | AmountVI | Net | fiyatlı satır | açıklama")
    for r in rows:
        isaret = " <<< FİYATLI" if (r[9] or 0) > 0 else ""
        log(f"   {s(r[0])} | {s(r[1])[:10]} | {s(r[2])} | {s(r[3])} | {s(r[4])} | {r[5]} | "
            f"{para(f(r[6]))} | {para(f(r[7]))} | {para(f(r[8]))} | {r[9]} | {s(r[10])[:40]}{isaret}")


@bolum("B) 174 BARKOD — FİYATI > 0 OLAN SON BP SATIRI")
def b_fiyatli_bp(cur):
    cur.execute(f"""
        WITH {values_cte()}
        SELECT S.Tip, S.Barcode, a.InvoiceDate, a.InvoiceNumber, a.PriceVI, a.NetBirim, a.Qty1, a.Eslesme
        FROM S
        {BARKOD_APPLY}
        OUTER APPLY (
            SELECT TOP 1 h.InvoiceDate, h.InvoiceNumber, c.PriceVI,
                   c.NetAmount / NULLIF(l.Qty1, 0) AS NetBirim, l.Qty1,
                   CASE WHEN l.ColorCode = b.ColorCode AND l.ItemDim1Code = b.ItemDim1Code THEN 1
                        WHEN l.ColorCode = b.ColorCode THEN 2 ELSE 3 END AS Eslesme
            FROM trInvoiceLine l WITH(NOLOCK)
            JOIN trInvoiceHeader h WITH(NOLOCK) ON h.InvoiceHeaderID = l.InvoiceHeaderID
            JOIN trInvoiceLineCurrency c WITH(NOLOCK) ON c.InvoiceLineID = l.InvoiceLineID
                 AND c.CurrencyCode = h.LocalCurrencyCode
            WHERE l.ItemCode = b.ItemCode AND h.ProcessCode = 'BP' AND h.IsReturn = 0
              AND c.PriceVI > 0
            ORDER BY Eslesme, h.InvoiceDate DESC, h.CreatedDate DESC) a
        ORDER BY S.Tip, S.SiraNo""")
    n = 0
    for r in cur.fetchall():
        k = (s(r[0]), s(r[1]))
        if r[2] is None:
            continue
        n += 1
        KAYIT[k].update({"MaliyetBP": f(r[4]), "MaliyetBPNet": f(r[5]), "MaliyetBPTarih": s(r[2])[:10],
                         "MaliyetBPFis": s(r[3]), "MaliyetBPEslesme": s(r[7])})
    log(f"  fiyatlı BP satırı bulunan barkod: {n} / {len(KAYIT)}")
    for tip in "EF":
        tut = sum(v["MaliyetBP"] * v["Adet"] for v in KAYIT.values()
                  if v["Tip"] == tip and v.get("MaliyetBP"))
        adet = sum(v["Adet"] for v in KAYIT.values() if v["Tip"] == tip and v.get("MaliyetBP"))
        log(f"   {'EKSİK' if tip == 'E' else 'FAZLA'}: {para(tut)} TL ({adet} adet fiyatlı)")


@bolum("C) MALİYET MODÜLÜ TABLOLARI")
def c_maliyet_modulu(cur):
    for t in ("trCostOfGoodsSoldHeader", "trCostOfGoodsSoldLine", "trEndOfPeriodInventory",
              "trInnerLine"):
        if not tablo_var(cur, t):
            log(f"  {t}: YOK"); continue
        kol = kolonlar(cur, t)
        cur.execute(f"SELECT COUNT(*) FROM {t} WITH(NOLOCK)")
        n = cur.fetchone()[0]
        log(f"\n  {t}: {n} satır")
        log("   kolonlar: " + ", ".join(kol))
        if n == 0:
            continue
        if "CostPrice" in kol:
            cur.execute(f"SELECT COUNT(*), MIN(CostPrice), MAX(CostPrice) FROM {t} WITH(NOLOCK) "
                        "WHERE CostPrice > 0")
            r = cur.fetchone()
            log(f"   CostPrice > 0 satır: {r[0]} (min {para(f(r[1]))}, max {para(f(r[2]))})")
        if t == "trCostOfGoodsSoldHeader":
            cur.execute("SELECT TOP 5 * FROM trCostOfGoodsSoldHeader WITH(NOLOCK) "
                        "ORDER BY CreatedDate DESC")
            for r in cur.fetchall():
                log("   " + " | ".join(s(x) for x in r)[:300])
        if t == "trInnerLine":
            cur.execute("SELECT COUNT(*) FROM trInnerLine WITH(NOLOCK) WHERE CostPrice > 0")
            log(f"   trInnerLine CostPrice>0: {cur.fetchone()[0]}")
        if "ItemCode" in kol and "CostPrice" in kol and t != "trInnerLine":
            renk = "AND (x.ColorCode = b.ColorCode)" if "ColorCode" in kol else ""
            sira = "CostOfGoodsSoldHeaderID" if "CostOfGoodsSoldHeaderID" in kol else \
                   ("CreatedDate" if "CreatedDate" in kol else kol[0])
            cur.execute(f"""
                WITH {values_cte()}
                SELECT S.Tip, S.Barcode, y.CostPrice, y.Sira
                FROM S
                {BARKOD_APPLY}
                OUTER APPLY (SELECT TOP 1 x.CostPrice, x.{sira} AS Sira FROM {t} x WITH(NOLOCK)
                             WHERE x.ItemCode = b.ItemCode {renk} AND x.CostPrice > 0
                             ORDER BY x.{sira} DESC) y
                ORDER BY S.Tip, S.SiraNo""")
            m = 0
            for r in cur.fetchall():
                if r[2] is None:
                    continue
                m += 1
                KAYIT[(s(r[0]), s(r[1]))][f"Cost_{t}"] = f(r[2])
            log(f"   174 barkoddan CostPrice>0 bulunan: {m}")


@bolum("D) ANLIK S02 STOKU (In_Qty1 - Out_Qty1)")
def d_stok(cur):
    cur.execute(f"""
        WITH {values_cte()}
        SELECT S.Tip, S.Barcode, S.RaporEnvanter,
               (SELECT SUM(ISNULL(st.In_Qty1,0)) - SUM(ISNULL(st.Out_Qty1,0))
                  FROM trStock st WITH(NOLOCK)
                 WHERE st.ItemCode = b.ItemCode AND st.ColorCode = b.ColorCode
                   AND st.ItemDim1Code = b.ItemDim1Code AND st.WarehouseCode = 'S02') AS StokS02
        FROM S
        {BARKOD_APPLY}
        ORDER BY S.Tip, S.SiraNo""")
    farkli = []
    for r in cur.fetchall():
        k = (s(r[0]), s(r[1]))
        st = f(r[3]); KAYIT[k]["StokS02"] = st
        if st is None or int(st) != int(r[2]):
            farkli.append(f"{k[0]}{KAYIT[k]['No']}:{r[2]}→{'-' if st is None else int(st)}")
    log(f"  rapor envanterinden farklı: {len(farkli)} / {len(KAYIT)}")
    if farkli:
        log("  (tip+sıra: rapor→şimdi) " + ", ".join(farkli))


@bolum("E) FİYAT LİSTESİ BAŞLIKLARI")
def e_fiyat_listesi(cur):
    cur.execute("SELECT IsTaxIncluded, PriceGroupCode, DocCurrencyCode, COUNT(*), "
                "MIN(PriceListDate), MAX(PriceListDate) FROM trPriceListHeader WITH(NOLOCK) "
                "GROUP BY IsTaxIncluded, PriceGroupCode, DocCurrencyCode")
    log("  KDV dahil? | fiyat grubu | döviz | liste sayısı | ilk | son")
    for r in cur.fetchall():
        log(f"   {s(r[0])} | {s(r[1])} | {s(r[2])} | {r[3]} | {s(r[4])[:10]} | {s(r[5])[:10]}")


@bolum("F) CARİ 32001001")
def f_cari(cur):
    kol = kolonlar(cur, "cdCurrAcc")
    sec = [k for k in kol if any(x in k for x in ("Code", "Name", "Desc", "Type", "IsBlocked"))][:12]
    cur.execute(f"SELECT TOP 1 {', '.join(sec)} FROM cdCurrAcc WITH(NOLOCK) WHERE CurrAccCode = '32001001'")
    r = cur.fetchone()
    log("  " + (" | ".join(f"{a}={s(v)}" for a, v in zip(sec, r)) if r else "(bulunamadı)"))
    if tablo_var(cur, "cdCurrAccDesc"):
        cur.execute("SELECT TOP 1 CurrAccDescription FROM cdCurrAccDesc WITH(NOLOCK) "
                    "WHERE CurrAccCode = '32001001'")
        r = cur.fetchone()
        log(f"  açıklama: {s(r[0]) if r else '(yok)'}")


@bolum("G) CSV")
def g_csv(cur):
    kolon = ["Tip", "No", "Barkod", "Adet", "RaporEnvanter", "StokS02", "MaliyetBP", "MaliyetBPNet",
             "MaliyetBPTarih", "MaliyetBPFis", "MaliyetBPEslesme",
             "Cost_trEndOfPeriodInventory", "Cost_trCostOfGoodsSoldLine"]

    def hucre(x):
        if x is None:
            return ""
        if isinstance(x, float):
            return f"{x:.4f}".rstrip("0").rstrip(".")
        return str(x).replace(";", ",")

    satirlar = [";".join(kolon)]
    for v in sorted(KAYIT.values(), key=lambda v: (v["Tip"], v["No"])):
        satirlar.append(";".join(hucre(v.get(c)) for c in kolon))
    try:
        with open("KESIF38-SONUC.csv", "w", encoding="utf-8-sig") as fh:
            fh.write("\n".join(satirlar))
        log("  KESIF38-SONUC.csv yazıldı.")
    except Exception as e:
        log(f"  CSV yazılamadı: {e}")
    log("\n--- CSV-BASLA ---")
    for sat in satirlar:
        log(sat)
    log("--- CSV-BITIR ---")


def main():
    cfg = load_config()
    log(">>> KEŞİF v38 — maliyet kaynağı arama (salt-okunur)")
    conn = connect(cfg)
    cur = conn.cursor()
    a_bp(cur)
    b_fiyatli_bp(cur)
    c_maliyet_modulu(cur)
    d_stok(cur)
    e_fiyat_listesi(cur)
    f_cari(cur)
    g_csv(cur)
    log("\n>>> KEŞİF v38 TAMAM. KESIF38-CIKTI.txt dosyasının TAMAMINI yapıştır.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log(traceback.format_exc())
    try:
        with open("KESIF38-CIKTI.txt", "w", encoding="utf-8") as fh:
            fh.write("\n".join(OUT))
        print("\n>>> KESIF38-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
