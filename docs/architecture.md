# Architecture — the Composio-pattern

This doc explains the pattern this repo codifies. Read it once before working with the scaffold; consult it later when something surprises you.

## The problem

Modern LLM agents need access to many SaaS tools — email, calendar, files, CRM, analytics, behavior insights, etc. Each toolkit's MCP server registers its full tool schema into the LLM system prompt at boot. With one or two toolkits this is fine. With six toolkits (each shipping 50–400 tools), the system prompt blows past the LLM's context window. Haiku 4.5's limit is 200K tokens; loading 754 tools costs ~220K tokens of tool schemas alone — every call fails before the user message even gets processed.

The fix is twofold:
1. Per-toolkit MCP servers with strict allowlists (drop unused tools)
2. Per-profile entity isolation (each bot signs in with its own account where appropriate)

## How Composio fits

[Composio](https://composio.dev) gives us:
- ~250 toolkits with pre-built OAuth flows + tool schemas
- A Hosted MCP server per (toolkit × project) with optional `allowedTools` whitelist
- Per-user (or "entity") connected accounts — the same auth config can have many connections, one per user

We don't write OAuth, token refresh, or per-toolkit MCP code. Composio handles all of it. Our job is to wire MCP servers + entities correctly per brand.

## The pattern, in one diagram

```
Brand (e.g. genvest)
│
├── Composio Project
│   │
│   ├── auth_config: outlook (Composio-managed OAuth)
│   │     └── connected_account: genvest-head-of-marketing (Lee's outlook OAuth)
│   │     └── connected_account: genvest-head-of-sales       (Mary's outlook OAuth)
│   │     └── …
│   │
│   ├── auth_config: google_analytics (Composio-managed OAuth)
│   │     └── connected_account: genvest (analytics owner OAuth — shared)
│   │
│   ├── auth_config: microsoft_clarity (API key — JWT)
│   │     └── (connection is global — no per-user OAuth)
│   │
│   └── MCP Servers (one per toolkit, allowlisted)
│         ├── composio-outlook   (URL has ?user_id=${COMPOSIO_USER_ID})
│         ├── composio-onedrive  (URL has ?user_id=${COMPOSIO_USER_ID})
│         ├── composio-pipedrive (URL has ?user_id=${COMPOSIO_USER_ID})
│         ├── composio-ga4       (URL has ?user_id=genvest — hardcoded)
│         ├── composio-gsc       (URL has ?user_id=genvest — hardcoded)
│         └── composio-clarity   (URL has ?user_id=genvest — hardcoded)
│
└── Hermes deploy (e.g. genvest/agent-genvest)
    │
    ├── runtime/<brand>/hermes/overlays/<brand>.yaml
    │     (mounts the 6 composio-* MCP server entries into every profile)
    │
    └── docker-compose.yaml runtime-seed
          sync_per_profile_composio_env() writes per-profile:
            /data/hermes/profiles/<profile>/.env:
              COMPOSIO_USER_ID=<profile-slug>
              COMPOSIO_API_KEY=<org key from container env>
```

## Per-profile vs shared entity — when to use which

| Toolkit type | Pattern | Why |
|---|---|---|
| **Personal accounts** (Outlook, OneDrive, Pipedrive, Teams) | Per-profile entity (`${COMPOSIO_USER_ID}`) | Each bot is a distinct "user" — its email, calendar, files belong to a specific human handle. Per-profile OAuth in chat means the bot signs in with its own credentials. |
| **Brand-owned services** (GA4, GSC, Clarity) | Shared entity (`user_id=<brand-slug>`) | One Google account owns brand-level analytics. Every profile in that brand reads the same connection — no need for each bot to sign in separately. |
| **External APIs with API key auth** (Clarity) | Shared, but entity moot | The API key is the connection. Composio's `user_id` is symmetric with OAuth toolkits, but the same key serves all calls. |

If you're unsure, default to per-profile. It's easier to migrate to shared than the other way around.

## How Hermes substitution works

Hermes reads each profile's `config.yaml` and substitutes `${VAR}` from the profile's `.env`. The overlay file the scaffold generates contains literal `${COMPOSIO_USER_ID}` and `${COMPOSIO_API_KEY}` strings; Hermes resolves these per-profile at gateway startup.

For shared toolkits, the scaffold renders `user_id=<brand-slug>` directly into the URL. No runtime substitution — the URL is identical in every profile.

## Why `allowedTools` matters so much

Composio's `outlook` toolkit ships 301 tools. Most are admin (calendar permissions, attachment upload sessions, message rules, master categories). Marketing doesn't need any of those. Restricting to 15 user-facing tools means the LLM's system prompt grows by ~4K tokens instead of ~80K.

Rules of thumb:
- **Read-only tools first.** Add write tools when explicitly needed.
- **No admin tools.** They don't surface in chat well anyway.
- **Skip variants.** `OUTLOOK_LIST_MESSAGES` covers most cases; you rarely need `OUTLOOK_LIST_MESSAGES_DELTA` or `OUTLOOK_LIST_CHILD_FOLDER_MESSAGES` in the same allowlist.
- **One allowlist per use case, not per toolkit.** If marketing and sales need different Outlook surfaces, keep one file but mark differences in the description, or fork into `outlook-mail-only.json` and `outlook-mail-and-cal.json`.

## How a request flows

```
User → Telegram → Hermes profile (e.g. genvest-head-of-marketing)
                    │
                    │ "List my unread emails"
                    │
                    ▼
              Hermes LLM (Haiku 4.5)
                    │ sees the 18 composio-outlook tools in its system prompt
                    │ picks OUTLOOK_LIST_MESSAGES
                    │ calls MCP server composio-outlook
                    │
                    ▼
            Composio Hosted MCP
              https://backend.composio.dev/v3/mcp/<id>/mcp?user_id=genvest-head-of-marketing
                    │ resolves connected_account for user_id=genvest-head-of-marketing
                    │ uses that account's OAuth token to call Microsoft Graph
                    │
                    ▼
              Microsoft Graph
                    │
                    ▼
              Tool response → Hermes → user
```

## What the scaffold script doesn't do

- It doesn't create auth configs. Use the Composio dashboard for that. OAuth toolkits need redirect URIs and consent screen config that's nicer in the UI.
- It doesn't sign in users. Each profile/user does that via in-chat OAuth (Composio's `COMPOSIO_INITIATE_CONNECTION` helper is auto-included when `include_composio_helper_actions=true` is in the URL).
- It doesn't update existing servers. By default it deletes + recreates to ensure the allowlist sticks (Composio's `mcp.update` doesn't reliably persist `allowedTools` as of `@composio/core@0.10.x`).
- It doesn't deploy. The brand's deploy repo owns persistence, restart, env management.

## When to deviate

This pattern works for SaaS-heavy agents. It doesn't fit:
- Self-hosted services (Composio doesn't have your internal CRM).
- Workflows that need stateful multi-step orchestration (Composio's stateless RPC isn't a workflow engine).
- Heavy custom logic per tool (Composio runs each call standalone; if you need cross-tool side effects, build a custom MCP server).

For those, build a brand-owned MCP server (see [`legacy/`](../legacy/) for a starting point) or use Composio for what fits + a custom server for what doesn't.
