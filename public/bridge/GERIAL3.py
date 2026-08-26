# -*- coding: utf-8 -*-
"""NEBIM GERİ-AL-3 — YÜKLE-3'ün eklediklerini siler (YAZAR!).

'HCKMP' kampanyası + 'HCGECERLI' listesi silinir.
GÜVENLİK: kampanya gerçek fişlerde kullanılmışsa (tpInvoiceDiscountOffer)
DURUR. Cikti: GERIAL3-CIKTI.txt
"""
from __future__ import annotations

import traceback
from satis_kopru import load_config, connect

OUT = []
KMP = "HCKMP"
LISTE = "HCGECERLI"


def log(*a):
    s = " ".join(str(x) for x in a)
    print(s)
    OUT.append(s)


def main():
    cfg = load_config()
    log(">>> GERİ-AL-3 — HCKMP kampanyası + HCGECERLI listesi siliniyor")
    conn = connect(cfg)
    conn.autocommit = False
    cur = conn.cursor()

    cur.execute("SELECT COUNT(*) FROM tpInvoiceDiscountOffer "
                "WHERE DiscountOfferCode = ?", KMP)
    kullanim = cur.fetchone()[0]
    if kullanim:
        log(f"DURDU: kampanya {kullanim} fişte KULLANILMIŞ — silinmedi. "
            "Claude'a bildir (IsActive=0 yapmak daha doğru olabilir).")
        conn.rollback()
        return

    for t, kosul, p in (("prDiscountOfferActiveLog", "DiscountOfferCode=?", KMP),
                        ("prDiscountOfferLocation", "DiscountOfferCode=?", KMP),
                        ("prDiscountOfferRules", "DiscountOfferCode=?", KMP),
                        ("cdDiscountOfferDesc", "DiscountOfferCode=?", KMP),
                        ("cdDiscountOffer", "DiscountOfferCode=?", KMP),
                        ("prItemListContent", "ItemListCode=?", LISTE),
                        ("cdItemListDesc", "ItemListCode=?", LISTE),
                        ("cdItemList", "ItemListCode=?", LISTE)):
        cur.execute(f"DELETE FROM [{t}] WHERE {kosul}", p)
        log(f"  {t}: {cur.rowcount} satır silindi")
    conn.commit()
    log("\n>>> COMMIT EDİLDİ — sistem YÜKLE-3 öncesi haline döndü.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log("\nHATA — transaction otomatik geri alınır:")
        log(traceback.format_exc())
    try:
        with open("GERIAL3-CIKTI.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(OUT))
        print("\n>>> GERIAL3-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
