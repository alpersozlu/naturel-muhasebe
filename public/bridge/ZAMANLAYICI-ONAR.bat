@echo off
chcp 65001 >nul
REM ============================================================
REM  NaturelSatisKopru - zamanlayici TESHIS + ONARIM (cift tikla)
REM  Bu dosya satis_kopru.py ve config.json ile AYNI klasorde durmali.
REM ============================================================
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Yonetici izni gerekiyor; birazdan bir izin penceresi acilacak, "Evet" de.
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
cd /d "%~dp0"
if not exist "config.json" (
  echo.
  echo HATA: Bu dosya kopru klasorunde degil ^(config.json yok^).
  echo Dosyayi NaturelSatisKopru klasorunun ICINE tasi, sonra tekrar cift tikla.
  echo.
  pause
  exit /b 1
)
set "KOPRU_DIR=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$m = '#PS-' + 'BEGIN#'; $s = (Get-Content -LiteralPath '%~f0' -Raw) -split $m, 2; Invoke-Expression $s[1]"
echo.
echo ============================================================
echo  BITTI. Bu klasordeki ZAMANLAYICI-ONAR-sonuc.txt dosyasini
echo  Claude'a gonder. Kapatmak icin bir tusa bas.
echo ============================================================
pause
goto :eof
#PS-BEGIN#
$ErrorActionPreference = 'Continue'
$dir = $env:KOPRU_DIR.TrimEnd('\')
Set-Location -LiteralPath $dir
$task = 'NaturelSatisKopru'
Start-Transcript -Path (Join-Path $dir 'ZAMANLAYICI-ONAR-sonuc.txt') -Force | Out-Null
Write-Host ('Tarih: ' + (Get-Date -Format 'yyyy-MM-dd HH:mm') + '  Klasor: ' + $dir)
Write-Host ('Calistiran: ' + [Security.Principal.WindowsIdentity]::GetCurrent().Name)

Write-Host ''
Write-Host '=== 1) ESKI GOREVIN DURUMU ==='
schtasks /Query /TN $task /V /FO LIST 2>&1 | Out-String | Write-Host

Write-Host '=== 2) SON LOG SATIRLARI ==='
foreach ($f in 'calistir_runner.log', 'satis_kopru.log') {
  if (Test-Path $f) { Write-Host ('--- ' + $f + '  (son yazma: ' + (Get-Item $f).LastWriteTime + ')'); Get-Content $f -Tail 25 | Out-String | Write-Host }
  else { Write-Host ('--- ' + $f + ' YOK') }
}

Write-Host '=== 3) KOPRU GUNCELLENIYOR ==='
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $u = 'https://naturel-muhasebe-7emg.vercel.app/bridge/satis_kopru.py?t=' + (Get-Random)
  Invoke-WebRequest -UseBasicParsing -Uri $u -OutFile 'satis_kopru_yeni.py'
  if ((Get-Item 'satis_kopru_yeni.py').Length -gt 20000) {
    Move-Item -Force 'satis_kopru_yeni.py' 'satis_kopru.py'
    Write-Host 'OK: kopru en guncel surume getirildi.'
  } else {
    Remove-Item 'satis_kopru_yeni.py' -ErrorAction SilentlyContinue
    Write-Host 'UYARI: indirilen dosya beklenenden kucuk; eski surum korunuyor.'
  }
} catch { Write-Host ('UYARI: indirilemedi (' + $_.Exception.Message + ') - eski surumle devam.') }

Write-Host ''
Write-Host '=== 4) CALISTIRICI DOSYALAR YAZILIYOR ==='
$bat = @'
@echo off
REM Gorev Zamanlayici bu dosyayi saatte bir calistirir. Ekran acmaz, log'a yazar.
cd /d "%~dp0"
echo ---- %date% %time% >> calistir_runner.log
where py >nul 2>&1
if %errorlevel%==0 (
  py satis_kopru.py --auto >> calistir_runner.log 2>&1
) else (
  python satis_kopru.py --auto >> calistir_runner.log 2>&1
)
'@
Set-Content -LiteralPath (Join-Path $dir 'calistir.bat') -Value $bat -Encoding ASCII
$vbs = 'Set sh = CreateObject("WScript.Shell")' + "`r`n" +
       'sh.CurrentDirectory = "' + $dir + '"' + "`r`n" +
       'rc = sh.Run("cmd /c """"' + (Join-Path $dir 'calistir.bat') + '""""", 0, True)' + "`r`n" +
       'WScript.Quit rc' + "`r`n"
Set-Content -LiteralPath (Join-Path $dir 'calistir_gizli.vbs') -Value $vbs -Encoding ASCII
Write-Host 'OK: calistir.bat + calistir_gizli.vbs'
# Log 5 MB'i gectiyse yedekle (saatlik calisma dosyayi buyutur)
foreach ($f in 'calistir_runner.log', 'satis_kopru.log') {
  if ((Test-Path $f) -and ((Get-Item $f).Length -gt 5MB)) { Move-Item -Force $f ($f + '.eski'); Write-Host ('Log yedeklendi: ' + $f) }
}

Write-Host ''
Write-Host '=== 5) GOREV YENIDEN KURULUYOR (09:00-24:00 arasi SAATTE BIR + oturum acilinca) ==='
$vbsPath = Join-Path $dir 'calistir_gizli.vbs'
$who = $null
try { $who = (Get-CimInstance Win32_ComputerSystem).UserName } catch {}
if (-not $who) { $who = [Security.Principal.WindowsIdentity]::GetCurrent().Name }
Write-Host ('Gorev kullanicisi: ' + $who)

function Register-Bridge([string]$logonType) {
  $action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('"' + $vbsPath + '"') -WorkingDirectory $dir
  $daily = New-ScheduledTaskTrigger -Daily -At '09:00'
  $rep = New-ScheduledTaskTrigger -Once -At '09:00' -RepetitionInterval (New-TimeSpan -Minutes 60) -RepetitionDuration (New-TimeSpan -Hours 15)
  $daily.Repetition = $rep.Repetition
  $logon = New-ScheduledTaskTrigger -AtLogOn
  $logon.Delay = 'PT2M'
  $set = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 45)
  $principal = New-ScheduledTaskPrincipal -UserId $who -LogonType $logonType -RunLevel Highest
  Register-ScheduledTask -TaskName $task -Action $action -Trigger $daily, $logon -Settings $set -Principal $principal -Force -ErrorAction Stop | Out-Null
}
function Run-And-Wait() {
  Start-ScheduledTask -TaskName $task
  Start-Sleep -Seconds 5
  $deadline = (Get-Date).AddMinutes(15)
  while ((Get-ScheduledTask -TaskName $task).State -eq 'Running' -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 5 }
  return (Get-ScheduledTaskInfo -TaskName $task).LastTaskResult
}

$mode = $null
$result = $null
try {
  # S4U: kullanici oturumu acik olmasa da calisir, parola saklamaz.
  Register-Bridge 'S4U'
  $mode = 'S4U (oturum kapali olsa da calisir)'
  Write-Host ('Kuruldu: ' + $mode + ' - simdi bir kez calistiriliyor, bekle...')
  $result = Run-And-Wait
  if ($result -ne 0) {
    Write-Host ('S4U calismasi sonucu: ' + $result + ' - oturum-acik moduna geciliyor.')
    Register-Bridge 'Interactive'
    $mode = 'Interactive (yalniz kullanici oturumu acikken calisir)'
    Write-Host ('Kuruldu: ' + $mode + ' - simdi bir kez calistiriliyor, bekle...')
    $result = Run-And-Wait
  }
} catch {
  Write-Host ('PowerShell ile kurulamadi (' + $_.Exception.Message + ') - schtasks ile deneniyor.')
  schtasks /Create /SC DAILY /ST 09:00 /RI 60 /DU 15:00 /TN $task /TR ('wscript.exe \"' + $vbsPath + '\"') /RL HIGHEST /F 2>&1 | Out-String | Write-Host
  $mode = 'schtasks (yalniz kullanici oturumu acikken calisir)'
  schtasks /Run /TN $task | Out-Null
  Start-Sleep -Seconds 90
}

Write-Host ''
Write-Host '=== 6) SONUC ==='
Write-Host ('Mod: ' + $mode)
Write-Host ('Son calisma sonucu (0 = basarili): ' + $result)
schtasks /Query /TN $task /V /FO LIST 2>&1 | Out-String | Write-Host
Write-Host '--- satis_kopru.log (son 30 satir)'
if (Test-Path 'satis_kopru.log') { Get-Content 'satis_kopru.log' -Tail 30 | Out-String | Write-Host }
Write-Host '--- calistir_runner.log (son 10 satir)'
if (Test-Path 'calistir_runner.log') { Get-Content 'calistir_runner.log' -Tail 10 | Out-String | Write-Host }
Stop-Transcript | Out-Null
