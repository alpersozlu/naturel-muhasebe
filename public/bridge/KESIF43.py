# -*- coding: utf-8 -*-
"""NEBIM KEŞİF v43 — KAMPANYA TANIM EKRANI NEREDE (salt-okunur).

Menüde tıklayarak aramak yerine DB'ye soruyoruz:
A) MERT, UNI2054'ü kurduğu dakikalarda (2026-07-21 10:00-11:30) hangi
   ekranları açtı? (auProgramUseTrace)
B) 'Kampanya' / 'DiscountOffer' geçen TÜM ekran açılışları — kim, hangi
   uygulama, hangi menü yolu
C) Sistemdeki Nebim uygulamaları (ApplicationName) — tanım ekranı ERP dışında
   bir programda olabilir
D) Menü/program tablolarında 'Kampanya' geçen kayıtlar (menü yolu + program kodu)
E) Kullanıcı-program yetki tabloları listesi
Cikti: KESIF43-CIKTI.txt
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
                return f(*a, **kw)
            except Exception as e:
                log(f"  HATA: {type(e).__name__}: {str(e)[:220]}")
        return sarili
    return dekore


def k(v, n=40):
    return (str(v).strip() if v is not None else "-")[:n]


@bolum("A) MERT'İN 21 TEMMUZ 10:00-11:30 ARASI AÇTIĞI EKRANLAR")
def a_mert(cur):
    cur.execute("""
        SELECT StartDate, ApplicationName,
               CAST(MenuName AS nvarchar(80)), CAST(SubMenuName AS nvarchar(80)),
               CAST(ProgramName AS nvarchar(80)), FormName, FormCaption
        FROM auProgramUseTrace WITH(NOLOCK)
        WHERE UserName = N'MERT'
          AND StartDate BETWEEN '2026-07-21 10:00' AND '2026-07-21 11:30'
        ORDER BY StartDate
        """)
    r = cur.fetchall()
    log(f"  {len(r)} kayıt  (saat | uygulama | menü > alt menü | program | form | başlık)")
    for x in r[:40]:
        log(f"  {str(x[0])[11:19]} | {k(x[1],6)} | {k(x[2],30)} > {k(x[3],30)} "
            f"| {k(x[4],34)} | {k(x[5],30)} | {k(x[6],30)}")


@bolum("B) 'KAMPANYA' GEÇEN TÜM EKRAN AÇILIŞLARI (kim, nerede)")
def b_kampanya(cur):
    cur.execute("""
        SELECT TOP 40 UserName, ApplicationName,
               CAST(MenuName AS nvarchar(60)) AS Menu,
               CAST(SubMenuName AS nvarchar(60)) AS SubMenu,
               CAST(ProgramName AS nvarchar(60)) AS Prog,
               FormName, FormCaption, MAX(StartDate) AS son, COUNT(*) AS adet
        FROM auProgramUseTrace WITH(NOLOCK)
        WHERE FormCaption LIKE N'%ampanya%' OR FormName LIKE N'%DiscountOffer%'
           OR CAST(ProgramName AS nvarchar(200)) LIKE N'%DiscountOffer%'
           OR CAST(ProgramName AS nvarchar(200)) LIKE N'%ampanya%'
           OR CAST(SubMenuName AS nvarchar(200)) LIKE N'%ampanya%'
        GROUP BY UserName, ApplicationName, CAST(MenuName AS nvarchar(60)),
                 CAST(SubMenuName AS nvarchar(60)),
                 CAST(ProgramName AS nvarchar(60)), FormName, FormCaption
        ORDER BY son DESC
        """)
    r = cur.fetchall()
    log(f"  {len(r)} farklı ekran/kullanıcı")
    for x in r:
        log(f"  {k(x[0],6)} | {k(x[1],6)} | {k(x[2],26)} > {k(x[3],26)} "
            f"| {k(x[4],30)} | {k(x[5],28)} | {k(x[6],28)} | {str(x[7])[:10]} x{x[8]}")


@bolum("C) SİSTEMDEKİ NEBİM UYGULAMALARI")
def c_uygulama(cur):
    cur.execute("""
        SELECT ApplicationName, COUNT(*), MAX(StartDate),
               COUNT(DISTINCT UserName)
        FROM auProgramUseTrace WITH(NOLOCK)
        GROUP BY ApplicationName ORDER BY COUNT(*) DESC
        """)
    for x in cur.fetchall():
        log(f"  {k(x[0],8):8} | {x[1]:>8} açılış | son {str(x[2])[:10]} "
            f"| {x[3]} kullanıcı")


@bolum("D) MENÜ / PROGRAM TABLOLARINDA 'KAMPANYA'")
def d_menu(cur):
    cur.execute("""
        SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
        WHERE (TABLE_NAME LIKE '%Menu%' OR TABLE_NAME LIKE '%Program%')
          AND TABLE_NAME <> 'auProgramUseTrace' AND TABLE_TYPE = 'BASE TABLE'
        ORDER BY TABLE_NAME
        """)
    tablolar = [r[0] for r in cur.fetchall()]
    log(f"  tablolar: {tablolar[:30]}")
    for t in tablolar[:25]:
        cur.execute("""
            SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = ? AND DATA_TYPE IN ('nvarchar','varchar','nchar','char')
            """, t)
        kols = [r[0] for r in cur.fetchall()]
        if not kols:
            continue
        kosul = " OR ".join(f"[{c}] LIKE N'%ampanya%' OR [{c}] LIKE N'%DiscountOffer%'"
                            for c in kols[:25])
        try:
            cur.execute(f"SELECT TOP 8 * FROM [{t}] WITH(NOLOCK) WHERE {kosul}")
            adlar = [d[0] for d in cur.description]
            satir = cur.fetchall()
            if not satir:
                continue
            log(f"  --- {t} ({len(satir)} eşleşme) kolonlar: {adlar[:10]}")
            for s in satir:
                log("     · " + " | ".join(k(v, 28) for v in s[:10]))
        except Exception as e:
            log(f"  --- {t}: HATA {str(e)[:80]}")


@bolum("E) KULLANICI-PROGRAM YETKİ TABLOLARI")
def e_yetki(cur):
    cur.execute("""
        SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_NAME LIKE 'au%' AND TABLE_TYPE = 'BASE TABLE'
        ORDER BY TABLE_NAME
        """)
    au = [r[0] for r in cur.fetchall()]
    log(f"  au* tabloları ({len(au)}): {au[:40]}")


def main():
    cfg = load_config()
    log(">>> KEŞİF v43 — kampanya tanım ekranı nerede (salt-okunur)")
    conn = connect(cfg)
    cur = conn.cursor()
    a_mert(cur)
    b_kampanya(cur)
    c_uygulama(cur)
    d_menu(cur)
    e_yetki(cur)
    log("\n>>> KEŞİF v43 TAMAM. Çıktının TAMAMINI yapıştır.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log(traceback.format_exc())
    try:
        with open("KESIF43-CIKTI.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(OUT))
        print("\n>>> KESIF43-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
