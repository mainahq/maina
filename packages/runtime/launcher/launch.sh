#!/bin/sh
# maina launcher (v1 task 2.3; ADR 0045). POSIX sh, no dependencies.
#
#   launch.sh mcp | hook <event> | cli [args...]
#
# Runs the maina runtime pinned by manifest.json, cached at
# ${PLUGIN_DATA:-${CLAUDE_PLUGIN_DATA:-$HOME/.maina}}/runtime/<version>/maina.
# When it is missing, downloads it once, checks its sha256 and its signature
# against release.pub.pem (next to this script), caches it and runs it.
# When that fails: hook mode prints the host's fail-closed output, MCP mode
# serves a rules-only status notice, and CLI mode exits 69.

set -u
umask 077

say() { printf 'maina launcher: %s\n' "$*" >&2; }

usage() {
	say "usage: launch.sh mcp | hook <event> | cli [args...]"
	exit 64
}

mode=${1:-}
[ $# -gt 0 ] && shift
event=
case $mode in
mcp | cli) ;;
hook)
	event=${1:-}
	case $event in '' | *[!A-Za-z]*) usage ;; esac
	;;
*) usage ;;
esac

here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P) || exit 70
manifest=$here/manifest.json
pubkey=$here/release.pub.pem
reason=

# ── Degraded modes ──────────────────────────────────────────────────────────
# Keep these outputs byte-identical to src/standalone/hook-fallback.ts.

fail_closed() {
	ask="maina could not check this action ($1); confirm it yourself."
	ctx="maina guardrails are unavailable ($1); risky actions will ask for confirmation."
	case $event in
	PreToolUse)
		printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"%s"}}\n' "$ask" ;;
	SessionStart)
		printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' "$ctx" ;;
	beforeShellExecution | beforeMCPExecution | preToolUse)
		printf '{"permission":"ask","user_message":"%s","agent_message":"maina could not check this action; the user must confirm it."}\n' "$ask" ;;
	sessionStart)
		printf '{"additional_context":"%s"}\n' "$ctx" ;;
	*) printf '{}\n' ;;
	esac
}

# First match of `"key": <string or integer>` in $2 (raw JSON token).
json_token() {
	printf '%s\n' "$2" | awk -v k="\"$1\"" '{
		if (match($0, k "[ \t]*:[ \t]*(\"[^\"\\\\]*\"|-?[0-9]+)")) {
			s = substr($0, RSTART, RLENGTH); sub(/^"[^"]*"[ \t]*:[ \t]*/, "", s); print s
		}
		exit
	}'
}

reply() { printf '{"jsonrpc":"2.0","id":%s,"result":%s}\n' "$1" "$2"; }

rules_only_mcp() {
	notice="maina runtime unavailable ($1): running in rules-only mode, so verification tools are off. Check network access to the maina release and restart the MCP server."
	status_tool='{"name":"status","description":"Why maina is running in rules-only mode.","inputSchema":{"type":"object","properties":{}}}'
	while IFS= read -r line || [ -n "$line" ]; do
		id=$(json_token id "$line")
		[ -n "$id" ] || continue # a notification: nothing to answer
		method=$(json_token method "$line")
		case $method in
		'"initialize"')
			pv=$(json_token protocolVersion "$line")
			case $pv in '"'*'"') ;; *) pv='"2024-11-05"' ;; esac
			reply "$id" "{\"protocolVersion\":$pv,\"capabilities\":{\"tools\":{}},\"serverInfo\":{\"name\":\"maina\",\"version\":\"$version\"},\"instructions\":\"$notice\"}" ;;
		'"ping"') reply "$id" '{}' ;;
		'"tools/list"') reply "$id" "{\"tools\":[$status_tool]}" ;;
		'"tools/call"')
			err=true
			[ "$(json_token name "$line")" = '"status"' ] && err=false
			reply "$id" "{\"content\":[{\"type\":\"text\",\"text\":\"$notice\"}],\"isError\":$err}" ;;
		*)
			printf '{"jsonrpc":"2.0","id":%s,"error":{"code":-32601,"message":"%s"}}\n' "$id" "$notice" ;;
		esac
	done
	exit 0
}

degrade() {
	say "runtime unavailable ($1)"
	case $mode in
	hook) fail_closed "$1"; exit 0 ;;
	mcp) rules_only_mcp "$1" ;;
	*) say "maina cannot run until its runtime installs; check network access and retry."; exit 69 ;;
	esac
}

# ── Manifest ────────────────────────────────────────────────────────────────
# Written by build/standalone.ts in a fixed layout: one field per line.

top_value() {
	sed -n "s/^  \"$1\": \"\\([^\"\\\\]*\\)\",\\{0,1\\}\$/\\1/p" "$manifest" | head -n 1
}

artifact_value() {
	awk -v start="    \"$target\": {" -v key="      \"$1\": \"" '
		$0 == start { inside = 1; next }
		inside && /^    }/ { exit }
		inside && index($0, key) == 1 {
			v = substr($0, length(key) + 1); sub(/",?$/, "", v); print v; exit
		}' "$manifest"
}

[ -f "$manifest" ] || degrade no_manifest
version=$(top_value version)
case $version in '' | *[!0-9A-Za-z.+_-]*) degrade bad_manifest ;; esac

case $(uname -s) in
Darwin) os=darwin ;;
Linux) os=linux ;;
*) os= ;;
esac
case $(uname -m) in
x86_64 | amd64) arch=x64 ;;
arm64 | aarch64) arch=arm64 ;;
*) arch= ;;
esac
libc=
if [ "$os" = linux ]; then
	for f in /lib/ld-musl-*.so.1; do [ -e "$f" ] && libc=-musl; done
fi
target=$os-$arch$libc

data=${PLUGIN_DATA:-${CLAUDE_PLUGIN_DATA:-}}
if [ -z "$data" ]; then
	[ -n "${HOME:-}" ] || degrade no_data_dir
	data=$HOME/.maina
fi
dir=$data/runtime/$version
bin=$dir/maina

run() {
	case $mode in
	mcp) exec "$bin" mcp ;;
	hook) exec "$bin" hook "$event" ;;
	*) exec "$bin" cli "$@" ;;
	esac
}

[ -f "$bin" ] && [ -x "$bin" ] && run "$@"

# ── Self-heal: download, verify, cache ─────────────────────────────────────

sha256_of() {
	if command -v sha256sum >/dev/null 2>&1; then
		sha256sum "$1" | awk '{ print $1 }'
	elif command -v shasum >/dev/null 2>&1; then
		shasum -a 256 "$1" | awk '{ print $1 }'
	else
		openssl dgst -sha256 "$1" | awk '{ print $NF }'
	fi
}

fetch() {
	if command -v curl >/dev/null 2>&1; then
		curl -fsSL --proto-redir =https --connect-timeout 10 --max-time 300 -o "$2" "$1"
	elif command -v wget >/dev/null 2>&1; then
		wget -q -T 10 -O "$2" "$1"
	else
		return 1
	fi
}

install_runtime() {
	[ -n "$os" ] && [ -n "$arch" ] || { reason=unsupported_platform; return 1; }
	url=$(artifact_value url)
	sum=$(artifact_value sha256)
	sig=$(artifact_value signature)
	[ -n "$url" ] || { reason=no_artifact; return 1; }
	case $url in
	https://* | http://127.0.0.1:* | http://localhost:*) ;;
	*) reason=bad_manifest; return 1 ;;
	esac
	case $sum in *[!0-9a-f]* | '') reason=bad_manifest; return 1 ;; esac
	[ ${#sum} -eq 64 ] || { reason=bad_manifest; return 1; }
	case $sig in *[!A-Za-z0-9+/=]* | '') reason=bad_signature; return 1 ;; esac
	[ -f "$pubkey" ] || { reason=no_release_key; return 1; }
	command -v openssl >/dev/null 2>&1 || { reason=no_openssl; return 1; }
	mkdir -p "$dir" 2>/dev/null || { reason=cache_unwritable; return 1; }

	# Download next to the final path, so the install is one atomic rename.
	tmp=$dir/.maina.$$.part
	rm -f "$tmp" "$tmp.sig"
	if ! fetch "$url" "$tmp"; then reason=download_failed
	elif [ "$(sha256_of "$tmp")" != "$sum" ]; then reason=checksum_mismatch
	elif ! printf '%s' "$sig" | openssl base64 -d -A >"$tmp.sig" 2>/dev/null ||
		! openssl dgst -sha256 -verify "$pubkey" -signature "$tmp.sig" "$tmp" >/dev/null 2>&1; then
		reason=bad_signature
	elif ! chmod 0755 "$tmp" || ! mv -f "$tmp" "$bin"; then reason=cache_unwritable
	fi
	rm -f "$tmp" "$tmp.sig"
	[ -z "$reason" ]
}

install_runtime && run "$@"
degrade "$reason"
