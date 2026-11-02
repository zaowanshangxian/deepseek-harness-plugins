@echo off
setlocal
set "DSH_HOME=L:\DSH\work\.dsh-sandbox"
set "ELECTRON_RUN_AS_NODE=1"
set "EXE=C:\Users\Administrator\AppData\Local\Programs\DeepSeek Harness\DeepSeek Harness.exe"
set "CLI=C:\Users\Administrator\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js"
set "TGZ=L:\DSH\work\.release\dsh-plugin-tool-tax-0.1.0.tgz"
"%EXE%" --expose-internals "%CLI%" plugin --profile sandbox add "%TGZ%" > "L:\DSH\work\logs\sandbox-install.log" 2>&1
echo exit=%ERRORLEVEL%
type "L:\DSH\work\logs\sandbox-install.log"
