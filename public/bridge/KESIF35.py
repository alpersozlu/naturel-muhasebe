# -*- coding: utf-8 -*-
"""NEBIM KEŞİF v35 — POS'UN ÇEK SORGUSU NEREDE (salt-okunur).

IZLE2 kanıtladı: POS çek sorgusunu bsQueryCustom/bsQuery tablosundan
METİN olarak okuyor (QueryName='DiscountVoucher'), sonra çalıştırıyor.

A) bsQueryCustom'da 'DiscountVoucher' var mı + tablodaki tüm özel sorgular
B) bsQuery'deki 'DiscountVoucher' sorgusunun TAM METNİ  <<< ASIL HEDEF
C) sp_ValidateDiscountVoucherCustomer tam metni
D) bsQuery / bsQueryCustom kolon yapısı (özel satır yazabilmek için)
Cikti: KESIF35-CIKTI.txt
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
                log(f"  HATA: {type(e).__name__}: {str(e)[:200]}")
        return sarili
    return dekore


def metin_dok(t, on="  "):
    for s in (t or "").replace("\r", "").split("\n"):
        s = s.rstrip()
        if s.strip():
            log(on + s[:150])


@bolum("A) bsQueryCustom — ÖZEL SORGU TABLOSU")
def a_custom(cur):
    cur.execute("SELECT COUNT(*) FROM bsQueryCustom WITH(NOLOCK)")
    log(f"  toplam özel sorgu satırı: {cur.fetchone()[0]}")
    cur.execute("SELECT QueryName FROM bsQueryCustom WITH(NOLOCK) "
                "ORDER BY QueryName")
    adlar = [str(r[0]).strip() for r in cur.fetchall()]
    log(f"  mevcut özel sorgular: {adlar[:25]}")
    cur.execute("SELECT QueryText FROM bsQueryCustom WITH(NOLOCK) "
                "WHERE QueryName = N'DiscountVoucher'")
    r = cur.fetchone()
    if r:
        log("  >>> 'DiscountVoucher' ÖZEL SORGUSU ZATEN VAR:")
        metin_dok(r[0], "     ")
    else:
        log("  >>> 'DiscountVoucher' için özel sorgu YOK "
            "(yani POS standart bsQuery'yi kullanıyor)")


@bolum("B) bsQuery — 'DiscountVoucher' TAM METNİ")
def b_standart(cur):
    cur.execute("SELECT QueryText, KeyCodes FROM bsQuery WITH(NOLOCK) "
                "WHERE QueryName = N'DiscountVoucher'")
    r = cur.fetchone()
    if not r:
        log("  !!! bsQuery'de 'DiscountVoucher' YOK !!!")
        return
    log(f"  KeyCodes: {str(r[1]).strip()}")
    log("  --- QueryText ---")
    metin_dok(r[0])


@bolum("C) sp_ValidateDiscountVoucherCustomer")
def c_validate(cur):
    cur.execute("SELECT OBJECT_DEFINITION("
                "OBJECT_ID('sp_ValidateDiscountVoucherCustomer'))")
    r = cur.fetchone()
    metin_dok((r[0] if r else "") or "(bulunamadı)")


@bolum("D) TABLO YAPILARI")
def d_yapi(cur):
    for t in ("bsQuery", "bsQueryCustom"):
        cur.execute("""
            SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH,
                   IS_NULLABLE
            FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = ?
            ORDER BY ORDINAL_POSITION
            """, t)
        k = [f"{r[0]}:{r[1]}({r[2]}){'' if r[3] == 'YES' else ' NOTNULL'}"
             for r in cur.fetchall()]
        log(f"  {t}: {k}")


def main():
    cfg = load_config()
    log(">>> KEŞİF v35 — POS'un çek sorgusunun kaynağı (salt-okunur)")
    conn = connect(cfg)
    cur = conn.cursor()
    a_custom(cur)
    b_standart(cur)
    c_validate(cur)
    d_yapi(cur)
    log("\n>>> KEŞİF v35 TAMAM. Çıktının TAMAMINI yapıştır.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log(traceback.format_exc())
    try:
        with open("KESIF35-CIKTI.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(OUT))
        print("\n>>> KESIF35-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
