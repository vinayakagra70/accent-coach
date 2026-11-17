# Builds the Accent Coach listener and puts it on Google Cloud Run.
# Run from anywhere:  powershell -ExecutionPolicy Bypass -File cloudrun\deploy.ps1
# Needs the Google Cloud CLI (gcloud), signed in, with a project selected.
param(
    [string]$Region = "asia-south1",   # Mumbai, closest to Indian users
    [string]$Service = "accent-coach-listener"
)
$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
$root = Split-Path $here -Parent

# The listener code lives in space/ and server/; the image is built from this folder.
Copy-Item "$root\space\space_app.py", "$root\server\recognizer.py" -Destination $here -Force

# The build downloads PyTorch and the 1.2 GB model; give it more than the default 10 minutes.
gcloud config set builds/timeout 1800

gcloud run deploy $Service `
    --source $here `
    --region $Region `
    --allow-unauthenticated `
    --memory 4Gi `
    --cpu 2 `
    --cpu-boost `
    --concurrency 4 `
    --min-instances 0 `
    --max-instances 2 `
    --timeout 120

Write-Host ""
Write-Host "Done. The address is the 'Service URL' above. Check it with <Service URL>/health"
