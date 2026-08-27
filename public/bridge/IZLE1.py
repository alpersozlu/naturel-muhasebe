# -*- coding: utf-8 -*-
"""NEBIM İZLE-1 — POS'un çek denemesindeki TÜM sorgularını canlı yakala.

Nasıl çalışır:
  1) SQL Server'da 'HC_IZLEME' adlı hafif bir izleme oturumu açar
     (yalnız sorgu metinlerini toplar; veriye DOKUNMAZ, performans etkisi
      ihmal edilebilir; script sonunda oturum otomatik SİLİNİR)
  2) Ekranda 'ŞİMDİ DENE' yazınca POS'ta çek denemesi yapılır
  3) Konsolda Enter'a basılınca kayıt okunur, ilgili sorgular dökülür

Cikti: IZLE1-CIKTI.txt
"""
from __future__ import annotations

import traceback
import xml.etree.ElementTree as ET
from satis_kopru import load_config, connect

OUT = []
OTURUM = "HC_IZLEME"


def log(*a):
    s = " ".join(str(x) for x in a)
    print(s)
    OUT.append(s)


def main():
    cfg = load_config()
    conn = connect(cfg)
    conn.autocommit = True
    cur = conn.cursor()

    # ── oturumu kur ──────────────────────────────────────────────────
    cur.execute(f"""
        IF EXISTS(SELECT * FROM sys.server_event_sessions WHERE name='{OTURUM}')
            DROP EVENT SESSION {OTURUM} ON SERVER
        """)
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
    print("=" * 60)
    print("  ŞİMDİ POS'TA DENEMEYİ YAPTIRIN:")
    print("  Satış → ürün → yeşil → İşlemler → İndirim Çeki Kullan")
    print("  → seri 2900500099918 → Enter → yeşil ✓ (hata çıksın)")
    print("  Deneme BİTİNCE bu pencerede ENTER'a basın...")
    print("=" * 60)
    try:
        input()
    except Exception:
        pass

    # ── kaydı oku ────────────────────────────────────────────────────
    cur.execute(f"""
        SELECT CAST(t.target_data AS nvarchar(max))
        FROM sys.dm_xe_sessions s
        JOIN sys.dm_xe_session_targets t
          ON s.address = t.event_session_address
        WHERE s.name = '{OTURUM}' AND t.target_name = 'ring_buffer'
        """)
    r = cur.fetchone()
    xmldata = r[0] if r else None

    # ── oturumu kapat/sil ────────────────────────────────────────────
    try:
        cur.execute(f"DROP EVENT SESSION {OTURUM} ON SERVER")
        log(">>> İzleme oturumu silindi (iz bırakmadık).")
    except Exception as e:
        log(f"(oturum silinemedi: {e} — elle: DROP EVENT SESSION {OTURUM} ON SERVER)")

    if not xmldata:
        log("HATA: kayıt okunamadı.")
        return

    kok = ET.fromstring(xmldata)
    olaylar = kok.findall(".//event")
    log(f">>> toplanan olay: {len(olaylar)}")
    ilgili = 0
    for ev in olaylar:
        metin = ""
        for d in ev.findall("data"):
            if d.get("name") in ("batch_text", "statement"):
                v = d.find("value")
                if v is not None and v.text:
                    metin = v.text
        host = ""
        for a in ev.findall("action"):
            if a.get("name") == "client_hostname":
                v = a.find("value")
                host = (v.text or "") if v is not None else ""
        kucuk = metin.lower()
        if metin and ("discount" in kucuk or "29005000" in metin
                      or "voucher" in kucuk):
            ilgili += 1
            log(f"\n--- olay {ilgili} | {ev.get('timestamp')} | host: {host} ---")
            log(metin[:3500])
    if ilgili == 0:
        log("(ilgili sorgu yakalanmadı — deneme izleme açıkken yapıldı mı?)")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log(traceback.format_exc())
    try:
        with open("IZLE1-CIKTI.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(OUT))
        print("\n>>> IZLE1-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
