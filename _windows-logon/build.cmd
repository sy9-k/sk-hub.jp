@echo off
rem Build: SK Hub Windows Logon (needs Visual Studio 2022 or Build Tools with "Desktop development with C++")
rem   build.cmd       -> out\SKHubCredentialProvider.dll, out\skhub-logon-setup.exe, out\harness.exe (x64)
rem   build.cmd test  -> build, then run the offline checks (harness)
rem (ASCII only: cmd.exe reads this file in the console code page)
setlocal
cd /d "%~dp0"

if not defined VCINSTALLDIR (
  for /f "usebackq delims=" %%i in (`"%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "VSDIR=%%i"
)
if not defined VCINSTALLDIR (
  if not defined VSDIR (
    echo Visual Studio C++ build tools were not found.
    exit /b 1
  )
  call "%VSDIR%\VC\Auxiliary\Build\vcvars64.bat" >nul || exit /b 1
)

set OUT=%~dp0out
if not exist "%OUT%\obj\provider" mkdir "%OUT%\obj\provider"
if not exist "%OUT%\obj\setup" mkdir "%OUT%\obj\setup"
if not exist "%OUT%\obj\test" mkdir "%OUT%\obj\test"

rem /MT: link the C runtime statically so LogonUI does not need the VC++ redistributable
set CFLAGS=/nologo /utf-8 /W4 /WX /O2 /MT /EHsc /std:c++17 /permissive- /Zi /DUNICODE /D_UNICODE /D_WIN32_WINNT=0x0A00

rc /nologo /fo "%OUT%\obj\provider\provider.res" src\provider\provider.rc || exit /b 1

cl %CFLAGS% /LD /Fo"%OUT%\obj\provider\\" /Fd"%OUT%\obj\provider\\" src\provider\dll.cpp src\provider\provider.cpp src\provider\credential.cpp src\provider\helpers.cpp src\common\skhub.cpp "%OUT%\obj\provider\provider.res" /Fe"%OUT%\SKHubCredentialProvider.dll" /link /DEF:src\provider\provider.def /DEBUG /OPT:REF /OPT:ICF advapi32.lib secur32.lib winhttp.lib bcrypt.lib shlwapi.lib ole32.lib uuid.lib user32.lib gdi32.lib || exit /b 1

cl %CFLAGS% /Fo"%OUT%\obj\setup\\" /Fd"%OUT%\obj\setup\\" src\setup\setup.cpp src\common\skhub.cpp /Fe"%OUT%\skhub-logon-setup.exe" /link /DEBUG advapi32.lib secur32.lib winhttp.lib bcrypt.lib shell32.lib ole32.lib || exit /b 1

cl %CFLAGS% /Fo"%OUT%\obj\test\\" /Fd"%OUT%\obj\test\\" src\test\harness.cpp src\provider\helpers.cpp /Fe"%OUT%\harness.exe" /link /DEBUG advapi32.lib secur32.lib shlwapi.lib ole32.lib uuid.lib user32.lib gdi32.lib || exit /b 1

echo.
echo Built: %OUT%
if /i "%~1"=="test" "%OUT%\harness.exe" "%OUT%\SKHubCredentialProvider.dll"
