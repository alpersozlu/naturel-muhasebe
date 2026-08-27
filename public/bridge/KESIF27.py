"""NEBIM KEŞİF v27 — ÜRÜN TEŞHİSİ + GARANTİLİ TEST ÜRÜNLERİ (salt-okunur).

A) Denenen 3 ürün neden HCGECERLI dışında? (filtre filtre)
B) Kapsam: son satılan 200 ürünün yüzde kaçı listede?
C) Lefkoşa'da STOKTA olan, listede GEÇERLİ 5 ürün + RAF BARKODLARI
Cikti: KESIF27-CIKTI.txt
"""
from __future__ import annotations

import traceback
from satis_kopru import load_config, connect

OUT = []
URUNLER = ["26SAFD511010", "26PFD510410", "26SFT442814"]
AKSESUAR = ["ÇORAP", "CORAP", "CÜZDAN", "CUZDAN", "KEMER", "KARTLIK",
            "DERİ BAKIM", "SPREY", "SÜNGER", "SUNGER", "FIRÇA",
            "AYAKKABI DEODORANT"]


def log(*a):
    s = " ".join(str(x) for x in a)
    print(s)
    OUT.append(s)


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


@bolum("A) DENENEN ÜRÜNLERİN FİLTRE TEŞHİSİ")
def a_teshis(cur):
    aks = ",".join(f"N'{a}'" for a in AKSESUAR)
    for u in URUNLER:
        log(f"\n-- {u}:")
        cur.execute("SELECT ItemTypeCode, IsBlocked, UsePOS FROM cdItem "
                    "WHERE ItemCode = ?", u)
        r = cur.fetchone()
        if not r:
            log("   cdItem'da YOK!")
            continue
        log(f"   cdItem: tip={r[0]} bloke={r[1]} UsePOS={r[2]}")
        cur.execute("SELECT COUNT(*) FROM prItemListContent "
                    "WHERE ItemListCode=N'HCGECERLI' AND ItemCode=?", u)
        log(f"   HCGECERLI'de: {'EVET' if cur.fetchone()[0] else 'HAYIR'}")
        cur.execute(f"SELECT AttributeCode FROM prItemAttribute "
                    f"WHERE ItemCode=? AND AttributeTypeCode=18", u)
        altgrup = [str(x[0]).strip() for x in cur.fetchall()]
        log(f"   Alt Grup(18): {altgrup} "
            f"{'<< AKSESUAR FİLTRESİNE TAKILDI' if any(a in AKSESUAR for a in altgrup) else ''}")
        cur.execute("SELECT ItemListCode FROM prItemListContent "
                    "WHERE ItemCode=? AND ItemListCode IN (N'TSF1499',N'TSF70')", u)
        tsf = [str(x[0]).strip() for x in cur.fetchall()]
        log(f"   TSF listelerinde: {tsf or 'hayır'}")
        cur.execute("SELECT TOP 1 ItemDescription FROM cdItemDesc WHERE ItemCode=?", u)
        r2 = cur.fetchone()
        log(f"   ad: {r2[0] if r2 else '-'}")


@bolum("B) KAPSAM — SON SATILAN 200 ÜRÜN")
def b_kapsam(cur):
    cur.execute("""
        SELECT toplam = COUNT(*), listede = SUM(CASE WHEN e.ItemCode IS NOT
               NULL THEN 1 ELSE 0 END)
        FROM (SELECT DISTINCT TOP 200 l.ItemCode
              FROM trInvoiceLine l WITH(NOLOCK)
              ORDER BY l.ItemCode DESC) son
        LEFT JOIN (SELECT ItemCode FROM prItemListContent WITH(NOLOCK)
                   WHERE ItemListCode = N'HCGECERLI') e
          ON e.ItemCode = son.ItemCode
        """)
    r = cur.fetchone()
    log(f"  son 200 farklı üründen listede olan: {r[1]}/{r[0]}")


@bolum("C) GARANTİLİ TEST ÜRÜNLERİ (Lefkoşa stok + listede + barkod)")
def c_garantili(cur):
    cur.execute("""
        SELECT TOP 5 e.ItemCode, MAX(d.ItemDescription),
               MAX(b.Barcode), SUM(s.Qty1)
        FROM prItemListContent e WITH(NOLOCK)
        JOIN trStock s WITH(NOLOCK)
          ON s.ItemCode = e.ItemCode AND s.ItemTypeCode = 1
          AND s.WarehouseCode = N'S01'
        JOIN prItemBarcode b WITH(NOLOCK)
          ON b.ItemCode = e.ItemCode
        LEFT JOIN cdItemDesc d WITH(NOLOCK) ON d.ItemCode = e.ItemCode
        WHERE e.ItemListCode = N'HCGECERLI'
        GROUP BY e.ItemCode
        HAVING SUM(s.Qty1) > 0
        ORDER BY SUM(s.Qty1) DESC
        """)
    rows = cur.fetchall()
    if not rows:
        log("  (trStock üzerinden bulunamadı — barkodlu 5 liste ürünü:)")
        cur.execute("""
            SELECT TOP 5 e.ItemCode, MAX(d.ItemDescription), MAX(b.Barcode)
            FROM prItemListContent e WITH(NOLOCK)
            JOIN prItemBarcode b WITH(NOLOCK) ON b.ItemCode = e.ItemCode
            LEFT JOIN cdItemDesc d WITH(NOLOCK) ON d.ItemCode = e.ItemCode
            WHERE e.ItemListCode = N'HCGECERLI'
              AND e.ItemCode LIKE N'26%'
            GROUP BY e.ItemCode
            """)
        rows = [(r[0], r[1], r[2], "?") for r in cur.fetchall()]
    log("  ÜRÜN KODU | AD | RAF BARKODU | stok")
    for r in rows:
        log(f"  {str(r[0]).strip()} | {str(r[1])[:34]} | {str(r[2]).strip()} | {r[3]}")


def main():
    cfg = load_config()
    log(">>> KEŞİF v27 — ürün teşhisi + garantili test ürünleri (salt-okunur)")
    conn = connect(cfg)
    cur = conn.cursor()
    a_teshis(cur)
    b_kapsam(cur)
    c_garantili(cur)
    log("\n>>> KEŞİF v27 TAMAM. Çıktının TAMAMINI yapıştır.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log(traceback.format_exc())
    try:
        with open("KESIF27-CIKTI.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(OUT))
        print("\n>>> KESIF27-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
