# Security notes: @mainahq/remote

What the remote connector and its GitHub App jobs keep, what they log,
which credentials they hold and how they reach the network (FR-REM-3,
FR-PRIV-2). The user-facing version is the "Remote connector" section of
`packages/docs/src/content/docs/privacy.mdx`.

## Reporting a vulnerability

Report it privately through GitHub's private vulnerability reporting on
[mainahq/maina](https://github.com/mainahq/maina/security/advisories/new).
Please do not open a public issue for it.

## Retention

A pull request job keeps nothing of the code it ran over.

| What | Where it lives | How long |
|------|----------------|----------|
| The PR's checkout (head and merge-base commits, depth 1) | `maina-job-*` inside the job's scratch directory | The job. Deleted when it ends, however it ends |
| Anything the job's tools write: `.maina/` state, the code graph index, caches, temp files, tool logs | The scratch directory: it is the tools' `TMPDIR`/`TMP`/`TEMP`, `HOME`/`USERPROFILE` and XDG cache, config, data and state directories | The job |
| The installation token | Memory, and git's environment for the fetch | The job. Revoked when it ends; GitHub expires it within the hour regardless |
| The App's private key | The job process's memory | The job process. Dropped from its environment before any tool runs |
| The job's report or error | Written to stdout for the caller | Not kept by the job |

How it holds:

- `runWithoutRetention` (`src/github/retention.ts`) creates one private
  (`0700`) scratch directory per job under `MAINA_JOBS_TMPDIR` (default:
  the system temp directory), points the job environment into it
  (`jobEnvironment`), runs the job there and then removes the directory.
  The job process takes the same environment for itself, so child
  processes that inherit it write into the scratch directory too.
- Removal is verified. If the directory is still present afterwards, the
  job fails with `cleanup_failed` instead of reporting success, so a
  leftover checkout is never hidden.
- The checkout itself (`inEphemeralWorkspace`) is removed and verified the
  same way, inside the scratch directory.
- `src/__tests__/retention.test.ts` runs jobs whose tools copy the PR's
  code into `.maina`, the temp directory, `$HOME` and the XDG cache, and
  jobs that succeed, fail, throw and fail to check out. It asserts that no
  file holding that code survives, that the temp root is empty and that
  the operator's home gets neither the code nor any maina state. It checks
  the real job process the same way.

Limits:

- A job's tools run as the job's user. A tool that starts a background
  process which outlives the job, or writes outside its environment's
  directories (an absolute path it hard-codes), is not contained by this.
  In the self-host deployment the job container has a read-only root
  filesystem and `/tmp` and `$HOME` on tmpfs, and `docker compose run --rm`
  removes the container, which covers that case.
- Cleanup runs when the job returns, fails or throws, not when the job
  process itself is killed (`SIGKILL`, the OOM killer, or `SIGTERM` or
  Ctrl-C, which it does not trap). A killed job can leave its
  `maina-job-*` scratch directory behind. The self-host container covers
  this too (tmpfs, `--rm`). Outside a container, point `MAINA_JOBS_TMPDIR`
  at a tmpfs or remove stale `maina-job-*` directories under it.
- The report on stdout carries the capability's findings, which name the
  PR's files and can quote its code. It is the caller's data: pass it on
  and do not retain it unless you mean to.

## Logs

The job process writes two kinds of line to stderr:

1. At startup, one line about the operator's setup: the policy file's
   location and whether it is valid, the model directory's location and
   the artifacts in it. This is configuration, not job data.
2. When the job ends, one JSON line (`jobLogEvent`):

   ```json
   {"event":"job","kind":"verify","repository":"acme/widgets","pullNumber":7,"head":"<sha>","outcome":"ok","durationMs":8123}
   ```

   A failure carries its kind (`outcome`), the HTTP status of a GitHub
   failure (`status`) and the kind of a capability failure (`reason`).
   The line never carries an error message, a file name, a workspace or
   temp path, or a line of code. A repository name that is not one
   segment each for owner and name is logged as `(invalid)`.

Detailed errors, which may quote git's output, paths and code, go to
stdout as `{ "error": ... }` with exit code 1, alongside where a
successful report would go.

The egress proxy logs one JSON line per attempt to leave the install:
method, host, port and whether it was allowed. It never logs a URL path, a
query or a body, and it never sees HTTPS content (it only tunnels
CONNECT).

The MCP service logs its startup lines (setup, the tools it serves, the
workspace and issuer) and nothing per request: no tool arguments, no
results, no tokens.

## Credentials

- **GitHub App key** (`MAINA_GITHUB_APP_*`): read once, then deleted from
  the job process's environment, so no tool running over a PR inherits
  it.
- **Installation token**: requested read-only (`contents`, `metadata`,
  `pull_requests`) unless the operator widens it, scoped to the one
  repository, passed to git through `GIT_CONFIG_*` environment variables
  (never argv, never the checkout's `.git/config`) and revoked when the
  job ends.
- **Checkout hardening**: no git template, no system config,
  `core.hooksPath=/dev/null`, repository-local `GIT_*` variables dropped,
  refs must be full commit SHAs, clone URLs must be `https` (or `file`
  for a local mirror).
- **MCP service**: OAuth 2.1 with S256 PKCE, exact redirect matching and
  consent on every authorization by the user who signed in (only they can
  answer their request). Open client registration is rate-limited per
  caller address (the one a trusted proxy appended to `X-Forwarded-For`,
  never one the caller claims) and capped; at the cap only a client with nothing in use is
  forgotten. CORS is open (no credentials) on the metadata, `/register`,
  `/token` and `/mcp`, never on `/authorize`. Clients, codes, tokens and
  sessions are held in memory only, and only token hashes are stored.
  Access tokens last an hour, refresh tokens rotate and a replayed one
  revokes its family. A restart signs every client out.

## Network

Self-hosted, the maina containers have no route out. The egress proxy
tunnels to the exact hosts in `MAINA_EGRESS_ALLOW` (default `github.com`,
`api.github.com`) and refuses everything else, including plain HTTP. The
service and jobs refuse to start on a policy that opts into telemetry,
and a job's tools run with `DO_NOT_TRACK=1` and `MAINA_TELEMETRY=0`. See
`packages/docs/src/content/docs/self-host.mdx`.
