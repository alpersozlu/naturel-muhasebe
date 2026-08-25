"""NEBIM KEŞİF v13 — HEDİYE ÇEKİ FİZİBİLİTESİ (salt-okunur).

Amaç: Derimod barkodlu hediye çeki projesi için Nebim V3'ün yeteneklerini
haritalamak. HİÇBİR YAZMA YAPMAZ — yalnızca SELECT / katalog sorguları.

Bakılanlar:
A) GiftCard evreni: ilgili tablolar + hangi tablolarda GiftCard kolonu var
B) cdGiftCard yapısı + istatistik (seri format, küpürler, kullanım, 290 çakışması)
C) Çek düzenleme tabloları (trGiftCardPaymentHeader/Line) yapısı + örnek
D) bsPaymentType sözlüğü (ödeme tipleri)
E) Kampanya/kupon altyapısı (tablo evreni + küçük sözlükler)
F) Ürün kısıt altyapısı (cdItem kolonları, hiyerarşi/kategori tabloları,
   trInvoiceLine'daki indirim/kampanya kolonları)
G) POS parametre tabloları
H) Sürüm + sağlık

Cikti: KESIF13-CIKTI.txt
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
            "SELECT t.name, SUM(p.rows) "
            "FROM sys.tables t "
            "JOIN sys.partitions p ON p.object_id = t.object_id "
            "     AND p.index_id IN (0,1) "
            "WHERE t.name LIKE ? "
            "GROUP BY t.name ORDER BY t.name", kalip)
        return self.cur.fetchall()

    def kolonlar(self, tablo):
        self.cur.execute(
            "SELECT COLUMN_NAME, DATA_TYPE, "
            "       COALESCE(CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION, 0) "
            "FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = ? "
            "ORDER BY ORDINAL_POSITION", tablo)
        return self.cur.fetchall()

    def kolon_haritasi(self, kolon_kalip):
        self.cur.execute(
            "SELECT t.name, c.name FROM sys.columns c "
            "JOIN sys.tables t ON t.object_id = c.object_id "
            "WHERE c.name LIKE ? ORDER BY t.name, c.name", kolon_kalip)
        return self.cur.fetchall()

    def dump_kucuk(self, tablo, limit=60):
        try:
            self.cur.execute(f"SELECT COUNT(*) FROM [{tablo}]")
            n = self.cur.fetchone()[0]
            if n == 0:
                log(f"  {tablo}: BOŞ")
                return
            if n > limit:
                log(f"  {tablo}: {n} satır (> {limit}, dökülmedi — kolonlar:)")
                log("    " + ", ".join(c[0] for c in self.kolonlar(tablo)))
                return
            self.cur.execute(f"SELECT * FROM [{tablo}]")
            adlar = [d[0] for d in self.cur.description]
            log(f"  {tablo} ({n} satır): " + " | ".join(adlar))
            for r in self.cur.fetchall():
                log("    " + " | ".join(kisalt(v, 28) for v in r))
        except Exception as e:
            log(f"  {tablo}: HATA {e}")


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


@bolum("A) GIFTCARD EVRENİ")
def a_evren(k: K):
    log("-- Adında 'GiftCard' geçen tablolar (ad | satır):")
    for t, n in k.tablolar("%GiftCard%"):
        log(f"  {t} | {n}")
    log("-- 'GiftCard*' KOLONU içeren tablolar (tablo.kolon):")
    for t, c in k.kolon_haritasi("%GiftCard%"):
        log(f"  {t}.{c}")


@bolum("B) cdGiftCard YAPISI + İSTATİSTİK")
def b_giftcard(k: K):
    log("-- Kolonlar (ad | tip | boy):")
    for ad, tip, boy in k.kolonlar("cdGiftCard"):
        log(f"  {ad} | {tip} | {boy}")
    c = k.cur
    c.execute("SELECT COUNT(*), SUM(CASE WHEN IsUsed=1 THEN 1 ELSE 0 END), "
              "SUM(CASE WHEN IsBlocked=1 THEN 1 ELSE 0 END), "
              "MIN(CreatedDate), MAX(CreatedDate) FROM cdGiftCard")
    r = c.fetchone()
    log(f"-- Toplam: {r[0]} | kullanılmış: {r[1]} | bloke: {r[2]} | tarih: {r[3]} → {r[4]}")
    log("-- SerialNumber uzunluk dağılımı:")
    c.execute("SELECT LEN(SerialNumber), COUNT(*) FROM cdGiftCard "
              "GROUP BY LEN(SerialNumber) ORDER BY 2 DESC")
    for r in c.fetchall():
        log(f"  {r[0]} hane | {r[1]} adet")
    log("-- Seri ÖN EK dağılımı (ilk 3 karakter, ilk 15):")
    c.execute("SELECT TOP 15 LEFT(SerialNumber,3), COUNT(*) FROM cdGiftCard "
              "GROUP BY LEFT(SerialNumber,3) ORDER BY 2 DESC")
    for r in c.fetchall():
        log(f"  '{r[0]}' | {r[1]}")
    c.execute("SELECT COUNT(*) FROM cdGiftCard WHERE SerialNumber LIKE '290%'")
    log(f"-- '290' ile başlayan MEVCUT seri (çakışma riski): {c.fetchone()[0]}")
    log("-- Tutar (Amount) dağılımı (ilk 10):")
    c.execute("SELECT TOP 10 Amount, COUNT(*) FROM cdGiftCard "
              "GROUP BY Amount ORDER BY 2 DESC")
    for r in c.fetchall():
        log(f"  {r[0]} | {r[1]}")
    log("-- Son 5 kayıt (seri | tutar | kullanılan | IsUsed | geçerlilik):")
    c.execute("SELECT TOP 5 SerialNumber, Amount, UsedAmount, IsUsed, "
              "FirstValidDate, LastValidDate, CreatedDate FROM cdGiftCard "
              "ORDER BY CreatedDate DESC")
    for r in c.fetchall():
        log("  " + " | ".join(kisalt(v, 20) for v in r))


@bolum("C) ÇEK DÜZENLEME TABLOLARI")
def c_duzenleme(k: K):
    for t in ("trGiftCardPaymentHeader", "trGiftCardPaymentLine"):
        log(f"-- {t} kolonları:")
        log("   " + ", ".join(cc[0] for cc in k.kolonlar(t)))
    c = k.cur
    log("-- Son 5 düzenleme (Line: seri + bağlı header alanları):")
    c.execute(
        "SELECT TOP 5 gl.SerialNumber, gh.DocumentNumber, gh.DocumentDate "
        "FROM trGiftCardPaymentLine gl "
        "LEFT JOIN trGiftCardPaymentHeader gh "
        "       ON gh.GiftCardPaymentHeaderID = gl.GiftCardPaymentHeaderID "
        "ORDER BY gh.DocumentDate DESC")
    for r in c.fetchall():
        log("  " + " | ".join(kisalt(v, 24) for v in r))
    log("-- cdGiftCardType benzeri sözlükler:")
    for t, n in k.tablolar("%GiftCardType%"):
        k.dump_kucuk(t)


@bolum("D) ÖDEME TİPLERİ SÖZLÜĞÜ")
def d_odeme(k: K):
    k.dump_kucuk("bsPaymentType", limit=80)
    for t, n in k.tablolar("%PaymentType%"):
        if t != "bsPaymentType" and n and n <= 80:
            k.dump_kucuk(t)


@bolum("E) KAMPANYA / KUPON ALTYAPISI")
def e_kampanya(k: K):
    for kalip in ("%Camp%", "%Coupon%", "%Promot%", "%Voucher%"):
        satirlar = k.tablolar(kalip)
        if satirlar:
            log(f"-- '{kalip}' tabloları (ad | satır):")
            for t, n in satirlar:
                log(f"  {t} | {n}")
    log("-- Küçük kampanya sözlükleri (bs/cd, <=60 satır):")
    for t, n in k.tablolar("bs%Camp%") + k.tablolar("cdCampaign%"):
        if n is not None and n <= 60:
            k.dump_kucuk(t)


@bolum("F) ÜRÜN KISIT ALTYAPISI")
def f_urun(k: K):
    log("-- cdItem kolonları:")
    log("   " + ", ".join(c[0] for c in k.kolonlar("cdItem")))
    log("-- Hiyerarşi/kategori/özellik tabloları (ad | satır):")
    for kalip in ("%Hierarchy%", "%ItemGroup%", "%Categor%", "%Attribute%",
                  "cdItemDim%", "%ItemType%"):
        for t, n in k.tablolar(kalip):
            log(f"  {t} | {n}")
    log("-- trInvoiceLine'daki indirim/kampanya kolonları:")
    c = k.cur
    c.execute(
        "SELECT c.name FROM sys.columns c "
        "JOIN sys.tables t ON t.object_id = c.object_id "
        "WHERE t.name = 'trInvoiceLine' AND (c.name LIKE '%isc%' "
        "   OR c.name LIKE '%Camp%' OR c.name LIKE '%Promo%')")
    log("   " + ", ".join(r[0] for r in c.fetchall()))
    log("-- Örnek: son faturadaki 1 satırın cdItem karşılığı (kategori keşfi):")
    c.execute(
        "SELECT TOP 1 l.ItemCode, i.* FROM trInvoiceLine l "
        "JOIN cdItem i ON i.ItemCode = l.ItemCode AND i.ItemTypeCode = l.ItemTypeCode "
        "ORDER BY l.CreatedDate DESC")
    row = c.fetchone()
    if row:
        adlar = [d[0] for d in c.description]
        for ad, v in zip(adlar, row):
            s = kisalt(v, 40)
            if s not in ("-", "0", "", "0.00"):
                log(f"   {ad} = {s}")


@bolum("G) POS PARAMETRE TABLOLARI")
def g_pos(k: K):
    for kalip in ("pd%POS%", "%POSTerminal%", "%POSParam%"):
        for t, n in k.tablolar(kalip):
            log(f"  {t} | {n}")
    log("-- POS tablolarında GiftCard/Camp kolonları:")
    for t, c in k.kolon_haritasi("%GiftCard%"):
        if "POS" in t:
            log(f"  {t}.{c}")


@bolum("H) SÜRÜM + SAĞLIK")
def h_surum(k: K):
    c = k.cur
    c.execute("SELECT @@VERSION")
    log("SQL: " + kisalt(c.fetchone()[0], 90))
    c.execute("SELECT DB_NAME()")
    log("DB: " + str(c.fetchone()[0]))
    c.execute("SELECT MAX(InvoiceDate) FROM trInvoiceHeader")
    log("Son fatura tarihi: " + str(c.fetchone()[0]))


def main():
    cfg = load_config()
    log(">>> NEBIM KEŞİF v13 — HEDİYE ÇEKİ FİZİBİLİTESİ (salt-okunur)")
    conn = connect(cfg)
    cur = conn.cursor()
    k = K(cur)
    a_evren(k)
    b_giftcard(k)
    c_duzenleme(k)
    d_odeme(k)
    e_kampanya(k)
    f_urun(k)
    g_pos(k)
    h_surum(k)
    log("\n>>> KEŞİF v13 TAMAM. Çıktının TAMAMINI yapıştır.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log(traceback.format_exc())
    try:
        with open("KESIF13-CIKTI.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(OUT))
        print("\n>>> KESIF13-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
