"""NEBIM KEŞİF v28 — TEST ÇEKLERİNİN SON DURUMU (salt-okunur).

A) 15 test çekinin anlık durumu (IsUsed/UsedAmount)
B) tpInvoiceDiscountOffer'daki HC kayıtları (hangi fiş, ne zaman)
Cikti: KESIF28-CIKTI.txt
"""
from __future__ import annotations

import traceback
from satis_kopru import load_config, connect

OUT = []


def log(*a):
    s = " ".join(str(x) for x in a)
    print(s)
    OUT.append(s)


def main():
    cfg = load_config()
    log(">>> KEŞİF v28 — test çeklerinin son durumu (salt-okunur)")
    conn = connect(cfg)
    cur = conn.cursor()

    log("\nA) 15 TEST ÇEKİ:")
    cur.execute("SELECT SerialNumber, Amount, UsedAmount, IsUsed, "
                "LastUpdatedUserName, LastUpdatedDate "
                "FROM cdDiscountVoucher WHERE DiscountVoucherTypeCode='HC' "
                "ORDER BY LastUpdatedDate DESC")
    for r in cur.fetchall():
        isaret = " <<< KULLANILDI!" if r[3] or (r[2] or 0) > 0 else ""
        log(f"  {r[0]} | {float(r[1]):.0f} TL | kullanılan={float(r[2]):.0f} "
            f"| IsUsed={r[3]} | son: {r[4]} {r[5]}{isaret}")

    log("\nB) tpInvoiceDiscountOffer HC KAYITLARI:")
    cur.execute("""
        SELECT t.SerialNumber, t.UsedAmount, t.IsEarned, t.CreatedDate,
               h.InvoiceNumber, h.StoreCode, h.IsCompleted
        FROM tpInvoiceDiscountOffer t WITH(NOLOCK)
        LEFT JOIN trInvoiceHeader h WITH(NOLOCK)
          ON h.InvoiceHeaderID = t.InvoiceHeaderID
        WHERE t.DiscountVoucherTypeCode = 'HC'
        ORDER BY t.CreatedDate DESC
        """)
    rows = cur.fetchall()
    if not rows:
        log("  (kayıt yok)")
    for r in rows:
        log(f"  {r[0]} | kullanılan={r[1]} | earned={r[2]} | {r[3]} | "
            f"fiş: {r[4]} ({r[5]}) tamam={r[6]}")

    log("\n>>> KEŞİF v28 TAMAM. Çıktının TAMAMINI yapıştır.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log(traceback.format_exc())
    try:
        with open("KESIF28-CIKTI.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(OUT))
        print("\n>>> KESIF28-CIKTI.txt yazildi. <<<")
    except Exception as e:
        print("yazilamadi:", e)
