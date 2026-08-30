"""NEBIM KEŞİF v31 — POS'UN AKTİF KAMPANYA SORGUSUNU BİZ ÇALIŞTIRIYORUZ.

Salt-okunur. qry_GetActiveDiscountOffers'i POS'un parametreleriyle çağırıp
HCKMP listede mi diye bakar; yoksa hangi filtrede elendiğini gösterir.
Cikti: KESIF31-CIKTI.txt
"""
from __future__ import annotations

import traceback
from satis_kopru import load_config, connect

OUT = []
URUN = "26PFD510410"


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


@bolum("A) ÇEK/KAMPANYA PROSEDÜRLERİ")
def a_prosedurler(cur):
    cur.execute("""
        SELECT name, type_desc, modify_date FROM sys.objects
        WHERE (name LIKE '%DiscountVoucher%' OR name LIKE '%ActiveDiscount%')
          AND type IN ('P','FN','TF','IF','V')
        ORDER BY name
        """)
    for r in cur.fetchall():
        log(f"  {str(r[0])[:52]:52} {str(r[1])[:16]:16} {r[2]}")


@bolum("B) POS PARAMETRELERİ (son fişlerden)")
def b_param(cur):
    sonuc = {}
    for kol in ("ProcessCode", "StoreCode", "CurrAccTypeCode"):
        try:
            cur.execute(f"""
                SELECT TOP 4 {kol}, COUNT(*) FROM trInvoiceHeader WITH(NOLOCK)
                WHERE InvoiceDate >= DATEADD(day, -30, GETDATE())
                GROUP BY {kol} ORDER BY COUNT(*) DESC
                """)
            v = [(str(r[0]).strip(), r[1]) for r in cur.fetchall()]
            sonuc[kol] = [x[0] for x in v]
            log(f"  {kol}: {v}")
        except Exception as e:
            log(f"  {kol}: yok ({str(e)[:60]})")
            sonuc[kol] = []
    return sonuc


@bolum("C) qry_GetActiveDiscountOffers — POS GİBİ ÇAĞIR")
def c_calistir(cur, par):
    pcs = par.get("ProcessCode") or ["RS", "WS", "1"]
    scs = [s for s in (par.get("StoreCode") or []) if s] or ["S01"]
    scs = scs[:2]
    ctc = (par.get("CurrAccTypeCode") or ["3"])[0]
    try:
        ctc = int(ctc)
    except Exception:
        ctc = 3
    log(f"  denenecek: ProcessCode={pcs[:3]} StoreCode={scs} "
        f"CurrAccTypeCode={ctc} ItemCode={URUN}")
    for pc in pcs[:3]:
        for sc in scs:
            try:
                cur.execute(
                    "EXEC qry_GetActiveDiscountOffers @ProcessCode=?, "
                    "@StoreCode=?, @CurrAccTypeCode=?, @CurrAccCode=?, "
                    "@ItemCode=?, @LangCode=?",
                    pc, sc, ctc, "", URUN, "TR")
                kodlar = []
                while True:
                    try:
                        for r in cur.fetchall():
                            for h in r:
                                s = str(h).strip()
                                if s and len(s) <= 12 and s.isupper():
                                    kodlar.append(s)
                                    break
                    except Exception:
                        pass
                    if not cur.nextset():
                        break
                var = "HCKMP" in kodlar
                log(f"  PC={pc:4} SC={sc:4} -> {len(kodlar)} kampanya | "
                    f"HCKMP: {'VAR ***' if var else 'YOK'} | {kodlar[:8]}")
            except Exception as e:
                log(f"  PC={pc:4} SC={sc:4} -> HATA {str(e)[:110]}")


@bolum("D) PROSEDÜR METNİNDE 'VOUCHER' GEÇEN SATIRLAR")
def d_metin(cur):
    cur.execute("SELECT OBJECT_DEFINITION(OBJECT_ID('qry_GetActiveDiscountOffers'))")
    t = cur.fetchone()[0]
    if not t:
        log("  (tanım okunamadı)")
        return
    satirlar = t.replace("\r", "").split("\n")
    log(f"  toplam {len(satirlar)} satır; 'Voucher' geçenler:")
    n = 0
    for i, s in enumerate(satirlar, 1):
        if "voucher" in s.lower():
            log(f"   {i:4}| {s.strip()[:140]}")
            n += 1
            if n >= 22:
                log("   ... (kesildi)")
                break
    if n == 0:
        log("   (HİÇ YOK — bu prosedür çek tipiyle ilgilenmiyor!)")


@bolum("E) tpInvoiceDiscountOffer KOLONLARI")
def e_kolon(cur):
    cur.execute("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS "
                "WHERE TABLE_NAME='tpInvoiceDiscountOffer' ORDER BY ORDINAL_POSITION")
    log("  " + ", ".join(r[0] for r in cur.fetchall()))


def main():
    cfg = load_config()
    log(">>> KEŞİF v31 — aktif kampanya sorgusu canlı test (salt-okunur)")
    conn = connect(cfg)
    cur = conn.cursor()
    a_prosedurler(cur)
    par = b_param(cur) or {}
    c_calistir(cur, par)
    d_metin(cur)
    e_kolon(cur)
    log("\n>>> KEŞİF v31 TAMAM. Çıktının TAMAMINI yapıştır/fotoğrafla.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log(traceback.format_exc())
    try:
        with open("KESIF31-CIKTI.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(OUT))
        print("\n>>> KESIF31-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
