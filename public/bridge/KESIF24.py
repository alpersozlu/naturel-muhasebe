"""NEBIM KEŞİF v24 — POS'UN GERÇEK SORGUSU (plan önbelleği, salt-okunur).

A) SQL Server plan önbelleğinde 'DiscountVoucher' geçen son sorgular
   (POS çek penceresinin çalıştırdığı gerçek metinler)
B) dt% tabloları var mı (çevrimdışı POS senkron altyapısı kullanılıyor mu?)
Cikti: KESIF24-CIKTI.txt
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


@bolum("A) PLAN ÖNBELLEĞİ — 'DiscountVoucher' GEÇEN SON SORGULAR")
def a_cache(cur):
    cur.execute("""
        SELECT TOP 12
              qs.last_execution_time
            , qs.execution_count
            , SUBSTRING(st.text, 1, 4000) AS sorgu
        FROM sys.dm_exec_query_stats qs
        CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) st
        WHERE st.text LIKE '%DiscountVoucher%'
          AND st.text NOT LIKE '%dm_exec_query_stats%'
        ORDER BY qs.last_execution_time DESC
        """)
    rows = cur.fetchall()
    log(f"bulunan: {len(rows)}")
    for i, r in enumerate(rows, 1):
        log(f"\n--- sorgu {i} | son çalışma: {r[0]} | kez: {r[1]} ---")
        log(str(r[2]))


@bolum("B) dt% TABLOLARI (çevrimdışı POS altyapısı)")
def b_dt(cur):
    cur.execute(
        "SELECT t.name, SUM(p.rows) FROM sys.tables t "
        "JOIN sys.partitions p ON p.object_id = t.object_id "
        "     AND p.index_id IN (0,1) "
        "WHERE t.name LIKE 'dt%' GROUP BY t.name ORDER BY t.name")
    rows = cur.fetchall()
    if not rows:
        log("  dt% tablosu YOK — POS merkeze çevrimiçi çalışıyor demektir.")
    for t, n in rows:
        log(f"  {t} | {n}")


def main():
    cfg = load_config()
    log(">>> NEBIM KEŞİF v24 — POS'UN GERÇEK SORGUSU (salt-okunur)")
    conn = connect(cfg)
    cur = conn.cursor()
    a_cache(cur)
    b_dt(cur)
    log("\n>>> KEŞİF v24 TAMAM. Çıktının TAMAMINI yapıştır.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log(traceback.format_exc())
    try:
        with open("KESIF24-CIKTI.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(OUT))
        print("\n>>> KESIF24-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
