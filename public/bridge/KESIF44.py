# -*- coding: utf-8 -*-
"""NEBIM KEŞİF v44 — POS PROGRAM DOSYALARINDA ÇEK KURALINI BUL (salt-okunur).

Veritabanına DOKUNMAZ. Sunucudaki Nebim kurulum klasörlerini tarar:
A) 'CannotFindActiveDiscountOfferForDiscountVoucherType' mesajını içeren
   dosyalar (dll/exe/resources) — kural bu dosyalardan birinde
B) O dosyalardaki çekle ilgili TÜM mesaj/metin anahtarları (komşu metinler)
   → POS'un çek için yaptığı kontrollerin tam listesi
C) 'winFrmUseDiscountVoucher', 'IsBearerVoucher', 'DiscountVoucherType'
   geçen dosyalar → mantığın bulunduğu DLL
Cikti: KESIF44-CIKTI.txt
"""
from __future__ import annotations

import os
import re
import traceback

OUT = []
HEDEF = "CannotFindActiveDiscountOfferForDiscountVoucherType"
ANAHTARLAR = ["winFrmUseDiscountVoucher", "IsBearerVoucher",
              "DiscountVoucherType", "MSGIsNotValidDiscountVoucherCustomer",
              "sp_ValidateDiscountVoucherCustomer",
              "GetDiscountVouchersByDiscountOfferCode"]
KOKLER = [r"C:\Program Files (x86)\Nebim", r"C:\Program Files\Nebim",
          r"C:\Nebim", r"D:\Nebim", r"C:\Program Files (x86)\Nebim V3",
          r"C:\Program Files\Nebim V3"]
UZANTI = (".dll", ".exe", ".resources", ".resx", ".config", ".xml")


def log(*a):
    s = " ".join(str(x) for x in a)
    print(s)
    OUT.append(s)


def kokleri_bul():
    bulunan = [k for k in KOKLER if os.path.isdir(k)]
    # Program Files altında 'nebim' geçen her klasör
    for pf in (r"C:\Program Files (x86)", r"C:\Program Files"):
        try:
            for ad in os.listdir(pf):
                yol = os.path.join(pf, ad)
                if "nebim" in ad.lower() and os.path.isdir(yol) and yol not in bulunan:
                    bulunan.append(yol)
        except Exception:
            pass
    return bulunan


def dosyalari_tara(kokler):
    for kok in kokler:
        for dizin, _, dosyalar in os.walk(kok):
            for d in dosyalar:
                if d.lower().endswith(UZANTI):
                    yield os.path.join(dizin, d)


def utf16_metinler(veri, en_az=6):
    """UTF-16LE (Windows .NET) metinleri çıkar."""
    for m in re.finditer(rb"(?:[\x20-\x7e]\x00){%d,}" % en_az, veri):
        try:
            yield m.start(), m.group().decode("utf-16le")
        except Exception:
            continue


def main():
    log(">>> KEŞİF v44 — POS program dosyalarında çek kuralı (salt-okunur)")
    kokler = kokleri_bul()
    log(f"  taranacak klasörler: {kokler or 'BULUNAMADI'}")
    if not kokler:
        log("  Nebim klasörü bulunamadı. Kurulum yolunu söyleyin.")
        return

    hedef_a = HEDEF.encode("ascii")
    hedef_u = HEDEF.encode("utf-16le")
    anahtar_bayt = {k: (k.encode("ascii"), k.encode("utf-16le")) for k in ANAHTARLAR}

    iceren = []          # (yol, boyut, utf16 mi)
    anahtar_dosya = {k: [] for k in ANAHTARLAR}
    toplam = 0
    for yol in dosyalari_tara(kokler):
        toplam += 1
        try:
            if os.path.getsize(yol) > 200 * 1024 * 1024:
                continue
            with open(yol, "rb") as f:
                veri = f.read()
        except Exception:
            continue
        if hedef_a in veri or hedef_u in veri:
            iceren.append((yol, len(veri), hedef_u in veri))
        for k, (ba, bu) in anahtar_bayt.items():
            if ba in veri or bu in veri:
                anahtar_dosya[k].append(yol)

    log(f"\n=== A) '{HEDEF}' İÇEREN DOSYALAR ({len(iceren)} / taranan {toplam}) ===")
    for yol, boyut, u16 in iceren:
        log(f"  {yol}  ({boyut//1024} KB, {'utf16' if u16 else 'ascii'})")

    log("\n=== B) O DOSYALARDAKİ ÇEK/KAMPANYA METİNLERİ (komşu anahtarlar) ===")
    for yol, _, _ in iceren[:4]:
        log(f"\n  --- {os.path.basename(yol)}")
        try:
            with open(yol, "rb") as f:
                veri = f.read()
        except Exception:
            continue
        gorulen = set()
        for _, s in utf16_metinler(veri):
            k = s.lower()
            if ("voucher" in k or "kampanya" in k or "discountoffer" in k
                    or "çek" in k or "cek" in k) and s not in gorulen:
                gorulen.add(s)
                if len(gorulen) <= 120:
                    log(f"     {s[:110]}")
        if len(gorulen) > 120:
            log(f"     ... (+{len(gorulen)-120} metin daha)")
        # ASCII (resources genelde UTF-8/ASCII olabilir)
        gorulen_a = set()
        for m in re.finditer(rb"[\x20-\x7e]{8,}", veri):
            s = m.group().decode("ascii", "ignore")
            k = s.lower()
            if ("voucher" in k or "discountoffer" in k) and s not in gorulen \
                    and s not in gorulen_a:
                gorulen_a.add(s)
                if len(gorulen_a) <= 60:
                    log(f"     [a] {s[:110]}")

    log("\n=== C) ANAHTAR KELİMELERİ İÇEREN DOSYALAR ===")
    for k, ds in anahtar_dosya.items():
        log(f"  {k}: {len(ds)} dosya")
        for d in ds[:6]:
            log(f"     {d}")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log(traceback.format_exc())
    try:
        with open("KESIF44-CIKTI.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(OUT))
        print("\n>>> KESIF44-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
