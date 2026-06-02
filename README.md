# template-gateway

Brand-agnostic runtime MCP gateway. Each brand deploys it on Coolify directly from this repo's source (the Dockerfile is small enough that we don't bother with a registry — Coolify builds in seconds on every push) and Hermes points at one URL per brand. Behind the gateway, [Composio Tool Router](https://docs.composio.dev) does the actual tool serving with lazy discovery — the LLM only sees ~5 meta-tools regardless of catalog size.

Also ships the reference scaffolding (allowlists, helper scripts, overlay templates, walkthroughs) for new-brand onboarding.

> Previously this repo was a native-OAuth proxy; that role is recoverable from git history at commit `fd76a91`. See [`docs/superpowers/specs/2026-05-24-runtime-gateway-design.md`](docs/superpowers/specs/2026-05-24-runtime-gateway-design.md) for the design behind the runtime pivot.

## What's in here

```
template-gateway/
├── src/                       runtime gateway (Express + thin proxy to Composio Tool Router)
│   ├── index.ts               Express boot, /health + /mcp routing
│   ├── config.ts              env loader
│   ├── auth.ts                bearer middleware + X-Composio-User-Id actor context
│   ├── session-cache.ts       in-memory LRU + TTL per userId → Tool Router session
│   └── mcp-proxy.ts           JSON-RPC forwarder
├── test/                      Vitest unit tests for all of the above
├── Dockerfile                 multi-stage Node 20, ~120MB final image (Coolify builds from source)
├── docs/                      walkthroughs + architecture reference
│   ├── architecture.md
│   ├── adding-a-brand.md
│   ├── adding-a-toolkit.md
│   └── superpowers/specs/     design history
├── scripts/                   helpers for setup (composio-list-tools, composio-create-servers)
├── allowlists/                9 reference allowlists per toolkit
└── overlay-templates/         envsubst templates for brand overlays
```

## Quick start — running the gateway locally

```bash
git clone https://github.com/leebaroneau/template-gateway.git
cd template-gateway && npm install

export COMPOSIO_API_KEY="ak_..."
export BRAND_SLUG="mybrand"
export GATEWAY_BEARER="$(openssl rand -hex 32)"
export PORT=3000

npm run dev
# In another shell:
curl http://localhost:3000/health
```

## Local admin UI prototype

The Haverford Unified Gateway admin prototype supports four admin data modes.
`fixture` is the default local, non-persistent prototype mode. It runs without a
live Dev API, Composio session, OAuth provider, native connector, or app data
volume:

```bash
COMPOSIO_API_KEY=ak_local_dummy \
BRAND_SLUG=haverford \
GATEWAY_BEARER=a_secret_thats_long_enough \
ADMIN_DATA_SOURCE=fixture \
PORT=3000 \
npm run dev
```

Open `http://localhost:3000/admin`.

Fixture mode proves the operator workflow: brands, regions, connections,
backend options, API clients, mock key rotation/revocation, and audit.

Use `fixture-overlay` for local persistence without a running Haverford Dev API:

```bash
COMPOSIO_API_KEY=ak_local_dummy \
BRAND_SLUG=haverford \
GATEWAY_BEARER=a_secret_thats_long_enough \
ADMIN_DATA_SOURCE=fixture-overlay \
GATEWAY_STORE_PATH=./data/gateway.sqlite \
PORT=3000 \
npm run dev
```

Dev API read-through mode reads configured admin data from Haverford Dev API and
is read-only in this phase:

```bash
COMPOSIO_API_KEY=ak_local_dummy \
BRAND_SLUG=haverford \
GATEWAY_BEARER=a_secret_thats_long_enough \
ADMIN_DATA_SOURCE=dev-api \
HAVERFORD_DEV_API_BASE_URL=http://localhost:3001 \
HAVERFORD_DEV_API_CLIENT_ID=<internal-client-id> \
HAVERFORD_DEV_API_CLIENT_SECRET=<internal-client-secret> \
PORT=3000 \
npm run dev
```

`dev-api-overlay` is the transition path: Haverford Dev API supplies imported
source records, while the gateway stores edits, new records, and source
overrides in SQLite.

For production deployments, mount a persistent app data volume at `/data`.
Overlay modes default to `GATEWAY_STORE_PATH=/data/gateway.sqlite` when
`NODE_ENV=production`; set the variable explicitly if a deployment uses another
mounted path. Overlay modes store gateway-owned records and source overrides in
SQLite; they do not wire real OAuth, Nango, Composio, or native connector
execution yet. Coolify env vars should stay limited to bootstrap/runtime inputs
such as app secrets, Auth-Gate URL, initial admin/bootstrap token, and global
provider credentials where required.

To use the gateway from a Hermes profile, add this to the profile's overlay:

```yaml
mybrand:
  url: http://localhost:3000/mcp
  headers:
    Authorization: "Bearer ${GATEWAY_BEARER}"
    X-Composio-User-Id: "${COMPOSIO_USER_ID}"
  timeout: 120
```

## Env contract

| Var | Required | Meaning |
|---|---|---|
| `COMPOSIO_API_KEY` | yes | Org-level Composio API key for `/mcp`; admin fixture mode can use `ak_local_dummy` |
| `BRAND_SLUG` | yes | Brand slug, e.g. `haverford` or `genvest`; default `user_id` when header missing |
| `GATEWAY_BEARER` | yes | Shared secret for Hermes ↔ gateway auth (≥16 chars) |
| `COMPOSIO_PROJECT_ID` | no | Constrain to a specific Composio project |
| `ADMIN_DATA_SOURCE` | no | Admin backend mode: `fixture`, `fixture-overlay`, `dev-api`, or `dev-api-overlay`; defaults to `fixture` |
| `GATEWAY_STORE_PATH` | overlay modes | SQLite path for overlay persistence; use `/data/gateway.sqlite` on a mounted deployment volume |
| `HAVERFORD_DEV_API_BASE_URL` | only when `ADMIN_DATA_SOURCE=dev-api` or `dev-api-overlay` | Base URL for Haverford Dev API read-through mode |
| `HAVERFORD_DEV_API_CLIENT_ID` | only when `ADMIN_DATA_SOURCE=dev-api` or `dev-api-overlay` | Internal client id sent to Haverford Dev API |
| `HAVERFORD_DEV_API_CLIENT_SECRET` | only when `ADMIN_DATA_SOURCE=dev-api` or `dev-api-overlay` | Internal client secret sent to Haverford Dev API |
| `TOOLKIT_ALLOWLIST` | no | Comma-separated, e.g. `outlook,one_drive,pipedrive` — defaults to all toolkits the API key sees |
| `PORT` | no | Default `3000` |
| `SESSION_TTL_SECONDS` | no | Tool Router session cache TTL; default `3600`, min `60` |

## When to use this repo

| Situation | Use this repo? |
|---|---|
| Setting up a new brand on the agent stack | Yes — start with [docs/adding-a-brand.md](docs/adding-a-brand.md) |
| Adding a new Composio toolkit to an existing brand | Yes — see [docs/adding-a-toolkit.md](docs/adding-a-toolkit.md) |
| Composio doesn't have the toolkit you need | No — build a custom MCP server in your brand's deploy repo, or open a request with Composio |
| You need a native-OAuth proxy (no Composio dependency) | `git show fd76a91:src/` resurrects the historical native gateway; copy it out and own it in a new repo |

## The pattern this codifies

- **Single endpoint per brand.** Hermes mounts ONE `mcp_servers` entry; the gateway fans out to Composio's Tool Router under the hood.
- **Per-profile entity isolation.** Each Hermes profile carries `X-Composio-User-Id: <profile-slug>` so per-profile OAuth state stays separated.
- **Shared brand entity for analytics.** Profiles can override the header to `<brand-slug>` for shared OAuth (e.g. GA4 owned by one human).
- **Lazy tool loading.** Composio Tool Router only surfaces ~5 meta-tools (`search_tools`, `execute_tool`, etc.); tool schemas are fetched on demand.
- **Brand chokepoint.** Gateway is a natural seam for future audit logging, rate limiting, role-based filtering, or custom composite tools.

See [docs/architecture.md](docs/architecture.md) for the full picture and [docs/superpowers/specs/2026-05-24-runtime-gateway-design.md](docs/superpowers/specs/2026-05-24-runtime-gateway-design.md) for the design that drove this.

## Status

| Component | State |
|---|---|
| Runtime gateway (Express + proxy + cache + auth) | ready |
| Allowlists (9 reference toolkits) | ready |
| `composio-list-tools.mjs` / `composio-create-servers.mjs` | ready |
| Overlay templates | ready |
| Dockerfile (Coolify builds from source on push) | ready |
| Vitest unit tests | 21/21 pass |
| `composio-rotate-key.mjs` (lifecycle) | planned |
| Audit log persistence | planned |
| First production deploy (`gateway-genvest` → `gateway.genvest.com.au`) | in progress |
