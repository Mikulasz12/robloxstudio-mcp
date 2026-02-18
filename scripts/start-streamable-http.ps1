param(
  [string]$McpHost = "127.0.0.1",
  [int]$McpPort = 59000,
  [string]$McpPath = "/mcp",
  [int]$StudioPort = 58741,
  [int]$StudioPortRetryCount = 1,
  [switch]$UseNpx,
  [string]$PackageVersion = "latest"
)

$ErrorActionPreference = "Stop"

$env:MCP_TRANSPORT = "streamable-http"
$env:MCP_HTTP_HOST = $McpHost
$env:MCP_HTTP_PORT = [string]$McpPort
$env:MCP_HTTP_PATH = $McpPath
$env:ROBLOX_STUDIO_PORT = [string]$StudioPort
$env:ROBLOX_STUDIO_PORT_RETRY_COUNT = [string]$StudioPortRetryCount

if ($UseNpx) {
  Write-Host "Starting robloxstudio-mcp via npx in Streamable HTTP mode..."
  & cmd /c npx -y "robloxstudio-mcp@$PackageVersion" --streamable-http
  exit $LASTEXITCODE
}

$root = Split-Path -Parent $PSScriptRoot
$distEntry = Join-Path $root "dist/index.js"

if (-not (Test-Path $distEntry)) {
  Write-Error "dist/index.js not found. Run 'npm run build' first, or use -UseNpx."
}

Write-Host "Starting local robloxstudio-mcp (dist/index.js) in Streamable HTTP mode..."
& node $distEntry --streamable-http
exit $LASTEXITCODE
