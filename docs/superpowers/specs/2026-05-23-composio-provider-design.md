# Composio Provider Design

> **Status:** Opt-in fallback. Superseded as the default by [2026-05-24-google-native-and-composio-demotion-design.md](./2026-05-24-google-native-and-composio-demotion-design.md). The architecture below remains accurate for deployments that set `ENABLE_COMPOSIO_PROVIDERS=true`; the gateway slugs have been renamed from `microsoft` / `google` to `microsoft-composio` / `google-composio`.

## Goal

Make Composio the default upstream integration engine for Microsoft and Google services while keeping `template-gateway` as the stable client-facing gateway.

The gateway contract remains: a user, Hermes profile, or API client requests a provider, receives a connect/login URL when disconnected, completes upstream login, and future MCP/API/CLI requests act as that connected upstream account through gateway policy and audit.

## Decision

Use Composio by default for:

- `microsoft`: Outlook Mail, Calendar, OneDrive, and future Microsoft 365 tools.
- `google`: Gmail, Calendar, Drive, and future Google Workspace tools.

Keep native providers as fallback implementations for cases where a client needs tighter control, unsupported Composio behavior, or self-hosted token custody. The native Microsoft provider should remain available as `microsoft-native` or an implementation mode, not as the default.

## Gateway Responsibilities

`template-gateway` owns the durable contract:

- actor identity resolution from session tokens, static service tokens, CLI flags, or API auth
- provider registry and stable provider slugs
- per-actor provider binding metadata
- connect/status surfaces over HTTP, MCP, and CLI
- Composio user/session/account selection
- policy and audit hooks
- wrapper configuration for toolkit allowlists and auth config IDs

Composio owns upstream OAuth/token custody and upstream tool execution for supported Microsoft/Google toolkits.

## Actor Mapping

Each gateway actor maps to a deterministic Composio user id:

```text
<client-slug>:actor:<actor-id-or-email>
```

Examples:

- `genvest:actor:genvest-head-of-sales`
- `genvest:actor:lee@genvest.com.au`

The gateway must never use Composio's implicit `default` user. Any generated Composio MCP URL must include either `user_id` or `connected_account_id`. Prefer `connected_account_id` after a specific account has been selected.

## Provider Mapping

The gateway should register provider slugs separately from Composio toolkit slugs:

```json
{
  "microsoft": {
    "backend": "composio",
    "toolkits": ["outlook", "calendar", "onedrive"]
  },
  "google": {
    "backend": "composio",
    "toolkits": ["gmail", "googlecalendar", "googledrive"]
  }
}
```

Wrapper repos may override toolkit slugs after verification against the live Composio catalog. The template must treat these as configuration, not hard-code client-specific choices.

## Connect Flow

1. Caller requests `microsoft` or `google` for the current actor.
2. Gateway resolves actor id/email/profile and maps it to `composioUserId`.
3. Gateway creates or reuses a Composio session scoped to the provider's configured toolkits, with workbench disabled.
4. Gateway checks toolkit connection status.
5. If disconnected, gateway calls Composio `session.authorize(<primaryToolkit>)` and returns the hosted connect URL.
6. User completes Composio-hosted auth for their own account.
7. Gateway stores binding metadata: actor, provider, Composio user id, session id, connected account ids, status, timestamps.
8. Future requests use the same actor/provider binding and never fall back to another user.

## HTTP Surface

Add provider-generic endpoints:

- `GET /providers/:provider/connect?actor=<email>&actorId=<id>&actorName=<name>`
- `GET /providers/:provider/status?actor=<id-or-email>`
- `GET /providers/:provider/mcp-url?actor=<id-or-email>`

Keep provider-specific aliases if useful:

- `GET /auth/microsoft/connect`
- `GET /providers/microsoft/status`

The generic endpoints are the canonical shape for Google and future providers.

## MCP Surface

Add tools:

- `provider_connect`
- `provider_status`
- `provider_mcp_url`

Inputs include `provider` where required. The actor is normally resolved from authenticated MCP metadata, not from tool input.

Provider-specific convenience tools may be added later, but they should delegate to the generic provider service.

## CLI Surface

Add provider-generic commands:

- `provider connect <provider> --actor <email> --actor-id <id> --actor-name <name>`
- `provider status <provider> --actor <id-or-email>`
- `provider mcp-url <provider> --actor <id-or-email>`

Provider-specific commands can remain as aliases.

## Storage

Store local binding metadata only. Do not store Google or Microsoft OAuth access/refresh tokens locally when using Composio.

Binding record:

```json
{
  "actorId": "genvest-head-of-sales",
  "actorEmail": "sales_bot@genvest.com.au",
  "actorName": "@sales_bot",
  "provider": "microsoft",
  "backend": "composio",
  "composioUserId": "genvest:actor:genvest-head-of-sales",
  "sessionId": "session_id",
  "mcpUrl": "https://platform.composio.dev/v3/mcp/...",
  "connectedAccountIds": ["ca_..."],
  "status": "connected",
  "updatedAt": "2026-05-23T00:00:00.000Z"
}
```

## Config

Add env vars:

```env
COMPOSIO_API_KEY=
COMPOSIO_BINDING_STORE_PATH=./data/composio-bindings.json
COMPOSIO_CLIENT_SLUG=local
COMPOSIO_DEFAULT_BACKEND_ENABLED=true
COMPOSIO_MICROSOFT_TOOLKITS=outlook,calendar,onedrive
COMPOSIO_GOOGLE_TOOLKITS=gmail,googlecalendar,googledrive
COMPOSIO_AUTH_CONFIGS_JSON={}
```

`COMPOSIO_AUTH_CONFIGS_JSON` maps toolkit slug to Composio auth config id for white-labeled OAuth apps.

## Tests

Unit and integration tests should cover:

- config parsing for Composio settings
- provider registry includes `microsoft` and `google` as Composio-backed defaults
- actor-to-Composio-user-id mapping never returns `default`
- connect returns a Composio hosted connect URL for disconnected actors
- status stores and returns connected account metadata
- MCP URL includes `user_id` or `connected_account_id`
- HTTP generic provider endpoints work for Microsoft and Google
- MCP tools resolve actor from auth metadata
- CLI provider commands do not print secrets

## Rollout

1. Implement Composio backend in `template-gateway`.
2. Add docs and env examples.
3. Add wrapper config in `gateway-genvest` for Microsoft/Google.
4. Test one human account and one Hermes profile.
5. Keep Pipedrive on native gateway until Composio coverage and policy parity are proven.

## Non-Goals

- Do not migrate Pipedrive in this change.
- Do not remove the native Microsoft provider.
- Do not proxy every Composio tool through bespoke gateway code.
- Do not use Composio's default user id.
- Do not let one actor use another actor's connected account.
