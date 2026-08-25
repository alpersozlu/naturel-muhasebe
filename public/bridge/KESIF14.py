"""NEBIM KEŞİF v14 — HEDİYE ÇEKİ FİZİBİLİTESİ 2. TUR (salt-okunur).

KESIF13 bulguları üzerine hedefli sorular:
A) DiscountOffer (kampanya) motoru: tablolar + kural yapısı + örnek kurallar
B) Genel Discount tablo evreni
C) DiscountVoucher (indirim çeki) mekanizması detayı
D) GiftCard operasyon: numaralandırma şablonu, ödeme tipi kullanımı,
   düzenleme akışı, POS terminal parametreleri
E) Ürün sınıflandırma: özellik (attribute) sözlüğü — outlet/aksesuar nerede?
F) trInvoiceLine tam kolon listesi (satır indirimi nerede?)

HİÇBİR YAZMA YAPMAZ. Cikti: KESIF14-CIKTI.txt
"""
from __future__ import annotations

import traceback
from satis_kopru import load_config, connect

OUT = []


def log(*a):
    s = " ".join(str(x) for x in a)
    print(s)
    OUT.append(s)


def kisalt(v, n=48):
    s = "-" if v is None else str(v)
    s = s.replace("\r", " ").replace("\n", " ").strip()
    return (s[: n - 1] + "…") if len(s) > n else s


class K:
    def __init__(self, cur):
        self.cur = cur

    def tablolar(self, kalip):
        self.cur.execute(
            "SELECT t.name, SUM(p.rows) FROM sys.tables t "
            "JOIN sys.partitions p ON p.object_id = t.object_id "
            "     AND p.index_id IN (0,1) "
            "WHERE t.name LIKE ? GROUP BY t.name ORDER BY t.name", kalip)
        return self.cur.fetchall()

    def kolonlar(self, tablo):
        self.cur.execute(
            "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS "
            "WHERE TABLE_NAME = ? ORDER BY ORDINAL_POSITION", tablo)
        return [r[0] for r in self.cur.fetchall()]

    def dump_kucuk(self, tablo, limit=60):
        try:
            self.cur.execute(f"SELECT COUNT(*) FROM [{tablo}]")
            n = self.cur.fetchone()[0]
            if n == 0:
                log(f"  {tablo}: BOŞ")
                return
            if n > limit:
                log(f"  {tablo}: {n} satır (> {limit}, dökülmedi)")
                return
            self.cur.execute(f"SELECT * FROM [{tablo}]")
            adlar = [d[0] for d in self.cur.description]
            log(f"  {tablo} ({n} satır): " + " | ".join(adlar))
            for r in self.cur.fetchall():
                log("    " + " | ".join(kisalt(v, 26) for v in r))
        except Exception as e:
            log(f"  {tablo}: HATA {e}")

    def dump_nonempty(self, sql, *params, etiket=""):
        """Satırları 'kolon = değer' (boş/0 olmayanlar) olarak basar."""
        try:
            self.cur.execute(sql, *params)
            adlar = [d[0] for d in self.cur.description]
            i = 0
            for row in self.cur.fetchall():
                i += 1
                log(f"  --- {etiket} kayıt {i}:")
                for ad, v in zip(adlar, row):
                    s = kisalt(v, 60)
                    if s not in ("-", "0", "", "0.00", "False", "0.0",
                                 "1900-01-01", "1900-01-01 00:00:00"):
                        log(f"     {ad} = {s}")
            if i == 0:
                log(f"  ({etiket}: kayıt yok)")
        except Exception as e:
            log(f"  {etiket}: HATA {e}")


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


@bolum("A) DISCOUNTOFFER (KAMPANYA) MOTORU")
def a_offer(k: K):
    log("-- '%DiscountOffer%' tabloları (ad | satır):")
    for t, n in k.tablolar("%DiscountOffer%"):
        log(f"  {t} | {n}")
    for t in ("cdDiscountOffer", "prDiscountOfferRules", "tpInvoiceDiscountOffer"):
        log(f"-- {t} kolonları:")
        log("   " + ", ".join(k.kolonlar(t)))
    log("-- Son 3 kampanya tanımı (cdDiscountOffer, boş olmayan alanlar):")
    k.dump_nonempty(
        "SELECT TOP 3 * FROM cdDiscountOffer ORDER BY CreatedDate DESC",
        etiket="offer")
    log("-- Son 3 kural (prDiscountOfferRules, boş olmayan alanlar):")
    k.dump_nonempty(
        "SELECT TOP 3 * FROM prDiscountOfferRules ORDER BY CreatedDate DESC",
        etiket="kural")


@bolum("B) GENEL DISCOUNT TABLO EVRENİ")
def b_discount(k: K):
    for t, n in k.tablolar("%Discount%"):
        if n and n > 0:
            log(f"  {t} | {n}")


@bolum("C) DISCOUNTVOUCHER (İNDİRİM ÇEKİ) MEKANİZMASI")
def c_voucher(k: K):
    k.dump_kucuk("bsDiscountVoucherBase")
    k.dump_kucuk("bsDiscountVoucherBaseDesc")
    log("-- cdDiscountVoucherType kolonları:")
    log("   " + ", ".join(k.kolonlar("cdDiscountVoucherType")))
    log("-- cdDiscountVoucherType kaydı (boş olmayan alanlar):")
    k.dump_nonempty("SELECT * FROM cdDiscountVoucherType", etiket="tip")
    log("-- cdDiscountVoucher kolonları:")
    log("   " + ", ".join(k.kolonlar("cdDiscountVoucher")))


@bolum("D) GIFTCARD OPERASYON DETAYI")
def d_giftcard(k: K):
    log("-- srCodeNumberGiftCard (numaralandırma şablonu):")
    k.dump_nonempty("SELECT * FROM srCodeNumberGiftCard", etiket="şablon")
    c = k.cur
    log("-- Son 12 ayın ödeme tipi dağılımı (AllPayments):")
    c.execute(
        "SELECT PaymentTypeCode, COUNT(*), SUM(Loc_Payment) FROM AllPayments "
        "WHERE DocumentDate >= DATEADD(month,-12,GETDATE()) "
        "GROUP BY PaymentTypeCode ORDER BY PaymentTypeCode")
    for r in c.fetchall():
        log(f"  kod {r[0]} | {r[1]} işlem | {float(r[2] or 0):,.2f}")
    log("-- trGiftCardPaymentHeader: tip dağılımı:")
    c.execute("SELECT GiftCardPaymentTypeCode, COUNT(*) "
              "FROM trGiftCardPaymentHeader GROUP BY GiftCardPaymentTypeCode")
    for r in c.fetchall():
        log(f"  tip {r[0]} | {r[1]}")
    log("-- Son 3 çek düzenleme (header+line, boş olmayan alanlar):")
    k.dump_nonempty(
        "SELECT TOP 3 gl.SerialNumber, gh.* "
        "FROM trGiftCardPaymentLine gl "
        "JOIN trGiftCardPaymentHeader gh "
        "  ON gh.GiftCardPaymentHeaderID = gl.GiftCardPaymentHeaderID "
        "ORDER BY gh.PaymentDate DESC, gh.PaymentTime DESC", etiket="düzenleme")
    log("-- cdPOSTerminal (3 kayıt, boş olmayan alanlar):")
    k.dump_nonempty("SELECT * FROM cdPOSTerminal", etiket="POS")


@bolum("E) ÜRÜN SINIFLANDIRMA — ÖZELLİK SÖZLÜĞÜ")
def e_urun(k: K):
    c = k.cur
    log("-- Özellik tipleri (TR) + kullanım sayısı:")
    c.execute(
        "SELECT td.AttributeTypeCode, td.AttributeTypeDescription, "
        "       (SELECT COUNT(*) FROM prItemAttribute pa "
        "        WHERE pa.AttributeTypeCode = td.AttributeTypeCode) AS kullanim "
        "FROM cdItemAttributeTypeDesc td WHERE td.LangCode = 'TR' "
        "ORDER BY kullanim DESC")
    tipler = c.fetchall()
    for r in tipler:
        log(f"  {r[0]} | {kisalt(r[1], 40)} | {r[2]} üründe")
    log("-- En çok kullanılan 5 tipin örnek değerleri:")
    for tip in [t[0] for t in tipler[:5]]:
        c.execute(
            "SELECT TOP 12 ad.AttributeDescription FROM cdItemAttributeDesc ad "
            "JOIN cdItemAttribute a ON a.AttributeTypeCode = ad.AttributeTypeCode "
            "     AND a.AttributeCode = ad.AttributeCode "
            "WHERE ad.AttributeTypeCode = ? AND ad.LangCode = 'TR'", tip)
        degerler = ", ".join(kisalt(r[0], 22) for r in c.fetchall())
        log(f"  tip {tip}: {degerler}")
    log("-- Ürün adında aksesuar kelimesi geçenler (cdItemDesc):")
    for kelime in ("ÇORAP", "CÜZDAN", "KEMER", "BLINK", "BLİNK", "OUTLET"):
        c.execute("SELECT COUNT(DISTINCT ItemCode) FROM cdItemDesc "
                  "WHERE ItemDescription LIKE ?", f"%{kelime}%")
        log(f"  '{kelime}': {c.fetchone()[0]} ürün")
    k.dump_kucuk("bsItemType")
    k.dump_kucuk("bsItemTypeDesc")
    k.dump_kucuk("dfProductHierarchyLevelNames")


@bolum("F) trInvoiceLine TAM KOLON LİSTESİ")
def f_satir(k: K):
    log("   " + ", ".join(k.kolonlar("trInvoiceLine")))
    log("-- tpInvoiceDiscountOffer son 3 kayıt (boş olmayan alanlar):")
    k.dump_nonempty(
        "SELECT TOP 3 * FROM tpInvoiceDiscountOffer ORDER BY CreatedDate DESC",
        etiket="fiş-kampanya")


def main():
    cfg = load_config()
    log(">>> NEBIM KEŞİF v14 — HEDİYE ÇEKİ FİZİBİLİTESİ 2. TUR (salt-okunur)")
    conn = connect(cfg)
    cur = conn.cursor()
    k = K(cur)
    a_offer(k)
    b_discount(k)
    c_voucher(k)
    d_giftcard(k)
    e_urun(k)
    f_satir(k)
    log("\n>>> KEŞİF v14 TAMAM. Çıktının TAMAMINI yapıştır.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log(traceback.format_exc())
    try:
        with open("KESIF14-CIKTI.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(OUT))
        print("\n>>> KESIF14-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
