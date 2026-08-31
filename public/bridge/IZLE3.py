# -*- coding: utf-8 -*-
"""NEBIM İZLE-3 — ÜRÜN EKLENİRKEN YÜKLENEN KAMPANYALARI YAKALA.

IZLE2'de ürün zaten fişteydi; POS kampanya setini ÜRÜN EKLENİRKEN yüklüyor.
Bu script izlemeyi önce açar, ürün ekleme dahil tüm akışı yakalar ve
çek tipini taşıyan sorguyu bulur.

Ayrıca: yakalanan ürün kodlarının HCGECERLI listesinde olup olmadığını,
HCKMP'nin mağaza listesini ve üretilmiş prosedürlerin içeriğini kontrol eder.

Cikti: IZLE3-CIKTI.txt
"""
from __future__ import annotations

import re
import traceback
import xml.etree.ElementTree as ET
from satis_kopru import load_config, connect

OUT = []
OTURUM = "HC_IZLEME3"


def log(*a):
    s = " ".join(str(x) for x in a)
    print(s)
    OUT.append(s)


def main():
    cfg = load_config()
    conn = connect(cfg)
    conn.autocommit = True
    cur = conn.cursor()

    cur.execute(
        f"IF EXISTS(SELECT * FROM sys.server_event_sessions "
        f"WHERE name='{OTURUM}') DROP EVENT SESSION {OTURUM} ON SERVER")
    cur.execute(f"""
        CREATE EVENT SESSION {OTURUM} ON SERVER
        ADD EVENT sqlserver.sql_batch_completed(
            ACTION(sqlserver.client_hostname)),
        ADD EVENT sqlserver.rpc_completed(
            ACTION(sqlserver.client_hostname))
        ADD TARGET package0.ring_buffer(SET max_memory = 102400)
        WITH (MAX_DISPATCH_LATENCY = 2 SECONDS, STARTUP_STATE = OFF)
        """)
    cur.execute(f"ALTER EVENT SESSION {OTURUM} ON SERVER STATE = START")
    log(">>> İzleme AÇIK.")
    print()
    print("=" * 64)
    print("  SIRAYLA YAPIN (izleme SIMDI acik):")
    print("   1) POS'ta YENI FIS ac  (urun HENUZ ekli olmasin!)")
    print("   2) Urunu OKUT/EKLE  <<< EN ONEMLI ADIM")
    print("   3) Odeme -> Islemler -> Indirim Ceki Kullan")
    print("   4) Tip acilir okunu tikla, seri gir: 2900500099956, Enter")
    print("  Bitince bu pencerede ENTER'a basin...")
    print("=" * 64)
    try:
        input()
    except Exception:
        pass

    cur.execute(f"""
        SELECT CAST(t.target_data AS nvarchar(max))
        FROM sys.dm_xe_sessions s
        JOIN sys.dm_xe_session_targets t
          ON s.address = t.event_session_address
        WHERE s.name = '{OTURUM}' AND t.target_name = 'ring_buffer'
        """)
    r = cur.fetchone()
    xmldata = r[0] if r else None
    try:
        cur.execute(f"DROP EVENT SESSION {OTURUM} ON SERVER")
        log(">>> İzleme oturumu silindi.")
    except Exception as e:
        log(f"(oturum silinemedi: {e})")

    if not xmldata:
        log("HATA: kayıt okunamadı.")
        return

    kok = ET.fromstring(xmldata)
    olaylar = kok.findall(".//event")
    log(f">>> toplanan olay: {len(olaylar)}")

    metinler = []
    for ev in olaylar:
        m = ""
        for d in ev.findall("data"):
            if d.get("name") in ("batch_text", "statement"):
                v = d.find("value")
                if v is not None and v.text:
                    m = v.text
        if m:
            metinler.append((ev.get("timestamp"), m))

    urun_sorgu = [(t, m) for t, m in metinler
                  if "getdiscountofferproducts" in m.lower()]
    tip_tasiyan = [(t, m) for t, m in metinler
                   if "discountvouchertypecode" in m.lower()
                   and "getdiscountofferproducts" not in m.lower()]
    kampanya = [(t, m) for t, m in metinler
                if "discountoffer" in m.lower()
                and "getdiscountofferproducts" not in m.lower()
                and "discountvouchertypecode" not in m.lower()]

    log(f"\n=== A) ÜRÜN KAMPANYA SORGUSU ({len(urun_sorgu)} çağrı) ===")
    for t, m in urun_sorgu[:4]:
        log(f"--- {t}")
        log(m[:900])

    log(f"\n=== B) ÇEK TİPİ TAŞIYAN SORGULAR ({len(tip_tasiyan)}) ===")
    if not tip_tasiyan:
        log("  (yok)")
    for t, m in tip_tasiyan[:6]:
        log(f"--- {t}")
        log(m[:900])

    log(f"\n=== C) DİĞER KAMPANYA SORGULARI ({len(kampanya)}) ===")
    for t, m in kampanya[:8]:
        log(f"--- {t}")
        log(m[:400])

    # ── yakalanan ürün kodları HCGECERLI'de mi ───────────────────────
    kodlar = set()
    for _, m in metinler:
        for k in re.findall(r"'(2[0-9][A-Z]{2,4}[0-9]{5,9})'", m):
            kodlar.add(k)
    log(f"\n=== D) YAKALANAN ÜRÜN KODLARI HCGECERLI'DE Mİ ===")
    if not kodlar:
        log("  (ürün kodu yakalanamadı)")
    for k in list(kodlar)[:10]:
        cur.execute("SELECT COUNT(*) FROM prItemListContent WITH(NOLOCK) "
                    "WHERE ItemListCode = N'HCGECERLI' AND ItemCode = ?", k)
        var = cur.fetchone()[0]
        durum = "EVET ✓" if var else "HAYIR ✗ (çek bu üründe geçmez)"
        log(f"  {k}: {durum}")

    log("\n=== E) HCKMP MAĞAZALARI VE ÜRETİLMİŞ PROSEDÜRLER ===")
    cur.execute("SELECT DISTINCT StoreCode FROM prDiscountOfferLocation "
                "WHERE DiscountOfferCode = N'HCKMP'")
    log(f"  HCKMP mağazaları: {[str(x[0]).strip() for x in cur.fetchall()]}")
    for ad in ("qry_GetDiscountOfferProducts_R_1",
               "qry_GetDiscountOfferProducts_R_2"):
        cur.execute("""
            SELECT o.modify_date,
                   CASE WHEN m.definition LIKE '%HCKMP%' THEN 1 ELSE 0 END,
                   CASE WHEN m.definition LIKE '%DiscountVoucherTypeCode%'
                        THEN 1 ELSE 0 END
            FROM sys.sql_modules m JOIN sys.objects o
              ON o.object_id = m.object_id WHERE o.name = ?
            """, ad)
        r2 = cur.fetchone()
        if r2:
            log(f"  {ad}: üretim={r2[0]} | HCKMP içeriyor={bool(r2[1])} "
                f"| çek tipi kolonu={bool(r2[2])}")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log(traceback.format_exc())
    try:
        with open("IZLE3-CIKTI.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(OUT))
        print("\n>>> IZLE3-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
