# Template Gateway

Reusable gateway template for client identity, OAuth provider connections, MCP, HTTP API, CLI operations, audit, and policy.

## Local Development

```bash
npm install
npm run dev
```

## Endpoints

- `GET /health`
- `GET /providers`
- `GET /mcp`
- `GET /auth/microsoft/connect?actor=<email>&actorId=<profile>`
- `GET /auth/microsoft/callback`
- `GET /providers/microsoft/status?actor=<id-or-email>`
- `GET /providers/microsoft/tools`

## Operator CLI

```bash
npm run cli -- doctor
npm run cli -- providers
npm run cli -- sessions
npm run cli -- microsoft connect --actor bot@example.com --actor-id profile-name
npm run cli -- microsoft status --actor profile-name
```

## Microsoft 365 Provider

The template ships a Microsoft 365 provider registry entry and readiness surface. The current implementation supports provider discovery, OAuth connect URL generation, callback handling, encrypted actor-to-Microsoft-login binding storage, and status/list-tools over HTTP, MCP, and CLI.

The first Microsoft tool metadata surface is read-only:

- `outlook_list_messages` requires `Mail.Read`
- `calendar_list_events` requires `Calendars.Read`
- `graph_request` requires `User.Read` and is reserved for allowlisted GET paths

Graph action handlers are intentionally not enabled yet. Wrapper repos should connect and validate a test tenant, inspect status/audit behavior, then add Graph actions behind client-specific policy.

Required Microsoft env vars for real OAuth:

```env
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
MICROSOFT_TENANT_ID=
MICROSOFT_REDIRECT_URI=https://gateway.example.com/auth/microsoft/callback
MICROSOFT_ALLOWED_TENANTS=tenant-guid
MICROSOFT_ALLOWED_DOMAINS=example.com
MICROSOFT_TOKEN_STORE_PATH=/data/microsoft-tokens.json
MICROSOFT_TOKEN_STORE_KEY=base64-32-byte-key
MICROSOFT_SCOPES=offline_access User.Read Mail.Read Calendars.Read
```

## Container Runtime

```bash
cp .env.example .env
docker compose up --build
```

Coolify should use the Dockerfile build pack. No runtime start-command override is required.

## Client Wrappers

Client deployments should use thin wrapper repos instead of editing this template directly. See [Client Wrapper Contract](docs/client-wrapper-contract.md).

All service integrations should follow the shared [Service Auth Flow](docs/service-auth-flow.md): request a service, connect the upstream login, then act as that login through gateway policy and audit.

For the Genvest migration guardrails, see [Genvest Migration Notes](docs/genvest-migration-notes.md).

Recommended names:

- `gateway-genvest`
- `gateway-haverford`
- `gateway-alx`

## Composio-Backed Providers (Opt-In)

Composio support is retained as an opt-in fallback for deployments that prefer Composio-managed upstream identity instead of native gateway OAuth. It is not the default — native `microsoft` and `google` providers ship in the default registry.

To enable, set in the wrapper's `.env`:

```env
ENABLE_COMPOSIO_PROVIDERS=true
ENABLED_PROVIDERS=microsoft,google,microsoft-composio,google-composio
COMPOSIO_API_KEY=ck_...
COMPOSIO_AUTH_CONFIGS_JSON={"microsoft-composio":"ac_...","google-composio":"ac_..."}
```

Composio-backed providers register under the renamed slugs `microsoft-composio` and `google-composio` so the native `microsoft` and `google` slugs remain available for the gateway's own OAuth flow.

For background, see the [original Composio provider design](docs/superpowers/specs/2026-05-23-composio-provider-design.md) and the [demotion rationale](docs/superpowers/specs/2026-05-24-google-native-and-composio-demotion-design.md).
