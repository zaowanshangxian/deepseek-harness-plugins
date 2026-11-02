@echo off
setlocal
set "DSH_HOME=L:\work\.dsh-sandbox"
set "ELECTRON_RUN_AS_NODE=1"
set "EXE=C:\Users\Administrator\AppData\Local\Programs\DeepSeek Harness\DeepSeek Harness.exe"
set "CLI=C:\Users\Administrator\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js"
if not exist "L:\work\.dsh-sandbox\.credentials.yaml" copy "C:\Users\Administrator\.dsh\.credentials.yaml" "L:\work\.dsh-sandbox\.credentials.yaml" >nul 2>&1
del /q "L:\work\.dsh-sandbox\boot.out.log" "L:\work\.dsh-sandbox\boot.err.log" 2>nul
start "dsh-sandbox" /min cmd /c ""%EXE%" --expose-internals "%CLI%" --profile sandbox --port 58111 --no-open > "L:\work\.dsh-sandbox\boot.out.log" 2>&1"
exit /b 0
