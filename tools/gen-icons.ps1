# 生成插件图标（无需依赖第三方库，使用 .NET System.Drawing）
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root 'icons'
New-Item -ItemType Directory -Force -Path $out | Out-Null

function New-RoundedRectPath {
  param([int]$W, [int]$H, [int]$R)
  $d = $R * 2
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddArc(0, 0, $d, $d, 180, 90)
  $path.AddArc($W - $d, 0, $d, $d, 270, 90)
  $path.AddArc($W - $d, $H - $d, $d, $d, 0, 90)
  $path.AddArc(0, $H - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  return $path
}

foreach ($size in 16, 32, 48, 128) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g.Clear([System.Drawing.Color]::Transparent)

  $rect = New-Object System.Drawing.Rectangle 0, 0, $size, $size
  $radius = [int][Math]::Round($size * 0.26)
  $path = New-RoundedRectPath -W $size -H $size -R $radius
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, `
    ([System.Drawing.Color]::FromArgb(255, 79, 124, 255)), `
    ([System.Drawing.Color]::FromArgb(255, 124, 77, 255)), 45
  $g.FillPath($brush, $path)

  $fontSize = [float]($size * 0.56)
  $fontStyle = [System.Drawing.FontStyle]::Bold
  $unit = [System.Drawing.GraphicsUnit]::Pixel
  $font = New-Object System.Drawing.Font 'Microsoft YaHei', $fontSize, $fontStyle, $unit
  $sf = New-Object System.Drawing.StringFormat
  $sf.Alignment = [System.Drawing.StringAlignment]::Center
  $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
  $textRect = New-Object System.Drawing.RectangleF 0, ($size * 0.06), $size, $size
  $glyph = [char]0x8BD1 # 译
  $g.DrawString($glyph, $font, (New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)), $textRect, $sf)

  $file = Join-Path $out ("icon{0}.png" -f $size)
  $bmp.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  Write-Host "生成 $file"
}
