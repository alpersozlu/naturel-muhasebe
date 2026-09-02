# -*- coding: utf-8 -*-
"""NEBIM İZLE-4 — POS AÇILIŞI + TAM KOLON KIYASI (salt-okunur).

İki iş birden:
  A) POS AÇILIŞINDAN hata mesajına kadar tüm kampanya sorgularını yakalar
     (açılış, şimdiye dek hiç gözlenmemiş tek aşama)
  B) HCKMP ile ÇALIŞAN kampanyaların TÜM kolonlarını yan yana koyar,
     farklı olan her alanı işaretler (izleme olmadan da cevap verebilir)

Cikti: IZLE4-CIKTI.txt
"""
from __future__ import annotations

import traceback
import xml.etree.ElementTree as ET
from satis_kopru import load_config, connect

OUT = []
OTURUM = "HC_IZLEME4"
KOD = "HCKMP"
REFLER = ["UNI2054", "IND"]


def log(*a):
    s = " ".join(str(x) for x in a)
    print(s)
    OUT.append(s)


def gost(v):
    if v is None:
        return "NULL"
    if hasattr(v, "strftime"):
        return v.strftime("%Y-%m-%d")
    return str(v).strip()


def satirlar(cur, sql, *p):
    cur.execute(sql, *p)
    kols = [d[0] for d in cur.description]
    return [dict(zip(kols, r)) for r in cur.fetchall()]


def kiyas(cur, baslik, tablo, kosul_kod, kosul_ref, ek=""):
    log(f"\n--- {baslik}")
    bizim = satirlar(cur, f"SELECT * FROM {tablo} WHERE {kosul_kod} {ek}")
    if not bizim:
        log("   (HCKMP satırı yok)")
        return
    b = bizim[0]
    for ref in REFLER:
        rs = satirlar(cur, f"SELECT * FROM {tablo} WHERE {kosul_ref}", ref)
        if not rs:
            continue
        r = rs[0]
        log(f"   HCKMP  <->  {ref}   (yalnız FARKLI alanlar)")
        fark = 0
        for k in b:
            if k in ("RowGuid", "CreatedUserName", "CreatedDate",
                     "LastUpdatedUserName", "LastUpdatedDate",
                     "DiscountOfferCode"):
                continue
            if k not in r:
                continue
            if gost(b[k]) != gost(r[k]):
                fark += 1
                log(f"     {k:<38} HCKMP={gost(b[k]):<22} {ref}={gost(r[k])}")
        if fark == 0:
            log("     (fark yok)")
        break


def main():
    cfg = load_config()
    conn = connect(cfg)
    conn.autocommit = True
    cur = conn.cursor()
    log(">>> İZLE-4 — açılış izlemesi + tam kolon kıyası")

    # ── izleme (yalnız 'discount' geçen sorgular) ─────────────────
    cur.execute(
        f"IF EXISTS(SELECT * FROM sys.server_event_sessions "
        f"WHERE name='{OTURUM}') DROP EVENT SESSION {OTURUM} ON SERVER")
    cur.execute(f"""
        CREATE EVENT SESSION {OTURUM} ON SERVER
        ADD EVENT sqlserver.rpc_completed(
            ACTION(sqlserver.client_hostname)
            WHERE [sqlserver].[like_i_sql_unicode_string](
                  [statement], N'%discount%')),
        ADD EVENT sqlserver.sql_batch_completed(
            ACTION(sqlserver.client_hostname)
            WHERE [sqlserver].[like_i_sql_unicode_string](
                  [batch_text], N'%discount%'))
        ADD TARGET package0.ring_buffer(SET max_memory = 512000)
        WITH (MAX_DISPATCH_LATENCY = 2 SECONDS, STARTUP_STATE = OFF)
        """)
    cur.execute(f"ALTER EVENT SESSION {OTURUM} ON SERVER STATE = START")
    log(">>> İzleme AÇIK (yalnız kampanya/çek sorguları süzülüyor).")
    print()
    print("=" * 64)
    print("  SIRAYLA YAPIN — BU SEFER POS'U KAPATIP ACARAK:")
    print("   1) POS'tan TAMAMEN CIK (uygulamayi kapat)")
    print("   2) POS'u YENIDEN AC ve giris yap   <<< YENI OLAN ADIM")
    print("   3) Yeni fis -> urunu ekle")
    print("   4) Odeme -> Islemler -> Indirim Ceki Kullan")
    print("   5) Tip acilir okunu tikla, seri gir: 2900500099956, Enter")
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

    log("\n=== A) AÇILIŞTAN HATAYA KADAR KAMPANYA SORGULARI ===")
    if not xmldata:
        log("  kayıt okunamadı.")
    else:
        kok = ET.fromstring(xmldata)
        metinler = []
        for ev in kok.findall(".//event"):
            m = ""
            for d in ev.findall("data"):
                if d.get("name") in ("batch_text", "statement"):
                    v = d.find("value")
                    if v is not None and v.text:
                        m = v.text
            if m:
                metinler.append((ev.get("timestamp"), m))
        log(f"  yakalanan sorgu: {len(metinler)}")
        onemli = [(t, m) for t, m in metinler
                  if "cddiscountoffer" in m.lower()
                  or "discountvouchertypecode" in m.lower()]
        log(f"  cdDiscountOffer / çek tipi geçenler: {len(onemli)}")
        for t, m in onemli[:8]:
            log(f"\n--- {t}")
            log(m[:1500])
        if not onemli:
            log("  (bu tür sorgu hiç yok — istemci haritayı DB'den kurmuyor)")
            for t, m in metinler[:10]:
                log(f"\n--- {t}")
                log(m[:300])

    # ── B) TAM KOLON KIYASI ──────────────────────────────────────
    log("\n=== B) TAM KOLON KIYASI (izlemeden bağımsız) ===")
    kiyas(cur, "cdDiscountOffer", "cdDiscountOffer",
          "DiscountOfferCode = N'HCKMP'", "DiscountOfferCode = ?")
    kiyas(cur, "prDiscountOfferRules (HCKMP aşama 2)", "prDiscountOfferRules",
          "DiscountOfferCode = N'HCKMP'", "DiscountOfferCode = ?",
          ek="AND DiscountOfferStageCode = 2")
    kiyas(cur, "prDiscountOfferRules (HCKMP aşama 1)", "prDiscountOfferRules",
          "DiscountOfferCode = N'HCKMP'", "DiscountOfferCode = ?",
          ek="AND DiscountOfferStageCode = 1")

    log("\n>>> İZLE-4 TAMAM. Çıktının TAMAMINI yapıştır.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log(traceback.format_exc())
    try:
        with open("IZLE4-CIKTI.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(OUT))
        print("\n>>> IZLE4-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
