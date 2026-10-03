#!/usr/bin/env bash
# Yayın sonrası duman testi — her push'tan sonra, "bitti" demeden ÖNCE çalıştır.
#
# Neden var: 03.10.2026'da yerelde ve derlemede sorunsuz olan bir değişiklik
# Vercel'de API rotasının yüklenmesini engelledi; bütün istekler 73 dakika
# boyunca "500 <!DOCTYPE…" döndü ve bunu ekrandaki hata gösterdi, biz değil.
# Giriş sayfasının açılması API'nin ayakta olduğunu GÖSTERMEZ.
#
#   scripts/smoke-prod.sh            → canlı adres
#   scripts/smoke-prod.sh <adres>    → başka bir adres
set -u
BASE="${1:-https://naturel-muhasebe-7emg.vercel.app}"
fail=0
check() { # ad, yol, yanıtta aranacak metin
  local body code
  body=$(curl -s -m 45 -w '\n%{http_code}' "$BASE$2") || { echo "✗ $1: bağlantı kurulamadı"; fail=1; return; }
  code=${body##*$'\n'}; body=${body%$'\n'*}
  if [ "$code" = "200" ] && printf '%s' "$body" | grep -q "$3"; then
    echo "✓ $1"
  else
    echo "✗ $1: HTTP $code — $(printf '%s' "$body" | head -c 200)"; fail=1
  fi
}
check "API ayakta (tRPC rotası yükleniyor)" "/api/trpc/health" '"ok":true'
check "PDF okunabiliyor (pdf.js sunucuda yükleniyor)" "/api/trpc/healthPdf" '"ok":true'
[ "$fail" = "0" ] && echo "Duman testi geçti: $BASE" || { echo "DUMAN TESTİ BAŞARISIZ: $BASE"; exit 1; }
