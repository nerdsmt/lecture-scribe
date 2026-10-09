# Lecture Scribe installer for Windows (PowerShell). Safe to run again.
# If scripts are blocked, run:  powershell -ExecutionPolicy Bypass -File .\install.ps1
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "local-server")

$py = $null
$candidates = @(
  @{ exe = "py";      pre = @("-3") },
  @{ exe = "python";  pre = @() },
  @{ exe = "python3"; pre = @() }
)
foreach ($c in $candidates) {
  if (-not (Get-Command $c.exe -ErrorAction SilentlyContinue)) { continue }
  $args2 = @($c.pre) + @("-c", "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)")
  & $c.exe @args2 2>$null
  if ($LASTEXITCODE -eq 0) { $py = $c; break }
}
if (-not $py) {
  Write-Host "Python 3.10 or newer is needed. Install it from https://www.python.org/downloads/ (tick 'Add python.exe to PATH') and run this again."
  exit 1
}

if (-not (Test-Path ".venv")) { $venvArgs = @($py.pre) + @("-m", "venv", ".venv"); & $py.exe @venvArgs }
$venvPy = ".venv\Scripts\python.exe"
& $venvPy -m pip install --quiet --upgrade pip
Write-Host "Installing speech-recognition packages (a few minutes the first time)..."
& $venvPy -m pip install -r requirements.txt
if ($LASTEXITCODE -ne 0) { Write-Host "Package install failed."; exit 1 }

Write-Host ""
& $venvPy server.py --init
Write-Host ""
Write-Host "Downloading the speech model (one time; 150 MB to 1.5 GB depending on the model)..."
& $venvPy server.py --download-model
Write-Host ""
Write-Host "Done. Start the server by double-clicking local-server\start.bat"
Write-Host "Then load the extension (see README) and paste the token shown above into its Options."
