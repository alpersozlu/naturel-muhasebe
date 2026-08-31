# -*- coding: utf-8 -*-
"""NEBIM İZLE-2 — POS ÇEK PENCERESİNİN PARAMETRELERİNİ YAKALA.

qry_GetDiscountVouchersByDiscountOfferCode'a POS'un GERÇEKTE hangi
parametreleri gönderdiğini canlı yakalar (müşteri tipi, müşteri kodu,
kampanya kod listesi, tarih).

Nasıl çalışır:
  1) 'HC_IZLEME2' adlı hafif izleme oturumu açar (yalnız sorgu metni;
     veriye DOKUNMAZ; script sonunda oturum SİLİNİR)
  2) 'ŞİMDİ DENE' yazınca POS'ta çek penceresi açılır
  3) Enter'a basınca kayıt okunur ve dökülür

Cikti: IZLE2-CIKTI.txt
"""
from __future__ import annotations

import traceback
import xml.etree.ElementTree as ET
from satis_kopru import load_config, connect

OUT = []
OTURUM = "HC_IZLEME2"
ONEMLI = "getdiscountvouchersbydiscountoffercode"


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
        ADD TARGET package0.ring_buffer(SET max_memory = 40960)
        WITH (MAX_DISPATCH_LATENCY = 2 SECONDS, STARTUP_STATE = OFF)
        """)
    cur.execute(f"ALTER EVENT SESSION {OTURUM} ON SERVER STATE = START")
    log(">>> İzleme AÇIK.")
    print()
    print("=" * 62)
    print("  ŞİMDİ POS'TA YAPIN:")
    print("   1) Yeni fis -> urun ekle (1.000 TL ustu)")
    print("   2) Odeme -> Islemler -> Indirim Ceki Kullan")
    print("   3) 'Indirim Ceki Tipi' acilir okunu TIKLAYIN")
    print("   4) Seri girin: 2900500099956 -> Enter")
    print("  Bitince bu pencerede ENTER'a basin...")
    print("=" * 62)
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
        log(">>> İzleme oturumu silindi (iz bırakmadık).")
    except Exception as e:
        log(f"(oturum silinemedi: {e})")

    if not xmldata:
        log("HATA: kayıt okunamadı.")
        return

    kok = ET.fromstring(xmldata)
    olaylar = kok.findall(".//event")
    log(f">>> toplanan olay: {len(olaylar)}")

    onemli, diger = [], []
    for ev in olaylar:
        metin = ""
        for d in ev.findall("data"):
            if d.get("name") in ("batch_text", "statement"):
                v = d.find("value")
                if v is not None and v.text:
                    metin = v.text
        if not metin:
            continue
        k = metin.lower()
        if ONEMLI in k:
            onemli.append((ev.get("timestamp"), metin))
        elif "voucher" in k or "29005000" in metin:
            diger.append((ev.get("timestamp"), metin))

    log(f"\n=== A) ÇEK LİSTESİ SORGUSU ({len(onemli)} kez çağrıldı) ===")
    if not onemli:
        log("  !!! POS BU PROSEDÜRÜ HİÇ ÇAĞIRMADI !!!")
        log("  (yani çek tipi listesi başka bir kaynaktan geliyor)")
    for ts, m in onemli[:6]:
        log(f"\n--- {ts}")
        log(m[:1200])

    log(f"\n=== B) DİĞER ÇEK SORGULARI ({len(diger)}) ===")
    for ts, m in diger[:10]:
        log(f"\n--- {ts}")
        log(m[:700])


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log(traceback.format_exc())
    try:
        with open("IZLE2-CIKTI.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(OUT))
        print("\n>>> IZLE2-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
