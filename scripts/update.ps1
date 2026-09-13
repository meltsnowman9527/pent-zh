# Build current source, then replace the application in the original stack.
# No second deployment or backup is created.
param([switch]$DeployOnly)

$ErrorActionPreference = 'Stop'
$workspace = Split-Path $PSScriptRoot -Parent
$envFile = Join-Path $workspace '.env'
if (-not (Test-Path -LiteralPath $envFile)) { throw '缺少原部署配置 .env。' }

if (-not $DeployOnly) {
    Push-Location (Join-Path $workspace 'frontend')
    try {
        & pnpm build
        if ($LASTEXITCODE -ne 0) { throw '前端构建失败，尚未更新运行中的应用。' }
    } finally { Pop-Location }

    & docker build --pull=false -f (Join-Path $workspace 'Dockerfile.local') -t pentagi-local:latest $workspace
    if ($LASTEXITCODE -ne 0) { throw '构建失败，尚未更新运行中的应用。' }
} else {
    $null = & docker image inspect pentagi-local:latest
    if ($LASTEXITCODE -ne 0) { throw '尚无本地构建镜像，请先完整执行更新脚本。' }
}

$config = [System.IO.File]::ReadAllText($envFile)
if ($config -match '(?m)^PENTAGI_IMAGE=') {
    $config = [regex]::Replace($config, '(?m)^PENTAGI_IMAGE=[^\r\n]*', 'PENTAGI_IMAGE=pentagi-local:latest')
} else {
    $config = $config.TrimEnd() + "`r`nPENTAGI_IMAGE=pentagi-local:latest`r`n"
}
[System.IO.File]::WriteAllText($envFile, $config, [System.Text.UTF8Encoding]::new($false))

# Reuse the original project name and volumes. The old application container
# is replaced under the same name; no parallel application is kept.
$previousImage = $env:PENTAGI_IMAGE
try {
    $env:PENTAGI_IMAGE = 'pentagi-local:latest'
    & docker compose --project-name pentagi --project-directory $workspace --env-file $envFile -f (Join-Path $workspace 'docker-compose.yml') up -d --pull never
    if ($LASTEXITCODE -ne 0) { throw '更新未完成，请检查原部署服务状态。' }
} finally {
    $env:PENTAGI_IMAGE = $previousImage
}
Write-Host '已更新原部署，请访问 https://localhost:8443。'
