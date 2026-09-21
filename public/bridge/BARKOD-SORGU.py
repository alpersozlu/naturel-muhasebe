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

BARKODLAR = ["5471701855209", "5471701855230", "5471701928798", "5471701992935", "5471701993123", "5471701993130", "5471701993178", "5471701993697", "5471701993703", "5471701993727", "5471701993734", "5471701996711", "5471701996766", "5471701996971", "5471701997176", "5471701999224", "5471701999231", "5471701999255", "5471702004002", "5471702004057", "5471702015459", "5471702015466", "5471702015473", "8683691011726", "8683691033537", "8683691033544", "8683691033551", "8683691033568", "8683691033575", "8683691033582", "8683691033599", "8683691033605", "8683691033612", "8683691033629", "8683691034701", "8683691034718", "8683691061974", "8683691074301", "8683691074332", "8683691074363", "8683691077364", "8683691077371", "8683691077388", "8683691077395", "8683691077401", "8683691077449", "8683691077470", "8683691077494", "8683691116377", "8683691201943", "8683691201950", "8683691215193", "8683691215209", "8683691215247", "8683691253041", "8683691253065", "8683691253089", "8683691253096", "8683691261459", "8683691261497", "8683691261503", "8683691276781", "8683691276828", "8683691292415", "8683691292439", "8683691292453", "8683691292606", "8683691292637", "8683691292712", "8683691292750", "8683691345395", "8683691375804", "8683691375811", "8683691376399", "8683691376405", "8683691380259", "8683691383007", "8683691383045", "8683691383052", "8683691383366", "8683691384363", "8683691384387", "8683691384400", "8683691384417", "8683691387333", "8683691387463", "8683691387494", "8683691387500", "8683691397035", "8683691397059", "8683691397271", "8683691397318", "8683691407093", "8683691410123", "8683691420818", "8683691420856", "8683691424137", "8683691424175", "8683691424595", "8683691424878", "8683691424885", "8683691436109", "8683691436130", "8683691436208", "8683691436246", "8683691436253", "8683691436321", "8683691436338", "8683691436345", "8683691436369", "8683691436376", "8683691436383", "8683691436390", "8683691436406", "8683691436413", "8683691437427", "8684868028752"]

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
