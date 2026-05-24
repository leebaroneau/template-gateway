# Google Native Provider + Composio Demotion Design

## Goal

Add a provider-agnostic Google Workspace provider to `template-gateway` that mirrors the Microsoft native provider architecture, and demote the existing Composio integration from default-on to opt-in-only without deleting its code.

When this lands, the default registry surfaces three native OAuth providers — `pipedrive`, `microsoft`, `google` — all sharing the same per-provider scaffold pattern, and `gateway-<client>` wrappers consume them through the existing wrapper contract.

This is a design spec only. It does not migrate any existing client deployment, does not implement Google tools beyond a v1 surface, and does not remove any Composio code.

## Relationship to Other Specs

This spec layers on top of two existing specs and supersedes one:

- **Layers on top of `docs/superpowers/specs/2026-05-23-microsoft-provider-design.md`.** That spec is the canonical reference for the native OAuth provider pattern. This spec restates only Google-specific deltas and the Composio demotion mechanism.
- **Layers on top of the merged Pipedrive provider** (commit `471848b feat(pipedrive): add Pipedrive OAuth provider with api_domain support (#1)`). Pipedrive is the first in-tree native provider and validates the scaffold shape that Microsoft and Google follow.
- **Supersedes `docs/superpowers/specs/2026-05-23-composio-provider-design.md`** (currently untracked in the working tree). That spec made Composio the default upstream for Microsoft and Google. After this spec lands, Composio becomes opt-in fallback only. The older spec must be updated to reflect that.

## Architectural Shape

Mirror, do not abstract.

Pipedrive (in `src/providers/pipedrive/`) and Microsoft (scaffolded in `src/providers/microsoft/`) both use the layout:

```
src/providers/<slug>/
  factory.ts       # construct service from gateway config
  service.ts       # connect-url, callback, status, refresh, tool execution
  state-store.ts   # OAuth state with CSRF token and TTL
  token-store.ts   # encrypted token binding persistence
  types.ts         # provider-specific shapes
```

Google takes the same layout verbatim. No `OAuthProvider` base class extraction. Three living examples first, abstraction in a later cleanup pass if the duplication actually hurts.

All three providers use the existing template primitives:

- `src/storage/json-file-store.ts` for atomic per-file persistence
- `src/audit/audit-log.ts` for tool/action audit
- `src/providers/{directory,registry,types}.ts` for the gateway-facing provider registry

## Google Provider Registry Entry

Registered through the same registry shape Microsoft and Pipedrive use:

```ts
{
  slug: "google",
  name: "Google Workspace",
  description: "Google Workspace access for Gmail, Calendar, and selected Google API operations.",
  auth: "oauth",
  mcpPath: "/mcp/google",
  scopesSummary: "Delegated Google Workspace access for the connected Google login."
}
```

`GET /providers`, `GET /mcp`, the `gateway_list_providers` MCP tool, and `npm run cli -- providers` derive from this registry entry. Wrappers may hide the provider through configuration but must not create a parallel provider directory.

## OAuth Details — Where Google Differs from Microsoft

Google OAuth is delegated auth only. The gateway acts as the Google account that completed OAuth, never as a service account or domain-wide-delegated identity.

### Endpoints

| Concern | Value |
| :--- | :--- |
| Authorize URL | `https://accounts.google.com/o/oauth2/v2/auth` |
| Token URL | `https://oauth2.googleapis.com/token` |
| Userinfo URL | `https://www.googleapis.com/oauth2/v3/userinfo` |
| Email claim | `email` field of userinfo response, lowercased, gated by `GOOGLE_ALLOWED_DOMAINS` |
| Tenant model | None. Google has no tenant concept. Domain gating only. |

### Required env vars

```
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REDIRECT_URI            # defaults to ${API_BASE_URL}/auth/google/callback
GOOGLE_ALLOWED_DOMAINS         # defaults to ALLOWED_EMAIL_DOMAINS
GOOGLE_TOKEN_STORE_PATH        # defaults to <data-dir>/google-tokens.json
GOOGLE_TOKEN_STORE_KEY         # 32-byte base64 secret for refresh-token encryption
```

### Default scope set (v1)

```
openid
email
profile
offline_access
https://www.googleapis.com/auth/gmail.readonly
https://www.googleapis.com/auth/gmail.send
https://www.googleapis.com/auth/calendar.readonly
```

`gmail.send` is requested but tools requiring it are gated by an explicit wrapper policy flag, same as `outlook_send_email`.

### Callback flow

1. Validate OAuth state, provider slug, and actor session reference.
2. Exchange the authorization code at the token endpoint.
3. Fetch `GET https://www.googleapis.com/oauth2/v3/userinfo` with the resulting access token.
4. Resolve the Google login from `email`, lowercase it, and require it to match `GOOGLE_ALLOWED_DOMAINS`. Reject `email_verified !== true`.
5. Store a binding for `{actor, provider: "google", googleLogin}` with encrypted token material.
6. Return the gateway authorization result expected by the initiating MCP, API, or CLI flow.

### Refresh-token quirks

Google issues a refresh token only on the *initial* consent grant when the authorize URL includes `access_type=offline&prompt=consent`. Subsequent re-consents return no refresh token.

- The connect-URL builder always sets `access_type=offline`.
- It sets `prompt=consent` only on first-time connect (no existing binding for that actor). On reconnect with an existing binding, `prompt=select_account` is used so the user can pick the same account without forcing re-consent.
- Token-store update logic must preserve the existing refresh token if a token-exchange response omits it. Never overwrite a non-empty refresh token with `undefined`.
- If refresh returns `invalid_grant`, mark the binding `reconnect_required` and surface that to the caller, preserving the original `createdAt` timestamp for audit.

## Actor Binding and Storage (Google)

Identical to Microsoft per `docs/superpowers/specs/2026-05-23-microsoft-provider-design.md`, with the following substitutions:

- `provider: "google"`
- `upstreamLogin` is the verified Google email
- No `tenantId` field on the binding record (Google has no tenant)
- Encrypted payload format matches Microsoft's `MicrosoftTokenPayload` shape with the same fields: access token, refresh token, token type, scope, expiry, optional account ID

The binding key remains `{actorId, provider}`. Tool inputs must never contain an `as`, `from`, `mailbox`, or equivalent identity override.

## MCP, API, and CLI Surface (Google)

MCP:

- `/mcp/google` exposes Google tools for actors with a Google binding.
- `gateway_list_providers` lists Google when enabled.
- `google_status` returns connected or reconnect-required state for the current actor.
- `google_list_tools` returns enabled tool names and required scopes.

HTTP API:

- `GET /providers` includes the Google entry when enabled.
- `GET /auth/google/connect` returns an OAuth login URL for the authenticated actor.
- `GET /auth/google/callback` completes the OAuth flow.
- `GET /providers/google/status` returns binding status.
- `GET /providers/google/tools` returns available tool metadata.

CLI:

- `providers` lists Google through the registry.
- `google connect --actor <id-or-email>` prints a connect URL for operator-assisted setup.
- `google status --actor <id-or-email>` reports bound login, scopes, expiry, and reconnect state without printing secrets.

Same decision gate as Microsoft: if the first implementation cannot add all three transport surfaces at once, ship registry plus MCP and status first. Do not ship Google API actions without a status/readiness path.

## First Tool Surface (Google v1)

The first implementation is intentionally small and parallels Microsoft's v1:

| Tool | Endpoint | Scope | Notes |
| :--- | :--- | :--- | :--- |
| `gmail_list_messages` | `GET https://gmail.googleapis.com/gmail/v1/users/me/messages` | `gmail.readonly` | Supports `q`, `maxResults`, `pageToken` |
| `gmail_send_email` | `POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send` | `gmail.send` | RFC 822 message constructed from `to`, `subject`, `body`; gated behind explicit wrapper policy flag |
| `calendar_list_events` | `GET https://www.googleapis.com/calendar/v3/calendars/primary/events` | `calendar.readonly` | Supports `timeMin`, `timeMax`, `q`, `maxResults` |
| `google_api_request` | Configurable GET-only proxy | per-path | Allowlisted to `/gmail/v1/users/me`, `/calendar/v3/calendars/primary`, `/oauth2/v3/userinfo`. Not a raw Google API proxy. |

Writes start with mail send only. Calendar write, message modify/delete, Drive, Docs, and any non-GET `google_api_request` are later provider extensions.

Scope boundary mirrors Microsoft:

- A wrapper may request additional delegated scopes through configuration, but the provider must reject any tool whose required scope is not present in the actor binding.
- `google_api_request` uses an allowlist of methods (GET only in v1) and path prefixes. It is not a raw Google API proxy.

## Composio Demotion

Three changes, no deletions.

### 1. Conditional registration via env flag

Add `ENABLE_COMPOSIO_PROVIDERS` (default `false`) to the gateway config.

- When `false`: `providers/defaults.ts` does not register the Composio-backed `microsoft` or `google` entries. The Composio service is not constructed. No `COMPOSIO_*` env vars are read (other than the flag itself).
- When `true`: existing Composio registration logic runs as today. All current `COMPOSIO_*` env vars apply. Wrappers must also supply `COMPOSIO_API_KEY` and a non-empty `COMPOSIO_AUTH_CONFIGS_JSON` to avoid runtime errors at first tool call.

### 2. Native providers own the default slugs

With `ENABLE_COMPOSIO_PROVIDERS=false`, the default registry exposes:

- `pipedrive` — native (already merged via `#1`)
- `microsoft` — native (implemented via the existing 2026-05-23 spec)
- `google` — native (this spec)

The Composio-backed paths, when enabled, must register under distinct slugs so they never collide with the native slugs:

- `microsoft-composio`
- `google-composio`

The Composio MCP paths, HTTP routes, and CLI commands follow the renamed slug. This means re-enabling Composio post-demotion requires wrappers to opt in by slug and surface the Composio MCP URL explicitly to their Hermes profiles.

### 3. Docs and code retention

- README "Composio-Backed Providers" section is rewritten to: *Composio support is retained as opt-in. Set `ENABLE_COMPOSIO_PROVIDERS=true` and provide `COMPOSIO_API_KEY` plus `COMPOSIO_AUTH_CONFIGS_JSON` to register `microsoft-composio` and `google-composio`. Composio is no longer the default upstream for Microsoft or Google.*
- The untracked `docs/superpowers/specs/2026-05-23-composio-provider-design.md` is updated in-place to add a header `**Status: opt-in fallback. Superseded as default by 2026-05-24-google-native-and-composio-demotion-design.md.**` Then committed in the same PR as the demotion.
- `src/providers/composio/` files are retained as-is. Imports and registrations are gated behind the env flag check at the registration call site, not removed.
- Tests in `test/composio-provider.test.ts` are retained and gated by the same flag — they run when the env flag is set in the test environment, otherwise they skip with a clear reason.

### 4. Disposition of uncommitted Composio work

The local working tree currently has uncommitted Composio-related modifications: `.env.example`, `README.md`, `docs/service-auth-flow.md`, `package.json`, `package-lock.json`, `src/cli.ts`, `src/config.ts`, `src/http.ts`, `src/mcp/server.ts`, `src/providers/defaults.ts`, the untracked `src/providers/composio/` directory, the untracked `docs/superpowers/specs/2026-05-23-composio-provider-design.md`, and the untracked `test/composio-provider.test.ts`.

These represent partially-done Composio integration work that pre-dates the demotion decision. The implementation plan must commit these changes under the new opt-in flag (after adapting registration to read the flag and renaming the slugs to `microsoft-composio` / `google-composio`), not discard them. Discarding them would waste work and leave the demoted-but-retained Composio path subtly broken.

## Wrapper Extension Points

Same as Microsoft. Wrappers own:

- Google app credentials (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) and `GOOGLE_REDIRECT_URI`
- allowed email domains (`GOOGLE_ALLOWED_DOMAINS`)
- enabled provider list
- additional delegated scopes
- tool allowlist and path allowlist for `google_api_request`
- policy rules for actor classes, bot profiles, or high-risk actions (e.g. mail send)
- client-specific smoke tests and deployment runbooks

Wrappers must use template storage, provider registry, session/static-token verification, policy checks, and audit logging. They may add policy hooks but must not bypass the actor-to-Google-login binding model.

## Hermes Bot Profiles

Identical principle to Microsoft. Hermes profiles connect Google as a separate provider from Microsoft and Pipedrive. A bot that needs Gmail, Outlook, and Pipedrive has three separate MCP entries:

- `pipedrive`: `https://<gateway>/mcp/pipedrive`
- `microsoft`: `https://<gateway>/mcp/microsoft`
- `google`: `https://<gateway>/mcp/google`

Each profile completes OAuth with the upstream account it should act as. Cross-provider identity grants are forbidden. Default recommendation: dedicated bot Google accounts for unattended Hermes profiles.

## Audit Requirements

Every Google action appends to the template audit log before returning. Required fields mirror Microsoft, substituting:

- `provider: "google"`
- bound Google login (instead of Microsoft login)
- Google API method and normalized path

Outbound Gmail must record subject hash, recipient count, and attachment count rather than full body content.

## Tests

Unit tests:

- provider registry exposes the Google entry and directory URLs derived from `API_BASE_URL`
- connect URL generation preserves actor, provider, redirect URI, scopes, CSRF state, and uses `access_type=offline` with `prompt=consent` only on first connect
- callback rejects disallowed domain, missing email, `email_verified !== true`, and invalid state
- token binding read, refresh preserves prior refresh token when response omits it, encryption failure, and `invalid_grant` reconnect behavior
- tool handlers resolve identity only from the actor binding, never from tool input
- tool scope checks deny ungranted scopes before calling the Google API
- audit records are written for success, denial, reconnect, and upstream failure
- Composio demotion: with `ENABLE_COMPOSIO_PROVIDERS=false`, default registry has no `microsoft-composio` / `google-composio` entries and Composio service is never constructed
- Composio demotion: with `ENABLE_COMPOSIO_PROVIDERS=true`, registry contains the renamed Composio slugs and native `microsoft` / `google` continue to register without collision

Integration tests:

- mock Google authorize, token, userinfo, Gmail messages, sendMail, and Calendar endpoints
- full connect flow stores an encrypted binding for the authenticated actor
- MCP tool call uses the bound Google login and refreshes an expired token once
- `google_api_request` rejects non-allowlisted method and path combinations
- CLI status never prints access or refresh tokens

Rollout checks:

- run the provider with one non-production wrapper and one test Google Workspace domain
- connect one human test actor and one bot test actor
- verify `GET /providers`, `GET /mcp`, MCP `gateway_list_providers`, and CLI `providers` show the same Google entry
- exercise read-only tools before enabling `gmail_send_email`
- review audit entries before enabling the provider for additional profiles

## Rollout Plan

1. Implement the Microsoft native provider against its existing spec (`2026-05-23-microsoft-provider-design.md`) — service handlers, HTTP routes, MCP tools, CLI commands, tests. Wraps up the unfinished scaffold from commit `a4b241f`.
2. Implement Google native provider per this spec — same surface, mirrored from Microsoft with Google-specific deltas applied.
3. Land Composio demotion in the same PR as step 2 (or in a separate prep PR before step 1 if the in-tree partial Composio work blocks step 1).
4. Update README + Composio spec status + service-auth-flow.md to reflect three native providers as defaults.
5. Wrapper enables Microsoft and Google in a non-production deployment with a test Microsoft tenant and a test Google Workspace domain. No writes enabled.
6. Connect one bot Hermes profile against each provider. Verify audit for at least one day.
7. Enable `outlook_send_email` and `gmail_send_email` behind explicit wrapper policy flags only after read-only audit data is clean.

Decision gate: `outlook_send_email` and `gmail_send_email` require separate wrapper policy flags. Default state is off, even for wrappers that enable the provider.

## Non-Goals

- Do not migrate any existing client deployment as part of this spec. `gateway-genvest` propagation is a separate spec to be written after the template work lands.
- Do not retire `service-api`. That work is downstream of `gateway-genvest` propagation.
- Do not delete any Composio code in this work. Demotion only.
- Do not implement Google tools beyond the v1 surface (no Drive, Docs, Sheets, Slides, Admin SDK, Workspace Admin, or domain-wide delegation flows).
- Do not implement Microsoft Teams, OneDrive, SharePoint, or application-permission flows. Those remain later provider extensions per the Microsoft spec.
- Do not extract a shared `OAuthProvider` base class. Wait until at least three native providers are in tree with their own tool surfaces before deciding whether the abstraction earns its keep.
- Do not couple Google to Microsoft, Pipedrive, or any client-specific workflow. A bound Google login does not grant any other provider.
- Do not support service-account or domain-wide-delegated Google identities in v1. Delegated user auth only.
- Do not expose a raw, unrestricted Google API proxy. `google_api_request` is an allowlisted, GET-only helper.
- Do not store Google refresh tokens outside the template storage and encryption primitives.
