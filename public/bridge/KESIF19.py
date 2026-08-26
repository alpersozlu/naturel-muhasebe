"""NEBIM KEŞİF v19 — POS FONKSİYON/YETKİ HARİTASI (salt-okunur).

Soru: POS'ta 'İndirim Çeki' penceresi neden görünmüyor?
A) Menü/fonksiyon/form tabloları (%Function%, %Menu%, %Form%)
B) Yetki/güvenlik tabloları (%Right%, %Securit%, %Role%, %Permission%, %Grant%)
C) Bulunan küçük tablolarda 'Voucher/Cek/GiftCard' araması
D) prProcessDiscount yapısı (manuel iskonto altyapısı)
E) Kullanıcı/grup tabloları (ad+satır; içerik dökülmez)
HİÇBİR YAZMA YAPMAZ. Cikti: KESIF19-CIKTI.txt
"""
from __future__ import annotations

import traceback
from satis_kopru import load_config, connect

OUT = []


def log(*a):
    s = " ".join(str(x) for x in a)
    print(s)
    OUT.append(s)


def kisalt(v, n=60):
    s = "-" if v is None else str(v)
    s = s.replace("\r", " ").replace("\n", " ").strip()
    return (s[: n - 1] + "…") if len(s) > n else s


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


def tablolar(cur, kalip):
    cur.execute(
        "SELECT t.name, SUM(p.rows) FROM sys.tables t "
        "JOIN sys.partitions p ON p.object_id = t.object_id "
        "     AND p.index_id IN (0,1) "
        "WHERE t.name LIKE ? GROUP BY t.name ORDER BY t.name", kalip)
    return cur.fetchall()


@bolum("A) MENÜ / FONKSİYON / FORM TABLOLARI")
def a_menu(cur):
    for kalip in ("%Function%", "%MenuItem%", "%FormName%", "%PosForm%",
                  "%Screen%"):
        satirlar = tablolar(cur, kalip)
        if satirlar:
            log(f"-- '{kalip}':")
            for t, n in satirlar:
                log(f"  {t} | {n}")


@bolum("B) YETKİ / GÜVENLİK TABLOLARI")
def b_yetki(cur):
    for kalip in ("%Right%", "%Securit%", "%Role%", "%Permission%",
                  "%Grant%", "%Restrict%", "%Author%"):
        satirlar = tablolar(cur, kalip)
        if satirlar:
            log(f"-- '{kalip}':")
            for t, n in satirlar:
                log(f"  {t} | {n}")


@bolum("C) YETKİ/FONKSİYON TABLOLARINDA ÇEK ARAMASI")
def c_arama(cur):
    # string kolonu olan, adı yetki/fonksiyon çağrıştıran tablolarda
    # Voucher/GiftCard/Cek geçen satırları ara (tablo başına ilk 5)
    adaylar = set()
    for kalip in ("%Function%", "%Right%", "%Securit%", "%MenuItem%",
                  "%Permission%", "%Restrict%"):
        for t, n in tablolar(cur, kalip):
            if n and 0 < n <= 20000:
                adaylar.add(t)
    log(f"-- taranan tablo sayısı: {len(adaylar)}")
    for t in sorted(adaylar):
        try:
            cur.execute(
                "SELECT c.name FROM sys.columns c "
                "JOIN sys.tables tt ON tt.object_id = c.object_id "
                "JOIN sys.types ty ON ty.user_type_id = c.user_type_id "
                "WHERE tt.name = ? AND ty.name IN ('nvarchar','varchar')", t)
            strkolonlar = [r[0] for r in cur.fetchall()]
            if not strkolonlar:
                continue
            kosul = " OR ".join(
                f"[{k}] LIKE '%Voucher%' OR [{k}] LIKE '%GiftCard%' "
                f"OR [{k}] LIKE N'%Çek%' OR [{k}] LIKE '%Cek%'"
                for k in strkolonlar)
            cur.execute(f"SELECT TOP 5 * FROM [{t}] WHERE {kosul}")
            adlar = [d[0] for d in cur.description]
            rows = cur.fetchall()
            if rows:
                log(f"-- {t} EŞLEŞME:")
                log("   kolonlar: " + " | ".join(adlar))
                for r in rows:
                    log("   " + " | ".join(kisalt(v, 34) for v in r))
        except Exception as e:
            log(f"  ({t}: atlandı — {kisalt(e, 60)})")


@bolum("D) prProcessDiscount YAPISI")
def d_iskonto(cur):
    cur.execute(
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS "
        "WHERE TABLE_NAME = 'prProcessDiscount' ORDER BY ORDINAL_POSITION")
    log("   " + ", ".join(r[0] for r in cur.fetchall()))
    cur.execute("SELECT TOP 3 * FROM prProcessDiscount")
    adlar = [d[0] for d in cur.description]
    for r in cur.fetchall():
        log("   " + " | ".join(f"{a}={kisalt(v, 20)}" for a, v in zip(adlar, r)
                               if str(v) not in ("None", "False", "0", "")))


@bolum("E) KULLANICI / GRUP TABLOLARI (yalnız ad+satır)")
def e_kullanici(cur):
    for kalip in ("cdUser%", "%UserGroup%", "%UserMainGroup%"):
        for t, n in tablolar(cur, kalip):
            log(f"  {t} | {n}")


def main():
    cfg = load_config()
    log(">>> NEBIM KEŞİF v19 — POS FONKSİYON/YETKİ HARİTASI (salt-okunur)")
    conn = connect(cfg)
    cur = conn.cursor()
    a_menu(cur)
    b_yetki(cur)
    c_arama(cur)
    d_iskonto(cur)
    e_kullanici(cur)
    log("\n>>> KEŞİF v19 TAMAM. Çıktının TAMAMINI yapıştır.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log(traceback.format_exc())
    try:
        with open("KESIF19-CIKTI.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(OUT))
        print("\n>>> KESIF19-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
