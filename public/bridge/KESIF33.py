"""NEBIM KEŞİF v33 — ÇEK PENCERESİNİ BESLEYEN PROSEDÜRÜN İÇİ (salt-okunur).

qry_GetDiscountVouchersByDiscountOfferCode boş dönüyor. Neden?
A) Prosedürün TAM METNİ (47 satır) — filtreler burada
B) Test çekimizin TÜM kolonları — hangi alan boş kalmış
C) Doğru parametrelerle tekrar deneme (CurrentDate=bugün, müşteri kodlu)
D) cdCurrAcc tip kodları vs çeklerin CustomerTypeCode'u
Cikti: KESIF33-CIKTI.txt
"""
from __future__ import annotations

import traceback
from satis_kopru import load_config, connect

OUT = []
SERI = "2900500099956"
PROC = "qry_GetDiscountVouchersByDiscountOfferCode"


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


@bolum("A) PROSEDÜRÜN TAM METNİ")
def a_metin(cur):
    cur.execute("SELECT OBJECT_DEFINITION(OBJECT_ID(?))", PROC)
    t = (cur.fetchone() or [""])[0] or ""
    for s in t.replace("\r", "").split("\n"):
        s = s.rstrip()
        if s.strip():
            log("  " + s[:126])


@bolum("B) TEST ÇEKİMİZİN TÜM DOLU KOLONLARI")
def b_cek(cur):
    cur.execute("SELECT * FROM cdDiscountVoucher WHERE SerialNumber = ?", SERI)
    kols = [d[0] for d in cur.description]
    r = cur.fetchone()
    if not r:
        log("  !!! ÇEK BULUNAMADI !!!")
        return
    d = dict(zip(kols, r))
    dolu, bos = [], []
    for k, v in d.items():
        if v is None or str(v).strip() in ("", "0"):
            bos.append(k)
        else:
            vv = v.strftime("%Y-%m-%d") if hasattr(v, "strftime") else str(v).strip()
            dolu.append(f"{k}={vv}")
    log("  DOLU: " + " | ".join(dolu)[:900])
    log("  BOŞ/0: " + ", ".join(bos)[:600])


@bolum("C) DOĞRU PARAMETRELERLE TEKRAR DENEME")
def c_dene(cur):
    denemeler = [
        ("HCKMP", 4, "", True),
        ("HCKMP", 4, "12-4-10", True),
        ("HCKMP", 3, "", True),
        ("'HCKMP'", 4, "", True),
        ("HCKMP,IND,UNI2054,%60HAZ26", 4, "", True),
        ("HCKMP", 0, "", True),
    ]
    for kodlar, ctc, cac, tarih in denemeler:
        try:
            cur.execute(
                f"EXEC {PROC} @DiscountOfferCodes=?, @CurrAccTypeCode=?, "
                f"@CurrAccCode=?, @CurrentDate=" +
                ("GETDATE()" if tarih else "NULL"),
                kodlar, ctc, cac)
            satir = cur.fetchall()
            ilk = ""
            if satir:
                ilk = " | ".join(str(x).strip() for x in satir[0][:4]
                                 if x is not None)[:80]
            log(f"  kod={kodlar[:26]:26} tip={ctc} cari='{cac}' "
                f"-> {len(satir)} satır {'*** ' + ilk if satir else ''}")
        except Exception as e:
            log(f"  kod={kodlar[:26]:26} tip={ctc} cari='{cac}' "
                f"-> HATA {str(e)[:90]}")


@bolum("D) CARİ TİP KODLARI vs ÇEKLERİN CustomerTypeCode'U")
def d_tip(cur):
    try:
        cur.execute("SELECT CustomerTypeCode, COUNT(*) FROM cdDiscountVoucher "
                    "WHERE DiscountVoucherTypeCode='HC' GROUP BY CustomerTypeCode")
        log(f"  HC çeklerinin CustomerTypeCode'u: "
            f"{[(str(r[0]).strip(), r[1]) for r in cur.fetchall()]}")
    except Exception as e:
        log(f"  CustomerTypeCode: {str(e)[:110]}")
    cur.execute("SELECT TOP 6 CurrAccTypeCode, COUNT(*) FROM cdCurrAcc "
                "GROUP BY CurrAccTypeCode ORDER BY COUNT(*) DESC")
    log(f"  cdCurrAcc tipleri: {[(r[0], r[1]) for r in cur.fetchall()]}")
    cur.execute("SELECT TOP 3 CurrAccCode, CurrAccTypeCode FROM cdCurrAcc "
                "WHERE CurrAccCode = N'12-4-10'")
    log(f"  POS müşterisi 12-4-10: "
        f"{[(str(r[0]).strip(), r[1]) for r in cur.fetchall()] or 'bulunamadı'}")


def main():
    cfg = load_config()
    log(">>> KEŞİF v33 — çek penceresi prosedürünün içi (salt-okunur)")
    conn = connect(cfg)
    cur = conn.cursor()
    a_metin(cur)
    b_cek(cur)
    c_dene(cur)
    d_tip(cur)
    log("\n>>> KEŞİF v33 TAMAM. Çıktının TAMAMINI yapıştır/fotoğrafla.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log(traceback.format_exc())
    try:
        with open("KESIF33-CIKTI.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(OUT))
        print("\n>>> KESIF33-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
