# @mainahq/remote

The maina remote connector: the maina MCP tools served over
[Streamable HTTP](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#streamable-http)
behind OAuth 2.1, so a host such as Claude or Cursor can connect by URL.

Private until release (v1, epic #365). This package is the service skeleton
(#353); GitHub App jobs, the self-host deployment and the retention review
follow in #354–#356.

## What it serves

| Path | Purpose |
|------|---------|
| `/.well-known/oauth-protected-resource[/mcp]` | Protected resource metadata (RFC 9728) |
| `/.well-known/oauth-authorization-server` | Authorization server metadata (RFC 8414) |
| `/register` | Dynamic client registration (RFC 7591) |
| `/authorize` | Authorization code grant, S256 PKCE required |
| `/token` | Code exchange and rotating refresh tokens |
| `/mcp` | The MCP endpoint (bearer token with the `mcp:tools` scope) |
| `/healthz` | Liveness |

The tools are the `@mainahq/mcp` definitions minus local-only ones. Every
call acts on the service's workspace, and a caller-supplied `root` anywhere
else is refused. There is no action gate remotely: `decide` refuses the
gate's decision types (`action.risk`).

## Running it

```bash
MAINA_REMOTE_PASSWORD='a long owner password' \
MAINA_REMOTE_WORKSPACE=/path/to/repo \
bun packages/remote/src/main.ts
```

| Variable | Default | Meaning |
|----------|---------|---------|
| `PORT` | `8787` | Listen port |
| `MAINA_REMOTE_ISSUER` | `http://localhost:$PORT` | Public origin (https unless loopback, no path) |
| `MAINA_REMOTE_WORKSPACE` | current directory | Repository the tools act on |
| `MAINA_REMOTE_OWNER` | `owner` | Username of the one owner who approves clients |
| `MAINA_REMOTE_PASSWORD` | required, 12+ chars | That owner's password (HTTP Basic on `/authorize`) |
| `MAINA_MCP_TOOLS` | the remote default set | Tool allow-list, as for the local server |

Or as a container, built from the repository root:

```bash
docker build -f packages/remote/Dockerfile -t maina-remote .
docker run -p 8787:8787 -v "$PWD:/workspace:ro" \
  -e MAINA_REMOTE_ISSUER=https://maina.example.com \
  -e MAINA_REMOTE_PASSWORD=... maina-remote
```

Clients, codes, tokens and sessions are held in memory, so a restart signs
every client out.
