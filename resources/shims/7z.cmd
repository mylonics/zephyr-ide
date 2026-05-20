@echo off
rem Zephyr IDE: 7z shim -- delegates 7z x extraction to Windows bsdtar (libarchive).
rem Windows 11 ships with bsdtar which natively supports .7z archives, so no
rem separate 7-Zip install is required on modern machines.
rem
rem Translates: 7z x <archive> [-o<outdir>] [-y]  ->  tar -xf <archive> [-C <outdir>]
rem The Zephyr SDK setup.cmd uses exactly this form when extracting toolchain archives.

if /i "%1" neq "x" (
  echo 7z shim: unsupported command %1 1>&2
  exit /b 1
)

setlocal enabledelayedexpansion
set "ARCHIVE="
set "OUTDIR="
shift

:loop
if "%~1"=="" goto :run
set "ARG=%~1"
if /i "!ARG:~0,2!"=="-o" (set "OUTDIR=!ARG:~2!" & shift & goto :loop)
if /i "!ARG!"=="-y" (shift & goto :loop)
if not defined ARCHIVE (set "ARCHIVE=%~1" & shift & goto :loop)
shift
goto :loop

:run
if not defined ARCHIVE (echo 7z shim: no archive specified 1>&2 & exit /b 1)
if defined OUTDIR (
  tar -xf "!ARCHIVE!" -C "!OUTDIR!"
) else (
  tar -xf "!ARCHIVE!"
)
exit /b %errorlevel%
