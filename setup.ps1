# Accent Coach setup - run once (needs Python 3.11/3.12 and Node.js):
#   powershell -ExecutionPolicy Bypass -File setup.ps1
#
# Downloads the parts that aren't ours to put in git:
#   - Kokoro voice (kokoro-onnx, Apache 2.0)                          -> models\kokoro
#   - Live2D Cubism Core (Live2D Proprietary Software License)        -> web\public
#   - Hiyori character (Live2D Free Material License)                 -> web\public\models\hiyori
# On a machine that has JARVIS / NOVA, the files are copied from there instead,
# including the recoloured Hiyori. The speech model (~1.2 GB) downloads itself on first start.
param(
  [string]$Jarvis = "$env:USERPROFILE\Pictures\jARVIS",
  [string]$NovaVoices = "$env:USERPROFILE\Documents\mars_rover_ground_station\nova_brain\voices"
)
$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
$pub = Join-Path $here "web\public"
$kdir = Join-Path $here "models\kokoro"
New-Item -ItemType Directory -Force (Join-Path $pub "models"), $kdir | Out-Null

function Fetch($url, $out) {
  New-Item -ItemType Directory -Force (Split-Path $out) | Out-Null
  "  downloading $(Split-Path $out -Leaf)"
  Invoke-WebRequest -UseBasicParsing $url -OutFile $out
}

# --- 1. Python environment
if (-not (Test-Path "$here\.venv\Scripts\python.exe")) {
  "Python environment"
  $py = (Get-Command py -ErrorAction SilentlyContinue)
  if ($py) { & py -3.12 -m venv "$here\.venv" } else { & python -m venv "$here\.venv" }
  if ($LASTEXITCODE) { throw "couldn't create the Python environment (install Python 3.12)" }
}
$vpy = "$here\.venv\Scripts\python.exe"
& $vpy -m pip install -q --upgrade pip
& $vpy -m pip install -q torch --index-url https://download.pytorch.org/whl/cpu
& $vpy -m pip install -q "transformers>=4.44,<5" fastapi uvicorn soundfile numpy kokoro-onnx "cryptography>=42" qrcode pytest httpx
if ($LASTEXITCODE) { throw "pip install failed" }

# --- 2. Kokoro voice
foreach ($f in "kokoro-v1.0.onnx", "voices-v1.0.bin") {
  $out = Join-Path $kdir $f
  if (Test-Path $out) { continue }
  $local = Join-Path $NovaVoices $f
  if (Test-Path $local) { "Kokoro ${f}: copied from NOVA"; Copy-Item $local $out }
  else { Fetch "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/$f" $out }
}

# --- 3. Live2D Cubism Core
$core = Join-Path $pub "live2dcubismcore.min.js"
if (-not (Test-Path $core)) {
  $local = Join-Path $Jarvis "gui\public\live2dcubismcore.min.js"
  if (Test-Path $local) { "Cubism Core: copied from JARVIS"; Copy-Item $local $core }
  else { Fetch "https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js" $core }
}

# --- 4. Character: the recoloured Hiyori if this machine has it, the original otherwise
$recolour = Join-Path $Jarvis "gui\public\models\hiyori-recolour"
if ((Test-Path (Join-Path $recolour "Hiyori.model3.json")) -and -not (Test-Path (Join-Path $pub "models\hiyori-recolour"))) {
  "Character: recoloured Hiyori copied from JARVIS"
  Copy-Item $recolour (Join-Path $pub "models\") -Recurse
}
$model = Join-Path $pub "models\hiyori"
if (-not (Test-Path (Join-Path $pub "models\hiyori-recolour\Hiyori.model3.json")) -and -not (Test-Path (Join-Path $model "Hiyori.model3.json"))) {
  "Character: Hiyori (Live2D sample)"
  $base = "https://raw.githubusercontent.com/Live2D/CubismWebSamples/master/Samples/Resources/Hiyori/"
  $files = @("Hiyori.model3.json", "Hiyori.moc3", "Hiyori.physics3.json", "Hiyori.pose3.json", "Hiyori.userdata3.json", "Hiyori.cdi3.json",
             "Hiyori.2048/texture_00.png", "Hiyori.2048/texture_01.png") + (1..10 | ForEach-Object { "motions/Hiyori_m{0:D2}.motion3.json" -f $_ })
  foreach ($f in $files) { Fetch ($base + $f) (Join-Path $model ($f -replace "/", "\")) }
}

# --- 5. Web app
Push-Location (Join-Path $here "web")
try {
  npm install --no-audit --no-fund; if ($LASTEXITCODE) { throw "npm install failed" }
  npm run build; if ($LASTEXITCODE) { throw "build failed" }
} finally { Pop-Location }

""
"Accent Coach is ready."
"  Laptop: double-click start.bat"
"  Phone (same Wi-Fi): double-click start-phone.bat and scan the QR code"
