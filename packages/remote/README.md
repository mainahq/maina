# @mainahq/remote

The maina remote connector: the maina MCP tools served over
[Streamable HTTP](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#streamable-http)
behind OAuth 2.1, so a host such as Claude or Cursor can connect by URL.

Private until release (v1, epic #365). This package is the service skeleton
(#353) and the GitHub App jobs (#354); the self-host deployment and the
retention review follow in #355–#356.

## What it serves

| Path | Purpose |
|------|---------|
| `/.well-known/oauth-protected-resource[/mcp]` | Protected resource metadata (RFC 9728) |
| `/.well-known/oauth-authorization-server` | Authorization server metadata (RFC 8414) |
| `/register` | Dynamic client registration (RFC 7591) |
| `/authorize` | Authorization code grant, S256 PKCE required; the owner signs in and approves each client on a consent page |
| `/token` | Code exchange and rotating refresh tokens |
| `/mcp` | The MCP endpoint (bearer token with the `mcp:tools` scope) |
| `/healthz` | Liveness |

The tools are the `@mainahq/mcp` definitions minus local-only ones. Every
call acts on the service's workspace, and a caller-supplied `root` anywhere
else is refused. There is no action gate remotely: `decide` refuses the
gate's decision types (`action.risk`).

## GitHub App jobs

`src/github` runs one maina capability against one pull request as a
GitHub App (FR-REM-2, FR-REM-3):

| Job | Capability | Input from the PR |
|-----|------------|-------------------|
| `verify` | verify pipeline | changed files, diff-only against the merge base |
| `impact` | code graph impact | changed files |
| `triage` | two-stage review | the diff against the merge base |
| `spec_check` | spec/plan/tasks consistency | the `.maina/features/*` directories the PR touches (or explicit paths) |
| `decide` | decision API | an explicit decide request (the action gate's types are refused) |

A job signs an App JWT, takes an installation token for the PR's
repository, asks GitHub where the head forked from the base branch (the
merge base, so the base's newer commits never show up reversed in the
diff), fetches exactly the head and that commit into a fresh
`maina-job-*` directory, runs the capability there through the runtime,
then deletes the directory and checks it is gone (a surviving directory
fails the job) and revokes the token. The token reaches git through its
environment, never argv or the checkout's config, and no host hooks run
on the checkout. The job process drops `MAINA_GITHUB_APP_*` from its own
environment once read, so no tool running over the PR's code inherits the
App's key.

**Read-only by default.** The App manifest (`appManifest`) and every
installation token ask for `contents`, `metadata` and `pull_requests` read
only; wider permissions must be passed explicitly.

Registering the App on GitHub is a manual step: create it from
`appManifest(...)` (GitHub's manifest flow), then give the service the App
id and private key.

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
| `MAINA_REMOTE_WORKSPACE` | current directory | Repository the tools act on (a relative path resolves against the current directory) |
| `MAINA_REMOTE_OWNER` | `owner` | Username of the one owner who approves clients (no colon) |
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
