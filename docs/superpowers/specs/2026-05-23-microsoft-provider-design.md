# Microsoft Provider Design

## Goal

Add a provider-agnostic Microsoft 365 provider design to `template-gateway` so future `gateway-<client>` wrapper repos can offer Microsoft Graph access through the shared gateway model.

The provider follows `docs/service-auth-flow.md`: an actor requests Microsoft, the gateway returns a Microsoft login URL, the callback binds that actor to the signed-in Microsoft login, and future MCP, API, or CLI requests act as that Microsoft login through gateway policy and audit.

This is a design spec only. It does not migrate any existing client deployment and does not implement Microsoft tools.

## Provider Registry

The template should register Microsoft through the existing provider registry shape:

```ts
{
  slug: "microsoft",
  name: "Microsoft 365",
  description: "Microsoft Graph access for Outlook mail, Calendar, and selected Graph operations.",
  auth: "oauth",
  mcpPath: "/mcp/microsoft",
  scopesSummary: "Delegated Microsoft Graph access for the connected Microsoft login."
}
```

`GET /providers`, `GET /mcp`, `gateway_list_providers`, and `npm run cli -- providers` should all derive from the same registry entry. Wrapper repos may hide the provider by configuration, but must not create a parallel provider directory.

## OAuth and Tenant Gates

Microsoft OAuth is delegated auth only. The gateway acts as the user or bot Microsoft account that completed the OAuth flow, not as an application-wide mailbox.

Required app settings:

- `MICROSOFT_CLIENT_ID`
- `MICROSOFT_CLIENT_SECRET`
- `MICROSOFT_TENANT_ID`
- `MICROSOFT_REDIRECT_URI`, defaulting to `${API_BASE_URL}/auth/microsoft/callback`
- `MICROSOFT_ALLOWED_TENANTS`, defaulting to the configured tenant ID
- `MICROSOFT_ALLOWED_DOMAINS`, defaulting to `ALLOWED_EMAIL_DOMAINS`
- `MICROSOFT_TOKEN_STORE_PATH`, defaulting to the template token data directory
- `MICROSOFT_TOKEN_STORE_KEY`, a 32-byte base64 secret for encrypting refresh-token material

Callback shape:

1. Validate OAuth state, provider slug, and actor session reference.
2. Exchange the authorization code with the configured tenant authority.
3. Fetch `GET https://graph.microsoft.com/v1.0/me`.
4. Resolve the Microsoft login from `mail` or `userPrincipalName`, lowercase it, and require it to match the allowed tenant and domain gates.
5. Store a binding for `{actor, provider: "microsoft", microsoftLogin}` with encrypted token material.
6. Return the gateway authorization result expected by the initiating MCP, API, or CLI flow.

Decision gate: multi-tenant Microsoft apps are allowed only when a wrapper has a real external-account requirement. Default recommendation is single tenant plus explicit allowed-domain gates.

## Actor Binding and Storage

The binding key is the gateway actor plus provider slug. The bound upstream identity is the exact Microsoft login that completed OAuth. Tool inputs must never contain an `as`, `from`, `mailbox`, or equivalent identity override that changes the Microsoft login used for a request.

Stored binding record:

```json
{
  "actorId": "profile-or-user-id",
  "actorEmail": "agent@example.com",
  "provider": "microsoft",
  "upstreamLogin": "agent@example.com",
  "tenantId": "tenant-guid",
  "scope": "offline_access User.Read Mail.Read Mail.Send Calendars.Read",
  "expiresAt": "2026-05-23T12:00:00.000Z",
  "tokenCiphertext": "base64",
  "createdAt": "2026-05-23T10:00:00.000Z",
  "updatedAt": "2026-05-23T10:00:00.000Z"
}
```

The encrypted payload contains access token, refresh token, token type, account ID, and provider token metadata. Refresh is lazy on first use after expiry. If refresh returns `invalid_grant`, mark the binding disconnected and return a reconnect response instead of deleting audit history.

## MCP, API, and CLI Surface

MCP:

- `/mcp/microsoft` exposes Microsoft tools for actors with a Microsoft binding.
- `gateway_list_providers` lists Microsoft when enabled.
- `microsoft_status` returns connected or reconnect-required state for the current actor.
- `microsoft_list_tools` returns the enabled Microsoft tool names and required scopes for the current deployment.

HTTP API:

- `GET /providers` includes the Microsoft entry when enabled.
- `GET /auth/microsoft/connect` returns an OAuth login URL for the authenticated actor.
- `GET /auth/microsoft/callback` completes the OAuth flow.
- `GET /providers/microsoft/status` returns binding status for the authenticated actor.
- `GET /providers/microsoft/tools` returns available tool metadata.

CLI:

- `providers` lists Microsoft through the registry.
- `microsoft connect --actor <id-or-email>` prints a connect URL for operator-assisted setup.
- `microsoft status --actor <id-or-email>` reports bound login, scopes, expiry, and reconnect state without printing secrets.

Decision gate: if the first implementation cannot add all three transport surfaces at once, ship registry plus MCP and status first. Do not ship Graph actions without a status/readiness path.

## First Tool Surface

The first implementation should be intentionally small. Recommended v1 surface:

- `outlook_list_messages`, `GET /me/messages`, scope `Mail.Read`
- `outlook_send_email`, `POST /me/sendMail`, scope `Mail.Send`
- `calendar_list_events`, `GET /me/calendar/events`, scope `Calendars.Read`
- `graph_request`, allowlisted generic Graph request for `GET` only, limited to `/me`, `/me/messages`, and `/me/calendar` paths

Writes should start with mail send only. Calendar write, message move/delete, OneDrive, Teams, SharePoint, and application-permission flows are later provider extensions.

Scope boundary:

- Default requested scopes: `offline_access User.Read Mail.Read Mail.Send Calendars.Read`.
- A wrapper may request additional delegated scopes through configuration, but the provider must reject any tool whose required scope is not present in the actor binding.
- `graph_request` must use an allowlist of methods and path prefixes. It is not a raw Graph proxy.

## Audit Requirements

Every Microsoft action must append to the template audit log before returning to the caller. Required fields:

- `provider: "microsoft"`
- gateway actor ID and actor email
- bound Microsoft login
- transport, such as `mcp`, `api`, or `cli`
- tool or action name
- Graph method and normalized path, with query values redacted when sensitive
- requested scopes and required tool scope
- status: `ok`, `denied`, `reconnect_required`, or `error`
- upstream request ID when Microsoft returns one
- duration and timestamp

Outbound mail must include non-recipient-visible attribution when Graph supports it, such as `internetMessageHeaders`, and the audit log must record subject hash, recipient count, and attachment count rather than full body content.

## Wrapper Extension Points

Wrapper repos named `gateway-<client>` own client-specific configuration:

- Microsoft app credentials and redirect URI
- allowed tenant IDs and email domains
- enabled provider list
- additional delegated scopes
- tool allowlist and path allowlist for `graph_request`
- policy rules for actor classes, bot profiles, or high-risk actions
- client-specific smoke tests and deployment runbooks

Wrappers must use template storage, provider registry, session/static-token verification, policy checks, and audit logging. They may add policy hooks, but they must not bypass the actor-to-Microsoft-login binding model.

## Hermes Bot Profiles

Hermes profiles should connect Microsoft as a separate provider from Pipedrive or any other service. A bot that needs CRM and Microsoft access should have separate MCP entries, for example:

- `pipedrive`: `https://<gateway>/mcp/pipedrive`
- `microsoft`: `https://<gateway>/mcp/microsoft`

Each profile completes Microsoft OAuth with the Microsoft mailbox it should act as. A shared Pipedrive identity does not imply Microsoft access, and a Microsoft bot mailbox does not imply CRM access. If one Hermes profile needs to act as two Microsoft logins, configure two separate Microsoft provider connections with explicit names and separate bindings.

Default recommendation: dedicated bot Microsoft accounts for unattended Hermes profiles. Human-owned Microsoft accounts should be used only when the profile is explicitly acting as that human and the audit trail identifies the bot actor.

## Tests

Unit tests:

- provider registry exposes the Microsoft entry and directory URLs from `API_BASE_URL`
- connect URL generation preserves actor, provider, redirect URI, scopes, and CSRF state
- callback rejects disallowed tenant, disallowed domain, missing email, and invalid state
- token binding read, refresh, encryption failure, and `invalid_grant` reconnect behavior
- tool handlers resolve identity only from the actor binding, never from tool input
- tool scope checks deny ungranted scopes before calling Graph
- audit records are written for success, denial, reconnect, and upstream failure

Integration tests:

- mock Microsoft authorize, token, `/me`, messages, sendMail, and calendar endpoints
- full connect flow stores an encrypted binding for the authenticated actor
- MCP tool call uses the bound Microsoft login and refreshes an expired token once
- `graph_request` rejects non-allowlisted method and path combinations
- CLI status never prints access or refresh tokens

Rollout checks:

- run the provider with one non-production wrapper and one test Microsoft tenant
- connect one human test actor and one bot test actor
- verify `GET /providers`, `GET /mcp`, MCP `gateway_list_providers`, and CLI `providers` show the same Microsoft entry
- exercise read-only tools before enabling `outlook_send_email`
- review audit entries before enabling the provider for additional profiles

## Rollout Plan

1. Add registry, config, OAuth state, callback, encrypted token binding, status, and list-tools surfaces.
2. Add mock-backed tests for connect, callback, binding, refresh, policy, and audit.
3. Enable Microsoft in a wrapper repo with a test tenant and no write tools.
4. Add the v1 tool surface behind wrapper configuration.
5. Enable one Hermes bot profile with its own Microsoft login and verify audit for at least one day.
6. Expand to additional profiles only after reconnect handling and audit review are proven.

Decision gate: enable `outlook_send_email` only after read-only audit data is clean. Default recommendation is to require an explicit wrapper policy flag for mail send.

## Non-Goals

- Do not migrate any existing client deployment as part of this spec.
- Do not implement Microsoft tools inside this spec.
- Do not couple Microsoft to Pipedrive, CRM stages, or any client-specific workflow.
- Do not create a unified identity where one provider login grants access to another provider.
- Do not support Microsoft application permissions in v1.
- Do not expose a raw, unrestricted Graph proxy.
- Do not store Microsoft refresh tokens outside the template storage and encryption primitives.
