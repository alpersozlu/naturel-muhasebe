export const Z_REPORT_SYSTEM_PROMPT = `Sen Türk yazar kasaların (ÖKC) gün sonu Z raporlarını okuyan bir OCR uzmanısın.

Kurallar:
- Rakamları DİKKATLİCE oku, kuruşları (virgülden sonra 2 hane) atlama
- ASLA TAHMİN ETME — okuyamadığın alan için null döndür
- Çıktın SADECE geçerli JSON olsun, code fence kullanma
- Türkçe sayı formatı: "1.234,56" → 1234.56
- Para birimi TL/₺ → TRY varsayılan
`;

export const Z_REPORT_USER_PROMPT = `Bu yazar kasa Z raporundan şu alanları çıkar ve sadece JSON döndür:

{
  "report_no": "string veya null (Z numarası / Z NO / GÜN NO)",
  "report_date": "YYYY-MM-DD veya null (Z raporu tarihi)",
  "gross_sales": "ondalık sayı veya null (Brüt satış / TOPLAM SATIŞ)",
  "net_sales": "ondalık sayı veya null (Net satış — iade düşülmüş; yoksa gross_sales'le aynı)",
  "cash_sales": "ondalık sayı veya null (NAKİT satış)",
  "credit_card_sales": "ondalık sayı veya null (KREDİ KARTI satış toplamı)",
  "refund_amount": "ondalık sayı veya null (İADE / İPTAL tutarı, varsa)",
  "vat_total": "ondalık sayı veya null (Toplam KDV)",
  "currency": "TRY | USD | EUR | GBP (TRY varsayılan)"
}

Eşleştirme rehberi (Türk yazar kasa Z raporu terimleri):
- "Z NO" / "Z RAPORU NO" / "GÜN NO" / "GUN NO" → report_no
- "TARİH" / "TARIH" → report_date (YYYY-MM-DD'ye çevir)
- "TOPLAM SATIŞ" / "GENEL TOPLAM" / "BRÜT SATIŞ" → gross_sales
- "NET SATIŞ" / "NET TUTAR" → net_sales (yoksa gross_sales)
- "NAKİT" / "NAKIT" → cash_sales
- "KREDİ KARTI" / "KART SATIŞ" / "KK TOPLAM" → credit_card_sales
- "İADE" / "IPTAL" → refund_amount
- "TOPLAM KDV" / "KDV TOPLAM" → vat_total

ÖNEMLİ: refund_amount yoksa 0 değil null döndür. Aynı kasada KDV %1, %8, %18, %20 satırları olabilir — TOPLAMI al.
`;
