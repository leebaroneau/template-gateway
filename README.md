# template-gateway

Reference scaffolding for the per-toolkit Composio MCP pattern. Use it when standing up a new brand's Hermes Agent stack that needs to integrate Outlook, OneDrive, Pipedrive, GA4, GSC, Clarity, Teams (or any other Composio toolkit) without blowing the LLM's context window.

This repo is not a runtime service. It contains scripts, JSON allowlists, overlay templates, and docs. Brands consume it by cloning, running the scaffold script, and pasting the generated overlay fragment into their own deploy repo.

> The previous role of this repo — a native-OAuth MCP/HTTP gateway — is archived in [`legacy/`](legacy/). See [legacy/README.md](legacy/README.md) for context. Don't extend it.

## What's in here

```
template-gateway/
├── docs/                      walkthroughs + architecture reference
│   ├── architecture.md
│   ├── adding-a-brand.md
│   ├── adding-a-toolkit.md
│   └── superpowers/specs/     design history
├── scripts/                   helpers for Composio MCP server setup
│   ├── composio-list-tools.mjs    probe a toolkit's full catalog
│   └── composio-create-servers.mjs  create N MCP servers from N allowlists
├── allowlists/                reference allowlists per toolkit
│   ├── outlook-mail-calendar.json
│   ├── onedrive-files.json
│   ├── pipedrive-crm.json
│   ├── ga4-reporting.json
│   ├── gsc-search.json
│   └── clarity-export.json
├── overlay-templates/         envsubst templates for brand overlays
│   ├── per-profile-toolkit.yaml
│   └── shared-toolkit.yaml
└── legacy/                    pre-pivot native-OAuth gateway code
```

## Quick start (new brand)

```bash
# 1. clone + install
git clone https://github.com/leebaroneau/template-gateway.git
cd template-gateway && npm install

# 2. set Composio API key
export COMPOSIO_API_KEY="ak_..."

# 3. create auth configs in Composio dashboard (UI step — see docs/adding-a-brand.md)

# 4. run the scaffold
node scripts/composio-create-servers.mjs \
  --brand mybrand \
  --allowlists allowlists/outlook-mail-calendar.json,allowlists/ga4-reporting.json \
  --auth-configs '{"outlook":"ac_abc...","google_analytics":"ac_def..."}' \
  --shared-entity-toolkits google_analytics \
  --output ./mybrand-composio.yaml
```

Output is a YAML fragment ready to paste into your brand's Hermes overlay. Then add a per-profile `COMPOSIO_USER_ID` env sync to your deploy compose (template in [docs/adding-a-brand.md](docs/adding-a-brand.md)).

## When to use this repo

| Situation | Use this repo? |
|---|---|
| Setting up a new brand on the agent stack | Yes — start with [docs/adding-a-brand.md](docs/adding-a-brand.md) |
| Adding a new Composio toolkit to an existing brand | Yes — see [docs/adding-a-toolkit.md](docs/adding-a-toolkit.md) |
| Composio doesn't have the toolkit you need | No — build it in your brand's deploy repo as a custom MCP server, or open a Composio request |
| You need a native-OAuth proxy (no Composio dependency) | Maybe — review [`legacy/`](legacy/) as a starting point, but copy it out and own it |

## The pattern this codifies

- **Per-toolkit Composio Hosted MCP servers** with strict `allowedTools` whitelists. Each toolkit gets one server.
- **Per-profile entity IDs** for personal toolkits (Outlook, OneDrive, Pipedrive, Teams). Each bot signs in with its own account via in-chat OAuth.
- **Shared brand entity** (`user_id=<brand-slug>`) for analytics toolkits (GA4, GSC, Clarity). One person signs in once for the brand; every profile reads the same connection.
- **Persistence via brand overlay + per-profile env sync.** Hermes substitutes `${COMPOSIO_USER_ID}` and `${COMPOSIO_API_KEY}` per-profile at runtime.

See [docs/architecture.md](docs/architecture.md) for the full picture.

## Status

| Component | State |
|---|---|
| Allowlists (6 reference toolkits) | ready |
| Overlay templates | ready |
| `composio-list-tools.mjs` | ready |
| `composio-create-servers.mjs` | ready |
| `composio-rotate-key.mjs` (lifecycle) | planned |
| CI for scaffold script | planned |
| First production use | Genvest (2026-05-24) |
