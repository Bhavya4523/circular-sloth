$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$data = Get-Content (Join-Path $PSScriptRoot 'ocr_samples.json') -Raw | ConvertFrom-Json
$dir = Join-Path $env:TEMP ('circular-sloth-ocr-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $dir | Out-Null
try {
    $manifest = @()
    foreach ($sample in $data.samples) {
        $path = Join-Path $dir ($sample.id + '.png')
        $bitmap = [System.Drawing.Bitmap]::new(1600, 220)
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        $graphics.Clear([System.Drawing.Color]::White)
        $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
        $font = [System.Drawing.Font]::new('Mangal', 38, [System.Drawing.FontStyle]::Regular)
        $graphics.DrawString($sample.text, $font, [System.Drawing.Brushes]::Black, 24, 48)
        $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
        $font.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
        $manifest += [pscustomobject]@{ id=$sample.id; language=$sample.language; text=$sample.text; image=$path }
    }
    $manifestPath = Join-Path $dir 'manifest.json'
    $manifest | ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8 $manifestPath
    Push-Location (Join-Path $repo 'web')
    try { node (Join-Path $PSScriptRoot 'ocr_check.mjs') $manifestPath; if ($LASTEXITCODE -ne 0) { throw 'OCR evaluation failed.' } }
    finally { Pop-Location }
}
finally {
    $resolvedTemp = [System.IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'
    $resolvedDir = [System.IO.Path]::GetFullPath($dir)
    if (-not $resolvedDir.StartsWith($resolvedTemp, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing cleanup outside TEMP.' }
    Remove-Item -LiteralPath $resolvedDir -Recurse -Force
}
