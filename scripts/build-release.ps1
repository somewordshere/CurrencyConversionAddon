$ErrorActionPreference = "Stop"

$rootDirectory = Split-Path -Parent $PSScriptRoot
Push-Location $rootDirectory

try {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw "Cross-browser build failed." }
}
finally {
    Pop-Location
}
