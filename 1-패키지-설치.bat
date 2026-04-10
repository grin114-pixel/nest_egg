@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo [Nest Egg] 패키지 설치 중... (처음 한 번만 실행하면 됩니다)
call npm install
if errorlevel 1 (
  echo.
  echo 설치에 실패했습니다. Node.js가 설치되어 있는지 확인해 주세요.
  pause
  exit /b 1
)
echo.
echo 설치가 끝났습니다. 이제 "2-앱-실행.bat"을 더블클릭하세요.
pause
