"""NEBIM KEŞİF v16 — KISIT KATMANI HAZIRLIĞI (salt-okunur).

Outlet / aksesuar / %60-70 kısıtlarını kurmak için gereken haritalar:
A) Ürün listeleri: cdItemList tam liste + prItemListContent yapısı + örnek
B) Alt Grup (özellik 18) değer dağılımı — aksesuar grupları
C) Line (özellik 17) + Kategori (19) + Kampanya (13) değer dağılımları
D) BLİNK ürünleri (isimden)
E) 56 kampanyanın tam listesi (kod + ad + aktiflik) — %60-70 tespiti
HİÇBİR YAZMA YAPMAZ. Cikti: KESIF16-CIKTI.txt
"""
from __future__ import annotations

import traceback
from satis_kopru import load_config, connect

OUT = []


def log(*a):
    s = " ".join(str(x) for x in a)
    print(s)
    OUT.append(s)


def kisalt(v, n=50):
    s = "-" if v is None else str(v)
    s = s.replace("\r", " ").replace("\n", " ").strip()
    return (s[: n - 1] + "…") if len(s) > n else s


def bolum(ad):
    def dekore(f):
        def sarili(*a, **kw):
            log(f"\n=== {ad} ===")
            try:
                f(*a, **kw)
            except Exception:
                log("BÖLÜM HATASI:\n" + traceback.format_exc())
        return sarili
    return dekore


@bolum("A) ÜRÜN LİSTELERİ")
def a_listeler(cur):
    cur.execute(
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS "
        "WHERE TABLE_NAME = 'cdItemList' ORDER BY ORDINAL_POSITION")
    log("-- cdItemList kolonları: " + ", ".join(r[0] for r in cur.fetchall()))
    cur.execute(
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS "
        "WHERE TABLE_NAME = 'prItemListContent' ORDER BY ORDINAL_POSITION")
    log("-- prItemListContent kolonları: " + ", ".join(r[0] for r in cur.fetchall()))
    cur.execute(
        "SELECT il.ItemListCode, d.ItemListDescription, "
        "       (SELECT COUNT(*) FROM prItemListContent c "
        "        WHERE c.ItemListCode = il.ItemListCode) AS adet "
        "FROM cdItemList il "
        "LEFT JOIN cdItemListDesc d ON d.ItemListCode = il.ItemListCode "
        "     AND d.LangCode = 'TR' "
        "ORDER BY il.ItemListCode")
    log("-- Tüm listeler (kod | açıklama | içerik satırı):")
    for r in cur.fetchall():
        log(f"  {kisalt(r[0], 20)} | {kisalt(r[1], 40)} | {r[2]}")
    cur.execute("SELECT TOP 3 * FROM prItemListContent "
                "WHERE ItemListCode = N'2.%50HAZ'")
    adlar = [d[0] for d in cur.description]
    log("-- '2.%50HAZ' içerik örneği: " + " | ".join(adlar))
    for r in cur.fetchall():
        log("   " + " | ".join(kisalt(v, 22) for v in r))


def _dagilim(cur, tip_kodu, etiket):
    cur.execute(
        "SELECT pa.AttributeCode, MAX(ad.AttributeDescription), COUNT(*) "
        "FROM prItemAttribute pa "
        "LEFT JOIN cdItemAttributeDesc ad "
        "  ON ad.AttributeTypeCode = pa.AttributeTypeCode "
        " AND ad.AttributeCode = pa.AttributeCode AND ad.LangCode = 'TR' "
        "WHERE pa.AttributeTypeCode = ? "
        "GROUP BY pa.AttributeCode ORDER BY COUNT(*) DESC", tip_kodu)
    log(f"-- {etiket} (kod | ad | ürün sayısı):")
    for r in cur.fetchall():
        log(f"  {kisalt(r[0], 14)} | {kisalt(r[1], 34)} | {r[2]}")


@bolum("B) ALT GRUP DAĞILIMI (özellik 18)")
def b_altgrup(cur):
    _dagilim(cur, 18, "Alt Grup")


@bolum("C) LINE / KATEGORİ / KAMPANYA DAĞILIMLARI")
def c_diger(cur):
    _dagilim(cur, 17, "Line (17)")
    _dagilim(cur, 19, "Kategori (19)")
    _dagilim(cur, 13, "Kampanya özelliği (13)")


@bolum("D) BLİNK ÜRÜNLERİ (isimden)")
def d_blink(cur):
    cur.execute(
        "SELECT TOP 10 ItemCode, ItemDescription FROM cdItemDesc "
        "WHERE ItemDescription LIKE N'%BLİNK%' OR ItemDescription LIKE '%BLINK%'")
    for r in cur.fetchall():
        log(f"  {r[0]} | {kisalt(r[1], 50)}")


@bolum("E) 56 KAMPANYA — KOD + AD + AKTİF")
def e_kampanyalar(cur):
    cur.execute(
        "SELECT o.DiscountOfferCode, d.DiscountOfferDescription, o.IsActive, "
        "       o.IsBlocked, o.CreatedDate "
        "FROM cdDiscountOffer o "
        "LEFT JOIN cdDiscountOfferDesc d "
        "  ON d.DiscountOfferCode = o.DiscountOfferCode "
        "ORDER BY o.CreatedDate DESC")
    for r in cur.fetchall():
        durum = "AKTİF" if r[2] else ("BLOKE" if r[3] else "pasif")
        log(f"  {kisalt(r[0], 12)} | {kisalt(r[1], 52)} | {durum} | {str(r[4])[:10]}")


def main():
    cfg = load_config()
    log(">>> NEBIM KEŞİF v16 — KISIT KATMANI HAZIRLIĞI (salt-okunur)")
    conn = connect(cfg)
    cur = conn.cursor()
    a_listeler(cur)
    b_altgrup(cur)
    c_diger(cur)
    d_blink(cur)
    e_kampanyalar(cur)
    log("\n>>> KEŞİF v16 TAMAM. Çıktının TAMAMINI yapıştır.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log(traceback.format_exc())
    try:
        with open("KESIF16-CIKTI.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(OUT))
        print("\n>>> KESIF16-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
