# The Liara token is read locally, never through the browser or a command argument.
# No credential is saved. Re-enter it after stopping/restarting this launcher.
param([string[]]$SourceRoot = @(), [switch]$GitHub, [switch]$CheckAuth)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path -LiteralPath 'dist-server/server/index.js')) {
    throw 'Build first: npm run build'
}
$liaraSecureInput = Read-Host 'Liara API token (hidden; local memory only)' -AsSecureString
$liaraPointer = [IntPtr]::Zero
$githubPointer = [IntPtr]::Zero
$githubSecureInput = $null
try {
    $liaraPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($liaraSecureInput)
    $env:LIARA_API_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($liaraPointer)
    if ($SourceRoot.Count -gt 0) {
        $approvedRoots = @($SourceRoot | ForEach-Object { (Resolve-Path -LiteralPath $_).Path })
        $env:LIARA_SOURCE_ROOTS = ConvertTo-Json -InputObject $approvedRoots -Compress
    }
    if ($GitHub) {
        $githubSecureInput = Read-Host 'Optional GitHub read-only token (hidden; local memory only)' -AsSecureString
        $githubPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($githubSecureInput)
        $env:LIARA_GITHUB_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($githubPointer)
    }
    # Start Node directly: the credential is not inherited by an npm helper process.
    if ($CheckAuth) {
        # Exactly two fixed read-only requests. No server, SQLite, scope switch or Codex.
        & node 'dist-server/server/check-liara-auth.js'
    } else {
        & node 'dist-server/server/index.js'
    }
    if ($LASTEXITCODE -ne 0) { throw 'Local server exited unsuccessfully.' }
} finally {
    Remove-Item Env:LIARA_API_TOKEN -ErrorAction SilentlyContinue
    Remove-Item Env:LIARA_GITHUB_TOKEN -ErrorAction SilentlyContinue
    Remove-Item Env:LIARA_SOURCE_ROOTS -ErrorAction SilentlyContinue
    if ($githubPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($githubPointer) }
    if ($null -ne $githubSecureInput) { $githubSecureInput.Dispose() }
    if ($liaraPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($liaraPointer) }
    $liaraSecureInput.Dispose()
}
