# maina remote connector: the MCP tools over Streamable HTTP behind OAuth 2.1.
#
# Build from the repository root (the context needs the workspace):
#   docker build -f packages/remote/Dockerfile -t maina-remote .
# Run with a workspace mounted and an owner password:
#   docker run -p 8787:8787 -v "$PWD:/workspace:ro" \
#     -e MAINA_REMOTE_ISSUER=https://maina.example.com \
#     -e MAINA_REMOTE_PASSWORD=... maina-remote
#
# Bun runs the TypeScript sources directly (tsconfig `paths` map the
# workspace packages to their src), so there is no build step.
#
# The same image runs every piece of the self-hosted deployment
# (deploy/compose, deploy/helm): the service (this CMD), the PR job
# (src/github/main.ts) and the egress and ingress forwarders
# (src/edge/main.ts). The operator's policy file and local model artifacts
# are read from $HOME/.maina (/home/bun/.maina/policy.json and
# /home/bun/.maina/models), the layout a local install uses; mount them
# read-only.

FROM oven/bun:1.3-slim AS deps
WORKDIR /app
COPY package.json bun.lock ./
# A frozen install needs every workspace manifest, even the ones skipped.
COPY packages/cli/package.json packages/cli/
COPY packages/core/package.json packages/core/
COPY packages/docs/package.json packages/docs/
COPY packages/harness/package.json packages/harness/
COPY packages/mcp/package.json packages/mcp/
COPY packages/plugins/package.json packages/plugins/
COPY packages/remote/package.json packages/remote/
COPY packages/runtime/package.json packages/runtime/
COPY packages/skills/package.json packages/skills/
RUN bun install --frozen-lockfile --production --ignore-scripts --filter @mainahq/remote

FROM oven/bun:1.3-slim
WORKDIR /app
# git: the runtime diffs and reads the mounted repository.
RUN apt-get update \
	&& apt-get install -y --no-install-recommends git ca-certificates \
	&& rm -rf /var/lib/apt/lists/*
COPY --from=deps /app ./
COPY tsconfig.json ./
COPY packages/core packages/core
COPY packages/mcp packages/mcp
COPY packages/remote packages/remote
ENV NODE_ENV=production \
	HOME=/home/bun \
	PORT=8787 \
	MAINA_REMOTE_WORKSPACE=/workspace
RUN mkdir -p /workspace /home/bun/.maina/models \
	&& chown -R bun:bun /home/bun \
	&& git config --system --add safe.directory /workspace
USER bun
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD ["bun", "-e", "const r = await fetch(`http://127.0.0.1:${process.env.PORT}/healthz`); process.exit(r.ok ? 0 : 1)"]
CMD ["bun", "packages/remote/src/main.ts"]
