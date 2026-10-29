<#
  Builds the Windows launcher.
  Requires: .NET Framework 4.x (csc.exe ships with Windows), the web bundle in ..\dist,
  and the WebView2 SDK assemblies (Microsoft.Web.WebView2).
  Pass -WebView2Dir pointing at a folder containing
  Microsoft.Web.WebView2.Core.dll and Microsoft.Web.WebView2.WinForms.dll (net462 build)
  and, in ..\..\runtimes\win-x64\native\, WebView2Loader.dll (part of the same NuGet package).
#>
param(
  [string]$WebView2Dir = "",
  [string]$Configuration = "Release",
  [string]$OutputDir = ""
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$webDist = Join-Path $here "..\dist"
$iconIco = Join-Path $here "..\brand\icon.ico"
$out = if ($OutputDir) { $OutputDir } else { Join-Path $here "build" }

if (-not (Test-Path (Join-Path $webDist "index.html"))) {
  throw "Web bundle not found at $webDist. Run 'npm run build' in the repository root first."
}

if (-not $WebView2Dir) {
  $candidates = Get-ChildItem "$env:USERPROFILE\.nuget\packages\microsoft.web.webview2\*\lib\net462" -Directory -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending
  if ($candidates) { $WebView2Dir = $candidates[0].FullName }
}
if (-not $WebView2Dir -or -not (Test-Path (Join-Path $WebView2Dir "Microsoft.Web.WebView2.Core.dll"))) {
  throw "Microsoft.Web.WebView2 assemblies not found. Pass -WebView2Dir <path to lib\net462>."
}

New-Item -ItemType Directory -Force $out | Out-Null
$zip = Join-Path $out "web.zip"
Remove-Item $zip -Force -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $webDist "*") -DestinationPath $zip -Force

$csc = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$exePath = Join-Path $out "PassWordCreaterManager.exe"
$coreDll = Join-Path $WebView2Dir "Microsoft.Web.WebView2.Core.dll"
$winFormsDll = Join-Path $WebView2Dir "Microsoft.Web.WebView2.WinForms.dll"
$launcher = Join-Path $here "src\Launcher.cs"
$cscArgs = @(
  "/nologo", "/target:winexe", "/optimize+",
  "/out:$exePath",
  "/resource:$zip,web.zip",
  "/win32icon:$iconIco",
  "/r:System.dll", "/r:System.Drawing.dll", "/r:System.Windows.Forms.dll",
  "/r:System.IO.Compression.dll", "/r:System.IO.Compression.FileSystem.dll",
  "/r:$coreDll", "/r:$winFormsDll",
  $launcher
)
& $csc @cscArgs
if ($LASTEXITCODE -ne 0) { throw "csc failed with exit code $LASTEXITCODE" }

Copy-Item (Join-Path $WebView2Dir "Microsoft.Web.WebView2.Core.dll") $out -Force
Copy-Item (Join-Path $WebView2Dir "Microsoft.Web.WebView2.WinForms.dll") $out -Force
$loader = Get-ChildItem (Join-Path $WebView2Dir "..\..\runtimes\win-x64\native\WebView2Loader.dll") -ErrorAction SilentlyContinue
if ($loader) { Copy-Item $loader.FullName $out -Force }
Remove-Item $zip -Force -ErrorAction SilentlyContinue

Get-ChildItem $out -File | Select-Object Name, Length | Format-Table -AutoSize | Out-String -Width 80
