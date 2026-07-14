param(
    [Parameter(Mandatory = $true)]
    [string]$InputPath,

    [Parameter(Mandatory = $true)]
    [string]$OutputDirectory
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

function New-RoundedRectanglePath {
    param(
        [System.Drawing.RectangleF]$Rectangle,
        [float]$Radius
    )

    $diameter = $Radius * 2
    $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $path.AddArc($Rectangle.X, $Rectangle.Y, $diameter, $diameter, 180, 90)
    $path.AddArc($Rectangle.Right - $diameter, $Rectangle.Y, $diameter, $diameter, 270, 90)
    $path.AddArc($Rectangle.Right - $diameter, $Rectangle.Bottom - $diameter, $diameter, $diameter, 0, 90)
    $path.AddArc($Rectangle.X, $Rectangle.Bottom - $diameter, $diameter, $diameter, 90, 90)
    $path.CloseFigure()
    return $path
}

function Export-Icon {
    param(
        [System.Drawing.Bitmap]$Source,
        [System.Drawing.Rectangle]$SourceRectangle,
        [int]$CanvasSize,
        [int]$ArtworkSize,
        [string]$OutputPath
    )

    $bitmap = [System.Drawing.Bitmap]::new(
        $CanvasSize,
        $CanvasSize,
        [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
    )
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)

    try {
        $graphics.Clear([System.Drawing.Color]::Transparent)
        $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

        $offset = [float](($CanvasSize - $ArtworkSize) / 2)
        $artRectangle = [System.Drawing.RectangleF]::new(
            $offset,
            $offset,
            [float]$ArtworkSize,
            [float]$ArtworkSize
        )
        $cornerRadius = [Math]::Max(1.5, $ArtworkSize * 0.22)
        $clipPath = New-RoundedRectanglePath -Rectangle $artRectangle -Radius $cornerRadius

        try {
            $graphics.SetClip($clipPath)
            $graphics.DrawImage(
                $Source,
                $artRectangle,
                $SourceRectangle,
                [System.Drawing.GraphicsUnit]::Pixel
            )
            $graphics.ResetClip()
        }
        finally {
            $clipPath.Dispose()
        }

        $bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

$source = [System.Drawing.Bitmap]::FromFile((Resolve-Path -LiteralPath $InputPath))

try {
    # The generated source includes a centered rounded-square container.
    # Crop to that container before producing the extension assets.
    $cropSize = [int][Math]::Round([Math]::Min($source.Width, $source.Height) * 0.817)
    $cropX = [int][Math]::Round(($source.Width - $cropSize) / 2)
    $cropY = [int][Math]::Round(($source.Height - $cropSize) / 2)
    $sourceRectangle = [System.Drawing.Rectangle]::new($cropX, $cropY, $cropSize, $cropSize)

    Export-Icon $source $sourceRectangle 1024 1024 (Join-Path $OutputDirectory "icon1024.png")
    Export-Icon $source $sourceRectangle 512 512 (Join-Path $OutputDirectory "icon512.png")
    Export-Icon $source $sourceRectangle 128 96 (Join-Path $OutputDirectory "icon128.png")
    Export-Icon $source $sourceRectangle 48 48 (Join-Path $OutputDirectory "icon48.png")
    Export-Icon $source $sourceRectangle 32 32 (Join-Path $OutputDirectory "icon32.png")
    Export-Icon $source $sourceRectangle 16 16 (Join-Path $OutputDirectory "icon16.png")
}
finally {
    $source.Dispose()
}
