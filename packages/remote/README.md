# @mainahq/remote

The maina remote connector: the maina MCP tools served over
[Streamable HTTP](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#streamable-http)
behind OAuth 2.1, so a host such as Claude or Cursor can connect by URL.

Private until release (v1, epic #365). This package is the service skeleton
(#353), the GitHub App jobs (#354), the self-host deployment (#355) and
the retention and security review (#356, [SECURITY.md](./SECURITY.md)).

## What it serves

| Path | Purpose |
|------|---------|
| `/.well-known/oauth-protected-resource[/mcp]` | Protected resource metadata (RFC 9728) |
| `/.well-known/oauth-authorization-server` | Authorization server metadata (RFC 8414) |
| `/register` | Dynamic client registration (RFC 7591), rate-limited per address, with a cap on registered clients |
| `/authorize` | Authorization code grant, S256 PKCE required; the signed-in user approves each client on a consent page |
| `/token` | Code exchange and rotating refresh tokens |
| `/mcp` | The MCP endpoint (bearer token with the `mcp:tools` scope) |
| `/healthz` | Liveness |

The metadata documents, `/register`, `/token` and `/mcp` send CORS headers
for any origin (never with credentials), so browser-based MCP clients can
connect; `/authorize` is a browser navigation and sends none. A
registration over the per-address limit gets `429` with `Retry-After`. At
the client cap the oldest client with no pending consent, code or live
token is forgotten to make room; when every client is in use, `503`.

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

**Nothing retained, nothing logged.** Each job runs in a private scratch
directory that is also its tools' temp directory, `$HOME` and XDG
directories, and is deleted (verified) when the job ends
(`src/github/retention.ts`). The job process prints its report, or
`{ "error": ... }`, on stdout and exits 0 or 1; on stderr it logs one JSON
line per job (kind, repository, pull request, head, outcome, duration)
that never names code or a path. See [SECURITY.md](./SECURITY.md).

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
| `MAINA_REMOTE_OWNER` | `owner` | Username of the owner who approves clients (no colon) |
| `MAINA_REMOTE_PASSWORD` | required, 12+ chars | That owner's password (HTTP Basic on `/authorize`) |
| `MAINA_REMOTE_USERS` | none | Further users of the workspace, each approving their own clients: a JSON object of username to password (12+ chars each) |
| `MAINA_REMOTE_MAX_CLIENTS` | `1000` | Most OAuth clients registered at once |
| `MAINA_REMOTE_REGISTRATIONS_PER_MINUTE` | `20` | Client registrations a minute per peer address (behind a proxy, all callers share its address) |
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

## Self-hosting

`deploy/compose` and `deploy/helm/maina-remote` run the service and the PR
jobs with no outbound network except GitHub (FR-REM-4); the guide is
`packages/docs/src/content/docs/self-host.mdx`.

- The maina containers sit on a network with no route out (a compose
  `internal` network; a Kubernetes `NetworkPolicy`).
- `src/edge/main.ts egress` is the only way out: an HTTP CONNECT proxy
  that tunnels to the exact hosts in `MAINA_EGRESS_ALLOW` (default
  `github.com,api.github.com`), refuses the rest and plain HTTP, and logs
  every attempt as a JSON line.
- `src/edge/main.ts ingress` carries inbound requests to the service in
  compose, where the service has no published port.
- The operator's policy file and model artifacts are mounted read-only at
  `$HOME/.maina/policy.json` and `$HOME/.maina/models`. Both processes
  check them at startup (`checkSelfHost`) and refuse to start on an
  invalid policy or one that opts into telemetry; the policy is the user
  layer of every policy merge.

`deploy/__tests__/smoke.test.ts` runs one PR job with a policy file and a
model artifact under a network spy and fails on any destination but
GitHub; `MAINA_DOCKER_SMOKE=1` adds the real image on the egress-blocked
compose network and a helm lint/render.
