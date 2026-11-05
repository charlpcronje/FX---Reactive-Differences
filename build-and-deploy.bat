@echo off
echo Building fxdif...
deno task compile:windows

if %ERRORLEVEL% NEQ 0 (
    echo Build failed!
    exit /b %ERRORLEVEL%
)

echo Copying to c:\dev\scripts\fxdif.exe...
copy /Y dist\fxdif.exe c:\dev\scripts\fxdif.exe

if %ERRORLEVEL% NEQ 0 (
    echo Copy failed!
    exit /b %ERRORLEVEL%
)

echo Done! fxdif.exe deployed to c:\dev\scripts\
