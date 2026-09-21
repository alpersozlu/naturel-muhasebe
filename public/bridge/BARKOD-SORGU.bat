@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist "config.json" (
  echo HATA: Bu dosya kopru klasorunde degil ^(config.json yok^).
  echo Dosyayi NaturelSatisKopru klasorunun ICINE tasi, sonra tekrar cift tikla.
  pause
  exit /b 1
)
echo ============================================================
echo  Barkod bilgileri Nebim'den OKUNUYOR (yalniz okuma, degisiklik yok)
echo ============================================================
curl -L -f -s -o BARKOD-SORGU.py "https://naturel-muhasebe-7emg.vercel.app/bridge/BARKOD-SORGU.py?t=%RANDOM%%RANDOM%"
if errorlevel 1 (
  echo HATA: sorgu dosyasi indirilemedi. Internet baglantisini kontrol et.
  pause
  exit /b 1
)
where py >nul 2>&1
if %errorlevel%==0 (py BARKOD-SORGU.py) else (python BARKOD-SORGU.py)
echo.
echo ============================================================
echo  Bitti. Bu klasordeki BARKOD-SORGU-sonuc.csv dosyasini Claude'a gonder.
echo ============================================================
pause
