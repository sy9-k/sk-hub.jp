@echo off
rem Build: SK Hub Windows Logon (needs Visual Studio 2022 or Build Tools with "Desktop development with C++")
rem   build.cmd       -> out\SKHubCredentialProvider.dll, out\SKHubLogonSettings.exe (settings window),
rem                      out\skhub-logon-setup.exe (command line), out\harness.exe (x64)
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
for %%d in (provider setup settings preview test) do if not exist "%OUT%\obj\%%d" mkdir "%OUT%\obj\%%d"

rem /MT: link the C runtime statically so LogonUI does not need the VC++ redistributable
set CFLAGS=/nologo /utf-8 /W4 /WX /O2 /MT /EHsc /std:c++17 /permissive- /Zi /DUNICODE /D_UNICODE /DNOMINMAX /D_WIN32_WINNT=0x0A00
set COMMON=src\common\skhub.cpp src\common\qr.cpp
set LIBS=advapi32.lib secur32.lib winhttp.lib bcrypt.lib shell32.lib shlwapi.lib ole32.lib uuid.lib user32.lib gdi32.lib netapi32.lib
set COMCTL6=/MANIFESTDEPENDENCY:"type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'"

rem Credential Provider (loaded by the sign-in screen)
rc /nologo /fo "%OUT%\obj\provider\provider.res" src\provider\provider.rc || exit /b 1
cl %CFLAGS% /LD /Fo"%OUT%\obj\provider\\" /Fd"%OUT%\obj\provider\\" src\provider\dll.cpp src\provider\provider.cpp src\provider\credential.cpp src\provider\helpers.cpp src\provider\qrwindow.cpp %COMMON% "%OUT%\obj\provider\provider.res" /Fe"%OUT%\SKHubCredentialProvider.dll" /link /DEF:src\provider\provider.def /DEBUG /OPT:REF /OPT:ICF %LIBS% || exit /b 1

rem Settings window (asks for administrator rights when it starts)
rc /nologo /fo "%OUT%\obj\settings\settings.res" src\settings\settings.rc || exit /b 1
cl %CFLAGS% /Fo"%OUT%\obj\settings\\" /Fd"%OUT%\obj\settings\\" src\settings\settings.cpp src\common\admin.cpp %COMMON% "%OUT%\obj\settings\settings.res" /Fe"%OUT%\SKHubLogonSettings.exe" /link /DEBUG /SUBSYSTEM:WINDOWS /MANIFESTUAC:"level='requireAdministrator' uiAccess='false'" %COMCTL6% %LIBS% comctl32.lib uxtheme.lib || exit /b 1

rem Settings window for screenshots only (no administrator rights, changes nothing): SKHubLogonSettings-preview.exe --snapshot <dir>
cl %CFLAGS% /DSKHUB_PREVIEW /Fo"%OUT%\obj\preview\\" /Fd"%OUT%\obj\preview\\" src\settings\settings.cpp src\common\admin.cpp %COMMON% "%OUT%\obj\settings\settings.res" /Fe"%OUT%\obj\preview\SKHubLogonSettings-preview.exe" /link /SUBSYSTEM:WINDOWS %COMCTL6% %LIBS% comctl32.lib uxtheme.lib || exit /b 1

rem Command line tool
cl %CFLAGS% /Fo"%OUT%\obj\setup\\" /Fd"%OUT%\obj\setup\\" src\setup\setup.cpp src\common\admin.cpp %COMMON% /Fe"%OUT%\skhub-logon-setup.exe" /link /DEBUG %LIBS% || exit /b 1

rem Offline checks
cl %CFLAGS% /Fo"%OUT%\obj\test\\" /Fd"%OUT%\obj\test\\" src\test\harness.cpp src\provider\helpers.cpp src\provider\qrwindow.cpp %COMMON% /Fe"%OUT%\harness.exe" /link /DEBUG %LIBS% || exit /b 1

echo.
echo Built: %OUT%
if /i "%~1"=="test" "%OUT%\harness.exe" "%OUT%\SKHubCredentialProvider.dll"
