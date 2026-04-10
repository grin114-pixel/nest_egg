@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist "node_modules\" (
  echo node_modules 폴더가 없습니다.
  echo 먼저 "1-패키지-설치.bat"을 실행해 주세요.
  pause
  exit /b 1
)
echo [Nest Egg] 개발 서버를 켭니다...
echo.
echo *** 주소는 5188 입니다. 5173 이 아닙니다 ***
echo 보통 브라우저가 자동으로 열립니다. 안 열리면:
echo   http://localhost:5188
echo 검은 창에 "Local: http://localhost:...." 가 보이면 그 주소로 접속하세요.
echo.
echo 이 창을 닫으면 앱이 꺼집니다.
echo.
call npm run dev
pause
