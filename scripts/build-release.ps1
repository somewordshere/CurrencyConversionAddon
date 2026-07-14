$ErrorActionPreference = "Stop"

$rootDirectory = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $rootDirectory "manifest.json"
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
$releaseDirectory = Join-Path $rootDirectory "release"
$outputNames = @(
    "currency-converter-$($manifest.version).zip",
    "currency-converter-$($manifest.version)-chrome-store.zip"
)
$includedFiles = @(
    "manifest.json",
    "background/catalog.js",
    "background/rates.js",
    "background/service-worker.js",
    "content/content.js",
    "content/converter.js",
    "content/detector.js",
    "content/number-parser.js",
    "content/page-ui.js",
    "content/styles.css",
    "popup/popup.css",
    "popup/popup.html",
    "popup/popup.js",
    "shared/currencies.js",
    "shared/messages.js",
    "icons/icon16.png",
    "icons/icon32.png",
    "icons/icon48.png",
    "icons/icon128.png"
)

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

New-Item -ItemType Directory -Force -Path $releaseDirectory | Out-Null

foreach ($outputName in $outputNames) {
    $outputPath = Join-Path $releaseDirectory $outputName

    if (Test-Path -LiteralPath $outputPath) {
        Remove-Item -LiteralPath $outputPath
    }

    $archive = [System.IO.Compression.ZipFile]::Open(
        $outputPath,
        [System.IO.Compression.ZipArchiveMode]::Create
    )

    try {
        foreach ($relativePath in $includedFiles) {
            $sourcePath = Join-Path $rootDirectory $relativePath
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                $archive,
                $sourcePath,
                $relativePath.Replace("\", "/"),
                [System.IO.Compression.CompressionLevel]::Optimal
            ) | Out-Null
        }
    }
    finally {
        $archive.Dispose()
    }

    Write-Output $outputPath
}
