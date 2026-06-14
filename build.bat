@echo off
SETLOCAL
CD /D "%~dp0"

set src_dir=MV3-vanilla-js-src
set zip_file=storage-area-explorer-MV3-vanilla-js-v2.0.0.zip

if exist build rmdir /Q /S build
mkdir build

pushd "%src_dir%"
7za a "..\build\%zip_file%" *
popd

if not "%DoNotPause%"=="yes" pause
