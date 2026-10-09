Add-Type -AssemblyName System.Drawing

function New-RoundedPath([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

function New-Icon([int]$size, [string]$path) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

  # 背景漸層
  $rect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
  $c1 = [System.Drawing.Color]::FromArgb(255, 255, 138, 0)
  $c2 = [System.Drawing.Color]::FromArgb(255, 255, 45, 85)
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $c1, $c2, 45)
  $g.FillRectangle($brush, $rect)

  # 計算機白色外框
  $pad = $size * 0.20
  $w = $size - 2 * $pad
  $h = $size - 2 * $pad
  $body = New-RoundedPath $pad $pad $w $h ($size * 0.09)
  $white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
  $g.FillPath($white, $body)

  # 顯示幕（深色）
  $dispX = $pad + $w * 0.09
  $dispH = $h * 0.20
  $dispW = $w * 0.82
  $dispY = $pad + $h * 0.10
  $disp = New-RoundedPath $dispX $dispY $dispW $dispH ($size * 0.03)
  $dark = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 26, 26, 32))
  $g.FillPath($dark, $disp)

  # 九宮格按鍵
  $cols = 3
  $rows = 3
  $gapX = $dispW / $cols
  $gapY = ($h * 0.55) / $rows
  $dotR = [Math]::Min($gapX, $gapY) * 0.26
  $startY = $pad + $h * 0.38
  $dots = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 60, 60, 70))
  for ($r = 0; $r -lt $rows; $r++) {
    for ($c = 0; $c -lt $cols; $c++) {
      $cx = $dispX + $gapX * ($c + 0.5)
      $cy = $startY + $gapY * ($r + 0.5)
      $g.FillEllipse($dots, ($cx - $dotR), ($cy - $dotR), ($dotR * 2), ($dotR * 2))
    }
  }

  $g.Dispose()
  $dir = Split-Path -Parent $path
  if (!(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Output "created $path"
}

$base = "C:\Users\ZONG\Desktop\123\icons"
New-Icon 180 "$base\icon-180.png"
New-Icon 192 "$base\icon-192.png"
New-Icon 512 "$base\icon-512.png"
