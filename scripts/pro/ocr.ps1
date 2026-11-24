# Windows' built-in OCR (Windows.Media.Ocr, en-US) for the broadcast reader (BOT-PRO.md P4, scripts/pro/stream.ts).
# Reads one image path per line on stdin and writes one JSON line per image: { "path", "lines": [{ "text", "x", "y",
# "w", "h" }] } in the image's pixels, each line's box the union of its words'. One process serves a whole video.
#   Get-Content paths.txt | powershell -NoProfile -File scripts/pro/ocr.ps1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  })[0]
function Await($op, [Type]$type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  $task.Wait(-1) | Out-Null
  $task.Result
}
$null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]
$lang = New-Object Windows.Globalization.Language 'en-US'
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($lang)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
while ($null -ne ($path = [Console]::In.ReadLine())) {
  if (-not $path.Trim()) { continue }
  $full = (Resolve-Path $path).Path
  $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($full)) ([Windows.Storage.StorageFile])
  $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
  $lines = @()
  foreach ($line in $result.Lines) {
    $x1 = [double]::MaxValue; $y1 = [double]::MaxValue; $x2 = 0; $y2 = 0
    foreach ($w in $line.Words) {
      $r = $w.BoundingRect
      $x1 = [Math]::Min($x1, $r.X); $y1 = [Math]::Min($y1, $r.Y)
      $x2 = [Math]::Max($x2, $r.X + $r.Width); $y2 = [Math]::Max($y2, $r.Y + $r.Height)
    }
    $lines += [ordered]@{ text = $line.Text; x = [int]$x1; y = [int]$y1; w = [int]($x2 - $x1); h = [int]($y2 - $y1) }
  }
  $stream.Dispose()
  [Console]::Out.WriteLine((ConvertTo-Json -Compress -Depth 4 ([ordered]@{ path = $path; lines = $lines })))
  [Console]::Out.Flush()
}
