"""NEBIM KEŞİF v22 — MOTOR PROSEDÜRLERİNİN TAM METNİ (salt-okunur).

A) dbo.DiscountOffer + dbo.DiscountVoucherType + dbo.DiscountVouchers
   (tablo-değerli fonksiyonlar, TAM)
B) qry_GetActiveDiscountOffers (TAM)
C) qry_GS_GetActiveDiscountOffers (TAM)
D) sp_ActivatedDiscountOffers (ilk 6000)
Cikti: KESIF22-CIKTI.txt  (uzun olacak — TAMAMINI yapıştır)
"""
from __future__ import annotations

import traceback
from satis_kopru import load_config, connect

OUT = []


def log(*a):
    s = " ".join(str(x) for x in a)
    print(s)
    OUT.append(s)


def tanim(cur, ad, limit=None):
    cur.execute("SELECT m.definition FROM sys.sql_modules m "
                "WHERE OBJECT_NAME(m.object_id) = ?", ad)
    r = cur.fetchone()
    if not r:
        log(f"\n##### {ad}: BULUNAMADI #####")
        return
    t = r[0]
    log(f"\n##### {ad} ({len(t)} karakter{' — ilk ' + str(limit) if limit else ', TAM'}) #####")
    log(t[:limit] if limit else t)


def main():
    cfg = load_config()
    log(">>> NEBIM KEŞİF v22 — MOTOR PROSEDÜRLERİ (salt-okunur)")
    conn = connect(cfg)
    cur = conn.cursor()
    try:
        tanim(cur, "DiscountOffer")
        tanim(cur, "DiscountVoucherType")
        tanim(cur, "DiscountVouchers")
        tanim(cur, "qry_GetActiveDiscountOffers")
        tanim(cur, "qry_GS_GetActiveDiscountOffers")
        tanim(cur, "sp_ActivatedDiscountOffers", limit=6000)
    except Exception:
        log(traceback.format_exc())
    log("\n>>> KEŞİF v22 TAMAM. Çıktının TAMAMINI yapıştır (uzun, bölebilirsin).")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log(traceback.format_exc())
    try:
        with open("KESIF22-CIKTI.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(OUT))
        print("\n>>> KESIF22-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
