# -*- coding: utf-8 -*-
"""BARKOD-SORGU: verilen barkodlarin model / aciklama / renk / beden bilgisini
Nebim'den OKUR (yalniz SELECT; hicbir sey yazmaz, degistirmez) ve ayni klasore
BARKOD-SORGU-sonuc.csv olarak kaydeder. Kopru klasorunde (config.json'un yaninda)
calisir; baglanti ayarlarini satis_kopru.py'den alir.
"""
import csv, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import satis_kopru as k

BARKODLAR = ["8684868009560", "8684868019552", "8684868019569", "8684868019576", "8684868019590", "8684868022217", "8684868022224", "8684868022231", "8684868022248", "8684868022255", "8684868022972", "8684868022996", "8684868023047", "8684868023078", "8684868023351", "8684868023368", "8684868026789", "8684868026819", "8684868026826", "8684868027328", "8684868027335", "8684868027359", "8684868027366", "8684868029674", "8684868029681", "8684868032025", "8684868032032", "8684868034883", "8684868034951", "8684868037822", "8684868037839", "8684868037860", "8684868037945", "8684868037952", "8684868037990", "8684868038003", "8684868038010", "8684868038027", "8684868038034", "8684868038041", "8684868038058", "8684868038157", "8684868038713", "8684868038720", "8684868042642", "8684868042659", "8684868042666", "8684868042673", "8684868042680", "8684868046336", "8684868046343", "8684868046350", "8684868046374", "8684868048002", "8684868048026", "8684868055949", "8684868055970", "8684868060981", "8684868060998", "8684868061001", "8684868061018", "8684868061186", "8684868061209", "8684868061223", "8684868070652", "8684868070676", "8684868070690", "8684868070706", "8684868071178", "8684868071185", "8684868074896", "8684868074902", "8684868074933", "8684868076142", "8684868076180", "8684868076210", "8684868076234", "8684868077767", "8684868077774", "8684868077781", "8684868077804", "8684868085144", "8684868085175", "8684868085205", "8684868085731", "8684868085748", "8684868088879", "8684868088909", "8684868088923", "8684868099660", "8684868099684", "8684868099714", "8684868099905", "8684868099943", "8684868103565", "8684868103572", "8684868103589", "8684868103619", "8684868103626", "8684868105736", "8684868105743", "8684868110341", "8684868110419", "8684868110440", "8684868124263", "8684868124270", "8684868124294", "8684868124324", "8684868124348", "8684868124355", "8684868124362", "8684868135900", "8684868135917", "8684868135924", "8684868135931", "8684868135948", "8684868145282", "8684868145299", "8684868145305", "8684868145312", "8684868145329", "8684868148092", "8684868148108", "8684868148115", "8684868148122", "8684868148139"]

def oku_ek_liste():
    """Klasorde barkodlar.txt varsa (satir basina bir barkod) onu da ekle."""
    yol = os.path.join(HERE, "barkodlar.txt")
    ek = []
    if os.path.exists(yol):
        for satir in open(yol, encoding="utf-8", errors="ignore"):
            b = satir.strip().split(",")[0].split(";")[0].strip()
            if b.isdigit() and 8 <= len(b) <= 14:
                ek.append(b)
    return ek

SQL_TAM = """
SELECT b.Barcode, b.ItemCode, id.ItemDescription, b.ColorCode, cd.ColorDescription, b.ItemDim1Code
FROM prItemBarcode b
LEFT JOIN cdItemDesc id ON id.ItemTypeCode = b.ItemTypeCode AND id.ItemCode = b.ItemCode AND id.LangCode = 'TR'
LEFT JOIN cdColorDesc cd ON cd.ColorCode = b.ColorCode AND cd.LangCode = 'TR'
WHERE b.Barcode IN (%s)
"""
SQL_YEDEK = """
SELECT b.Barcode, b.ItemCode, id.ItemDescription, b.ColorCode, NULL, b.ItemDim1Code
FROM prItemBarcode b
LEFT JOIN cdItemDesc id ON id.ItemCode = b.ItemCode AND id.LangCode = 'TR'
WHERE b.Barcode IN (%s)
"""

def main():
    barkodlar = sorted(set(BARKODLAR + oku_ek_liste()))
    print("Sorgulanacak barkod:", len(barkodlar))
    conn = k.connect(k.load_config(None))
    bulunan = {}
    try:
        cur = conn.cursor()
        for i in range(0, len(barkodlar), 200):
            parca = barkodlar[i:i + 200]
            yer = ",".join("?" * len(parca))
            try:
                cur.execute(SQL_TAM % yer, parca)
            except Exception as e:  # kolon adi farkliysa sade sorgu
                print("Tam sorgu olmadi (%s) - sade sorguya geciliyor." % e)
                cur.execute(SQL_YEDEK % yer, parca)
            for r in cur.fetchall():
                bulunan.setdefault(str(r[0]).strip(), [("" if v is None else str(v).strip()) for v in r])
    finally:
        conn.close()
    cikti = os.path.join(HERE, "BARKOD-SORGU-sonuc.csv")
    with open(cikti, "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.writer(fh, delimiter=";")
        w.writerow(["Barkod", "Model Kodu", "Aciklama", "Renk Kodu", "Renk", "Beden"])
        for b in barkodlar:
            w.writerow(bulunan.get(b, [b, "NEBIMDE YOK", "", "", "", ""]))
    print("Bulunan: %d / %d" % (len(bulunan), len(barkodlar)))
    print("Kaydedildi:", cikti)

if __name__ == "__main__":
    main()
