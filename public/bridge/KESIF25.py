"""NEBIM KEŞİF v25 — KAMPANYA DETAY SORGUSU + AKTİVASYON KAYNAĞI (salt-okunur).

A) Plan önbelleği: cdDiscountOffer'a dokunan SON sorgular (POS açılışının
   kampanya-detay yüklemesi — çek tipi listesinin kaynağı)
B) sp_ActivatedDiscountOffers_Location TAM METİN (location kayıtlarının
   üretim kaynağı — resmi zinciri güvenle çalıştırmak için)
C) sp_ActivatedDiscountOffers_Product + _Customer (ilk 4000'er)
Cikti: KESIF25-CIKTI.txt
"""
from __future__ import annotations

import traceback
from satis_kopru import load_config, connect

OUT = []


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


@bolum("A) PLAN ÖNBELLEĞİ — cdDiscountOffer SORGULARI")
def a_cache(cur):
    cur.execute("""
        SELECT TOP 10
              qs.last_execution_time
            , qs.execution_count
            , SUBSTRING(st.text, 1, 4000)
        FROM sys.dm_exec_query_stats qs
        CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) st
        WHERE st.text LIKE '%cdDiscountOffer%'
          AND st.text NOT LIKE '%dm_exec_query_stats%'
          AND st.text NOT LIKE 'CREATE PROCEDURE qry_G%'
        ORDER BY qs.last_execution_time DESC
        """)
    rows = cur.fetchall()
    log(f"bulunan: {len(rows)}")
    for i, r in enumerate(rows, 1):
        log(f"\n--- sorgu {i} | son: {r[0]} | kez: {r[1]} ---")
        log(str(r[2]))


def tanim(cur, ad, limit=None):
    cur.execute("SELECT m.definition FROM sys.sql_modules m "
                "WHERE OBJECT_NAME(m.object_id) = ?", ad)
    r = cur.fetchone()
    if not r:
        log(f"\n##### {ad}: BULUNAMADI #####")
        return
    t = r[0]
    log(f"\n##### {ad} ({len(t)} kr{' — ilk ' + str(limit) if limit else ', TAM'}) #####")
    log(t[:limit] if limit else t)


@bolum("B) AKTİVASYON KAYNAKLARI")
def b_aktivasyon(cur):
    tanim(cur, "sp_ActivatedDiscountOffers_Location")
    tanim(cur, "sp_ActivatedDiscountOffers_Product", limit=4000)
    tanim(cur, "sp_ActivatedDiscountOffers_Customer", limit=4000)


def main():
    cfg = load_config()
    log(">>> NEBIM KEŞİF v25 — KAMPANYA DETAY SORGUSU + AKTİVASYON (salt-okunur)")
    conn = connect(cfg)
    cur = conn.cursor()
    a_cache(cur)
    b_aktivasyon(cur)
    log("\n>>> KEŞİF v25 TAMAM. Çıktının TAMAMINI yapıştır.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log(traceback.format_exc())
    try:
        with open("KESIF25-CIKTI.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(OUT))
        print("\n>>> KESIF25-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
