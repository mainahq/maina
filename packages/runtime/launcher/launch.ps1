# maina launcher for Windows (v1 task 2.3; ADR 0045). PowerShell 5.1+, no modules.
#
#   launch.ps1 mcp | hook <event> | cli [args...]
#
# Same contract as launch.sh: runs the runtime pinned by manifest.json from
# $env:PLUGIN_DATA (or $env:CLAUDE_PLUGIN_DATA, or ~/.maina)\runtime\<version>,
# and otherwise downloads it once, checks its sha256 and its signature against
# release.pub.xml (next to this script), caches it and runs it. When that
# fails: hook mode prints the host's fail-closed output, MCP mode serves a
# rules-only status notice, and CLI mode exits 69.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$utf8 = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = $utf8

function Say([string]$message) { [Console]::Error.WriteLine("maina launcher: $message") }
function Out-Line([string]$line) { [Console]::Out.Write("$line`n"); [Console]::Out.Flush() }

$mode = if ($args.Count -gt 0) { [string]$args[0] } else { '' }
$rest = @(if ($args.Count -gt 1) { $args[1..($args.Count - 1)] | ForEach-Object { [string]$_ } })
$event = ''
switch -CaseSensitive ($mode) {
	'mcp' { }
	'cli' { }
	'hook' { if ($rest.Count -gt 0) { $event = $rest[0] } }
	default { $mode = '' }
}
if ($mode -eq '' -or ($mode -eq 'hook' -and $event -cnotmatch '^[A-Za-z]+$')) {
	Say 'usage: launch.ps1 mcp | hook <event> | cli [args...]'
	exit 64
}

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$manifestPath = Join-Path $here 'manifest.json'
$keyPath = Join-Path $here 'release.pub.xml'
$version = ''

# ── Degraded modes ──────────────────────────────────────────────────────────
# Keep these outputs byte-identical to src/standalone/hook-fallback.ts.

function Get-FailClosed([string]$cause) {
	$ask = "maina could not check this action ($cause); confirm it yourself."
	$ctx = "maina guardrails are unavailable ($cause); risky actions will ask for confirmation."
	switch -CaseSensitive ($event) {
		'PreToolUse' { return '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"' + $ask + '"}}' }
		'SessionStart' { return '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"' + $ctx + '"}}' }
		{ $_ -in 'beforeShellExecution', 'beforeMCPExecution', 'preToolUse' } {
			return '{"permission":"ask","user_message":"' + $ask + '","agent_message":"maina could not check this action; the user must confirm it."}'
		}
		'sessionStart' { return '{"additional_context":"' + $ctx + '"}' }
	}
	return '{}'
}

function Send-Rpc($id, $body) {
	$message = [ordered]@{ jsonrpc = '2.0'; id = $id }
	foreach ($k in $body.Keys) { $message[$k] = $body[$k] }
	Out-Line (ConvertTo-Json -InputObject $message -Compress -Depth 10)
}

function Start-RulesOnlyMcp([string]$cause) {
	$notice = "maina runtime unavailable ($cause): running in rules-only mode, so verification tools are off. Check network access to the maina release and restart the MCP server."
	$statusTool = [ordered]@{
		name = 'status'
		description = 'Why maina is running in rules-only mode.'
		inputSchema = [ordered]@{ type = 'object'; properties = @{} }
	}
	while ($null -ne ($line = [Console]::In.ReadLine())) {
		try { $msg = ConvertFrom-Json -InputObject $line } catch { continue }
		if ($null -eq $msg -or -not ($msg.PSObject.Properties.Name -contains 'id')) { continue }
		$id = $msg.id
		$params = $msg.PSObject.Properties['params']
		switch -CaseSensitive ([string]$msg.method) {
			'initialize' {
				$pv = '2024-11-05'
				if ($params -and $params.Value.protocolVersion -is [string]) { $pv = $params.Value.protocolVersion }
				Send-Rpc $id @{ result = [ordered]@{
						protocolVersion = $pv
						capabilities = @{ tools = @{} }
						serverInfo = [ordered]@{ name = 'maina'; version = $version }
						instructions = $notice
					} }
			}
			'ping' { Send-Rpc $id @{ result = @{} } }
			'tools/list' { Send-Rpc $id @{ result = @{ tools = @($statusTool) } } }
			'tools/call' {
				$isStatus = $params -and $params.Value.name -ceq 'status'
				Send-Rpc $id @{ result = [ordered]@{
						content = @([ordered]@{ type = 'text'; text = $notice })
						isError = -not $isStatus
					} }
			}
			default { Send-Rpc $id @{ error = [ordered]@{ code = -32601; message = $notice } } }
		}
	}
	exit 0
}

function Invoke-Degraded([string]$cause) {
	Say "runtime unavailable ($cause)"
	switch ($mode) {
		'hook' { Out-Line (Get-FailClosed $cause); exit 0 }
		'mcp' { Start-RulesOnlyMcp $cause }
		default { Say 'maina cannot run until its runtime installs; check network access and retry.'; exit 69 }
	}
}

# ── Manifest and cache location ─────────────────────────────────────────────

if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { Invoke-Degraded 'no_manifest' }
try { $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json } catch { Invoke-Degraded 'bad_manifest' }
$version = [string]$manifest.version
if ($version -cnotmatch '^[0-9A-Za-z.+_-]+$') { $version = ''; Invoke-Degraded 'bad_manifest' }

$os = 'windows'
if ((Test-Path variable:IsLinux) -and $IsLinux) { $os = 'linux' }
elseif ((Test-Path variable:IsMacOS) -and $IsMacOS) { $os = 'darwin' }
try { $cpu = [string][System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture }
catch { $cpu = [string]$env:PROCESSOR_ARCHITECTURE }
$arch = switch -Regex ($cpu) { '^(X64|AMD64)$' { 'x64' } '^(Arm64|ARM64)$' { 'arm64' } default { '' } }
$libc = ''
if ($os -eq 'linux' -and (Test-Path '/lib/ld-musl-*.so.1')) { $libc = '-musl' }
$target = "$os-$arch$libc"

$data = if ($env:PLUGIN_DATA) { $env:PLUGIN_DATA } elseif ($env:CLAUDE_PLUGIN_DATA) { $env:CLAUDE_PLUGIN_DATA } else { Join-Path $HOME '.maina' }
$dir = Join-Path (Join-Path $data 'runtime') $version
$bin = Join-Path $dir $(if ($os -eq 'windows') { 'maina.exe' } else { 'maina' })

function Format-Arg([string]$a) {
	if ($a -ne '' -and $a -notmatch '[\s"]') { return $a }
	$s = $a -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1'
	return '"' + $s + '"'
}

function Invoke-Runtime {
	$argv = switch ($mode) { 'mcp' { @('mcp') } 'hook' { @('hook', $event) } default { @('cli') + $rest } }
	$psi = New-Object System.Diagnostics.ProcessStartInfo
	$psi.FileName = $bin
	$psi.Arguments = ($argv | ForEach-Object { Format-Arg $_ }) -join ' '
	$psi.UseShellExecute = $false
	$proc = [System.Diagnostics.Process]::Start($psi)
	$proc.WaitForExit()
	exit $proc.ExitCode
}

if (Test-Path -LiteralPath $bin -PathType Leaf) { Invoke-Runtime }

# ── Self-heal: download, verify, cache ─────────────────────────────────────

function Install-Runtime {
	if ($arch -eq '') { return 'unsupported_platform' }
	$entry = $manifest.artifacts.PSObject.Properties[$target]
	if ($null -eq $entry) { return 'no_artifact' }
	$url = [string]$entry.Value.url
	$sum = [string]$entry.Value.sha256
	$sig = [string]$entry.Value.signature
	if ($url -notmatch '^(https://|http://127\.0\.0\.1:|http://localhost:)') { return 'bad_manifest' }
	if ($sum -cnotmatch '^[0-9a-f]{64}$') { return 'bad_manifest' }
	if ($sig -notmatch '^[A-Za-z0-9+/=]+$') { return 'bad_signature' }
	if (-not (Test-Path -LiteralPath $keyPath -PathType Leaf)) { return 'no_release_key' }
	try { New-Item -ItemType Directory -Force -Path $dir | Out-Null } catch { return 'cache_unwritable' }

	# Download next to the final path, so the install is one rename.
	$tmp = Join-Path $dir ".maina.$PID.part"
	try {
		try {
			[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
			Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $tmp -TimeoutSec 300
		} catch { return 'download_failed' }
		if ((Get-FileHash -Algorithm SHA256 -LiteralPath $tmp).Hash.ToLowerInvariant() -cne $sum) { return 'checksum_mismatch' }
		try {
			$rsa = [System.Security.Cryptography.RSA]::Create()
			$rsa.FromXmlString((Get-Content -LiteralPath $keyPath -Raw))
			$ok = $rsa.VerifyData([IO.File]::ReadAllBytes($tmp), [Convert]::FromBase64String($sig),
				[Security.Cryptography.HashAlgorithmName]::SHA256, [Security.Cryptography.RSASignaturePadding]::Pkcs1)
		} catch { $ok = $false }
		if (-not $ok) { return 'bad_signature' }
		try {
			if ($os -ne 'windows') { [IO.File]::SetUnixFileMode($tmp, [IO.UnixFileMode]'UserRead, UserWrite, UserExecute, GroupRead, GroupExecute, OtherRead, OtherExecute') }
			Move-Item -LiteralPath $tmp -Destination $bin -Force
		} catch { if (-not (Test-Path -LiteralPath $bin -PathType Leaf)) { return 'cache_unwritable' } }
		return ''
	} finally {
		Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
	}
}

$reason = Install-Runtime
if ($reason -eq '') { Invoke-Runtime }
Invoke-Degraded $reason
