param([int]$Port=4310,[switch]$NoBrowser,[switch]$CheckOnly)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root
if($Port -lt 1024 -or $Port -gt 65535){throw 'Invalid local port.'}
# Local presentation mode never inherits a cloud credential or enables deployment.
Remove-Item Env:LIARA_API_TOKEN -ErrorAction SilentlyContinue
Remove-Item Env:LIARA_GITHUB_TOKEN -ErrorAction SilentlyContinue
Remove-Item Env:LIARA_SOURCE_ROOTS -ErrorAction SilentlyContinue
Remove-Item Env:LIARA_ENABLE_DEPLOYMENT -ErrorAction SilentlyContinue
$node=Get-Command node.exe -ErrorAction SilentlyContinue
if(-not $node){throw 'Install Node.js 26 or newer, then start again.'}
$nodeMajor=[int]((& $node.Source --version).TrimStart('v').Split('.')[0])
if($nodeMajor -lt 26){throw 'Node.js 26 or newer is required for isolated repair tests.'}
if(-not (Get-Command git.exe -ErrorAction SilentlyContinue)){throw 'Install Git for Windows, then start again.'}
if(-not (Test-Path -LiteralPath 'node_modules')){
    if($CheckOnly){throw 'Dependencies are not installed. Run Start-Liara-Copilot.cmd first.'}
    & npm.cmd ci
    if($LASTEXITCODE -ne 0){throw 'Dependency installation failed. Check the network and try again.'}
}
if(-not (Test-Path -LiteralPath 'dist-server/server/index.js') -or -not (Test-Path -LiteralPath 'dist/index.html')){
    if($CheckOnly){throw 'Build files are missing.'}
    & npm.cmd run build
    if($LASTEXITCODE -ne 0){throw 'Build failed. The local server was not started.'}
}
$codexPath=& $node.Source --input-type=module -e "import {codexExecutable} from './dist-server/server/codex-binary.js'; console.log(codexExecutable());"
if($LASTEXITCODE -ne 0){throw 'Cannot discover the Codex executable.'}
if($codexPath -eq 'codex' -and -not (Get-Command codex -ErrorAction SilentlyContinue)){throw 'Install and sign in to Codex locally before using the assistant.'}
$required=@('.local/checkout-repair-v1/original-v1.zip','.local/checkout-repair-v1/downloaded-baseline/app.mjs','.local/verification/liara-test-k-snapshot.json')
$historicalAvailable=@($required | Where-Object { -not (Test-Path -LiteralPath $_) }).Count -eq 0
if($historicalAvailable){
    if((Get-FileHash -LiteralPath $required[0] -Algorithm SHA256).Hash.ToLowerInvariant() -ne '977ea37a37ea82d759d45196589e5dad61edbbf1c8501529055037b202813db2'){throw 'The original v1 archive failed its integrity check.'}
    if((Get-FileHash -LiteralPath $required[2] -Algorithm SHA256).Hash.ToLowerInvariant() -ne '75b7d3252b71cc17b79416b1fe2ba42476525d51981608d53422e6bf170fd8c5'){throw 'The historical evidence failed its integrity check.'}
}else{Write-Host 'Optional private historical evidence is not included. The recording demo and public HTTP500 fixture are available.'}
if($CheckOnly){Write-Host 'READY: Node, Git, Codex and build are available.';exit 0}
$env:LIARA_CODEX_BIN=$codexPath
$entry=Join-Path $root 'dist-server\server\index.js'
$record=Join-Path $root '.local\launcher-process.json'
$ownsServer=$false
if(Test-Path -LiteralPath $record){
    $owned=Get-Content -LiteralPath $record -Raw|ConvertFrom-Json
    $running=Get-Process -Id $owned.pid -ErrorAction SilentlyContinue
    if($running){
        $actual=Get-CimInstance Win32_Process -Filter "ProcessId=$($running.Id)"
        $age=[Math]::Abs(($running.StartTime.ToUniversalTime()-[DateTime]::Parse($owned.startedAt).ToUniversalTime()).TotalSeconds)
        $ownsServer=($owned.root -eq $root -and $owned.entry -eq $entry -and $running.ProcessName -eq 'node' -and $age -le 1 -and $actual.CommandLine.Contains('"'+$entry+'"'))
        if(-not $ownsServer){throw 'Launcher ownership is ambiguous. No process was changed.'}
        if($owned.port -ne $Port){throw "This project is already running on port $($owned.port). Stop it with Stop-Liara-Copilot.cmd before choosing another port."}
    }
}
$url="http://127.0.0.1:$Port"
function Test-Copilot {
    try {
        $cap=Invoke-RestMethod -Uri "$url/api/session" -TimeoutSec 2
        $state=Invoke-RestMethod -Uri "$url/api/status" -Headers @{'X-Liara-Session'=$cap.token} -TimeoutSec 2
        return ($state.phase -eq 5 -and $state.capabilities.isolatedRepair -eq $true)
    } catch { return $false }
}
if($ownsServer -and (Test-Copilot)){Write-Host "Liara Copilot is already ready: $url";if(-not $NoBrowser){Start-Process -FilePath $url};exit 0}
$probe=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,$Port)
try{$probe.Start()}catch{throw "Port $Port belongs to another process. No process was stopped. Use -Port with another local port."}finally{$probe.Stop()}
$env:LIARA_PORT=[string]$Port
$entry=Join-Path $root 'dist-server\server\index.js'
$local=Join-Path $root '.local'
New-Item -ItemType Directory -Path $local -Force | Out-Null
$child=Start-Process -FilePath $node.Source -ArgumentList ('"'+$entry+'"') -WorkingDirectory $root -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $local 'local-server.log') -RedirectStandardError (Join-Path $local 'local-server-error.log')
$owned=@{pid=$child.Id;startedAt=$child.StartTime.ToUniversalTime().ToString('o');entry=$entry;root=$root;port=$Port}
$owned|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $local 'launcher-process.json') -Encoding UTF8
for($attempt=0;$attempt -lt 40;$attempt++){
    if(Test-Copilot){Write-Host "Liara Copilot is ready: $url";if(-not $NoBrowser){Start-Process -FilePath $url};exit 0}
    $child.Refresh();if($child.HasExited){throw 'Local server could not start. See .local/local-server-error.log.'}
    Start-Sleep -Milliseconds 250
}
throw 'The local server did not become ready. See .local/local-server-error.log.'
