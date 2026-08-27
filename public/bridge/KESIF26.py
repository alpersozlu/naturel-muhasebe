"""NEBIM KEŞİF v26 — KESİN İKİLİ TEST (salt-okunur).

POS'un kampanya kaynağı qry_GetDiscountOfferProducts_R_1/R_2'yi son
denemedeki ürünle (26SAFD511010) sunucuda çalıştırır:
HCKMP dönüyor mu? + HCKMP'nin üretilmiş kod bloğunu döker.
Cikti: KESIF26-CIKTI.txt
"""
from __future__ import annotations

import traceback
from satis_kopru import load_config, connect

OUT = []
URUN = "26SAFD511010"


def log(*a):
    s = " ".join(str(x) for x in a)
    print(s)
    OUT.append(s)


def main():
    cfg = load_config()
    log(">>> KEŞİF v26 — kesin ikili test (salt-okunur)")
    conn = connect(cfg)
    cur = conn.cursor()

    # 1) ürün HCGECERLI listesinde mi?
    cur.execute("SELECT COUNT(*) FROM prItemListContent "
                "WHERE ItemListCode=N'HCGECERLI' AND ItemCode=?", URUN)
    log(f"\n1) {URUN} HCGECERLI listesinde mi: "
        f"{'EVET' if cur.fetchone()[0] else 'HAYIR'}")

    # 2) R_1 ve R_2'yi bu ürünle ÇALIŞTIR
    for proc in ("qry_GetDiscountOfferProducts_R_1",
                 "qry_GetDiscountOfferProducts_R_2"):
        log(f"\n2) EXEC {proc} '{URUN}':")
        try:
            cur.execute(f"EXEC {proc} ?", URUN)
            rows = []
            while True:
                try:
                    if cur.description:
                        rows = cur.fetchall()
                        break
                    if not cur.nextset():
                        break
                except Exception:
                    if not cur.nextset():
                        break
            if rows:
                adlar = [d[0] for d in cur.description]
                log("   kolonlar: " + " | ".join(adlar))
                kodlar = set()
                for r in rows[:60]:
                    log("   " + " | ".join(str(v)[:24] for v in r))
                    kodlar.add(str(r[0]).strip())
                log(f"   >>> dönen kampanya kodları: {sorted(kodlar)}")
                log(f"   >>> HCKMP VAR MI: {'EVET' if 'HCKMP' in kodlar else 'HAYIR'}")
            else:
                log("   (satır dönmedi)")
        except Exception as e:
            log(f"   HATA: {e}")

    # 3) R_1 içindeki HCKMP bloğunu dök (±2500 karakter)
    cur.execute("SELECT m.definition FROM sys.sql_modules m "
                "JOIN sys.objects o ON o.object_id = m.object_id "
                "WHERE o.name = 'qry_GetDiscountOfferProducts_R_1'")
    r = cur.fetchone()
    if r:
        t = r[0]
        i = t.find("HCKMP")
        log(f"\n3) R_1 tanımında 'HCKMP' konumu: {i} (toplam {len(t)} kr)")
        if i >= 0:
            bas = max(0, i - 1500)
            log("----- HCKMP BLOĞU -----")
            log(t[bas:i + 2500])
            log("----- BLOK SONU -----")

    log("\n>>> KEŞİF v26 TAMAM. Çıktının TAMAMINI yapıştır.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log(traceback.format_exc())
    try:
        with open("KESIF26-CIKTI.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(OUT))
        print("\n>>> KESIF26-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
