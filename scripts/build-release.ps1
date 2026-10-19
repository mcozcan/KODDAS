$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
try {
  node --test tests/*.test.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Testler başarısız; release oluşturulmadı.' }

  $package = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
  $targetDirectory = $env:CARGO_TARGET_DIR
  if (-not $targetDirectory) { $targetDirectory = Join-Path $projectRoot 'src-tauri\target-release' }
  $env:CARGO_TARGET_DIR = $targetDirectory

  npm run tauri -- build --no-bundle
  if ($LASTEXITCODE -ne 0) { throw 'Tauri derlemesi başarısız.' }

  $builtExe = Join-Path $targetDirectory 'release\koddas.exe'
  if (-not (Test-Path -LiteralPath $builtExe)) { throw "Derlenmiş exe bulunamadı: $builtExe" }
  $releaseDirectory = Join-Path $projectRoot 'release'
  New-Item -ItemType Directory -Path $releaseDirectory -Force | Out-Null
  $releaseExe = Join-Path $releaseDirectory "KODDAS-$($package.version).exe"
  $copied = $false
  for ($attempt = 1; $attempt -le 6; $attempt++) {
    try {
      Copy-Item -LiteralPath $builtExe -Destination $releaseExe -Force
      $copied = $true
      break
    }
    catch {
      if ($attempt -eq 6) { throw }
      Start-Sleep -Seconds 2
    }
  }
  if (-not $copied) { throw "Yeni release exe kopyalanamadı: $releaseExe" }
  Get-ChildItem -LiteralPath $releaseDirectory -Filter 'KODDAS-*.exe' -File | Where-Object { $_.FullName -ne $releaseExe } | Remove-Item -Force
  Write-Output "Standalone release ready: $releaseExe"
}
finally {
  Pop-Location
}
