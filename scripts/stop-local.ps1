$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$record=Join-Path $root '.local\launcher-process.json'
if(-not(Test-Path -LiteralPath $record)){Write-Host 'No server owned by this launcher was found. No process was stopped.';exit 0}
$owned=Get-Content -LiteralPath $record -Raw|ConvertFrom-Json
$entry=Join-Path $root 'dist-server\server\index.js'
if($owned.root -ne $root -or $owned.entry -ne $entry){throw 'Launcher ownership does not match this project.'}
$process=Get-Process -Id $owned.pid -ErrorAction SilentlyContinue
if(-not $process){Remove-Item -LiteralPath $record;Write-Host 'The local server is already stopped.';exit 0}
$actual=Get-CimInstance Win32_Process -Filter "ProcessId=$($process.Id)"
$timeDifference=[Math]::Abs(($process.StartTime.ToUniversalTime()-[DateTime]::Parse($owned.startedAt).ToUniversalTime()).TotalSeconds)
if($process.ProcessName -ne 'node' -or $timeDifference -gt 1 -or -not $actual.CommandLine.Contains('"'+$entry+'"')){throw 'The PID no longer belongs to this project. No process was stopped.'}
# Stop the verified owned process tree, including its local Codex child.
& taskkill.exe /PID $process.Id /T /F | Out-Null
if($LASTEXITCODE -ne 0){throw 'The owned local process tree could not be stopped.'}
Remove-Item -LiteralPath $record
Write-Host 'The local Liara Copilot server was stopped. Cloud resources were not changed.'
