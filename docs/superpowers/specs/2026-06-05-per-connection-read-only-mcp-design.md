# Per-Connection Read-Only MCP — Design Spec

**Status:** draft — pending review
**Issue:** [#33](https://github.com/leebaroneau/template-gateway/issues/33)
**Epic:** [#19](https://github.com/leebaroneau/template-gateway/issues/19)
**Date:** 2026-06-05
**Branch:** `story/33-per-connection-read-only-mcp`

## Context

The MCP v1 subsystem (`src/mcp-v1/`) is a stateless JSON-RPC 2.0 endpoint mounted at `/mcp/v1`. It authenticates with a gateway-wide bearer (`accessStore.authenticate(secret)` → `AuthenticatedGatewayApiClient`) or an auth-gate email header, resolves a `GatewayMcpActor`, checks tool-level scopes against the actor's scopes, and dispatches one of the read-only metadata tools against the **full** gateway state snapshot (`src/mcp-v1/tools.ts`). There is no per-connection filtering today: any token that can call `gateway_list_connections` sees every connection in every brand and region.

This phase adds a **connection-scoped** MCP surface so that each brand+region+connector connection (e.g. "Haverford AU Shopify", `devapi_haverford_au_shopify`) gets its OWN MCP URL and its OWN bearer token. An agent handed that token sees ONLY that connection's read-only tools and data. Three invariants hold:

1. **Per-connection token granularity.** One token → exactly one connection. No multi-connection tokens, no wildcards.
2. **Read-only, structurally enforced.** The connection-scoped tool namespace contains zero write/mutation tools. Read-only is not a runtime scope check that could be loosened — it is enforced by an allowlist of tools each tagged `mode: "read"`, and the dispatcher rejects any name whose mode is not `"read"` before touching state. There is no code path from this surface to a mutating backend method.
3. **Isolation.** A connection token presented at the gateway-wide `/mcp/v1`, or at a different connection's URL, fails. State is filtered to the single bound connection before any tool runs.

### Reuse decision: `gateway_api_keys` lifecycle, not a new secret format

We **reuse the existing key lifecycle** (`src/access/secret.ts` + `GatewayAccessStore.createClient/createKey/rotateKey/revokeKey/authenticate`) and add only a thin binding table. Justification:

- The access store already implements a complete, audited secret lifecycle: `createApiKeySecret` (`gw_live_` prefix, `src/access/secret.ts:9`), `hashApiKeySecret` (scrypt N=16384 r=8 p=1, `secret.ts:21`), `fingerprintApiKeySecret` (SHA256 first 16 hex, the indexed lookup key, `secret.ts:17`), `verifyApiKeySecret` (timing-safe `crypto.timingSafeEqual`, `secret.ts:64`), plus `rotateKey`/`revokeKey` with active-label uniqueness (`assertActiveLabelAvailable`, `store.ts:294`), audit events, and `last_used_at` side-effects. Re-implementing this for connection tokens would duplicate the security-critical timing-safe-comparison path. Building from scratch is the last resort, and it is not warranted here.
- **Opaque store-backed tokens, not JWT.** Instant revocation is a hard requirement (a connection can transition to `needs_reconnect`/`error`, and a leaked agent token must die immediately). JWTs would force a revocation list anyway, re-introducing the DB lookup they were meant to avoid.
- We therefore mint each per-connection token as a real `gateway_api_keys` row under a dedicated, per-connection `gateway_api_clients` record (type `agent`, scopes `["mcp.read"]` only), and add a `gateway_connection_tokens` binding row that ties that key to the connection's identity. Authentication is the existing fingerprint lookup; the binding row resolves the matched key to exactly one connection.

This keeps the secret math in one place and gives us rotation/revocation/audit for free.

### Connection discriminator: `connector_slug` (hyphenated), not `connector_id`

Per the suite-wide decision, the connection-scoping discriminator is the connector's **hyphenated slug** (`shopify`, `google-analytics-4`), read from the connector's `.slug` field (`Connector.slug`, `src/admin/types.ts:60`). The binding table stores `connector_slug` (NOT `connector_id`). It is **derived from the connector record**, never by string-parsing the connection id and never from `connection.connectorId` (which is `connector_shopify`, a different axis). To resolve it on mint, the caller looks up the connection in the snapshot, then finds the connector by `connection.connectorId` and reads `connector.slug`.

### Connection-id format

Dev-API-sourced connection ids use UNDERSCORE normalization: `devapi_<brand>_<region>_<connectorSlugIdParted>`, e.g. `devapi_haverford_au_google_analytics_4` (`idPart` replaces `[^a-z0-9]+` with `_`, `dev-api-mapper.ts:197-203,288`). Fixture-sourced ids use the `connection_<...>` form. All examples in this spec use the underscore form for dev-api ids. The connection id is an opaque path key; the connector slug for tooling is always re-derived from the connector record, never parsed out of the id.

### Auth-gate allowlist

The auth-gate mechanism (`isAllowedAuthGateEmail` against `authGateAllowedDomains`/`authGateAllowedUsers`, `src/mcp-v1/auth.ts`) is respected unchanged. A connection URL may also be reached by an allowed auth-gate email, but with the same connection scoping applied — the auth-gate identity does not bypass the connection filter. The same `feedback_auth_gate_default_allow` caution applies: an empty allowlist denies auth-gate access (it does not fall open), which the existing `hasAllowlist` guard (`auth.ts:80`) already enforces.

> **Required change — export `isAllowedAuthGateEmail`.** It is currently a private, non-exported function (`src/mcp-v1/auth.ts:75`); only `mcpAuthGateEmailFromHeaders` is exported. `connection-auth.ts` cannot import it until it is exported. This spec adds the `export` keyword to that declaration.

## Module Layout

```
src/access/connection-tokens.ts        # ConnectionTokenRecord, CreateConnectionTokenInput, MintedConnectionToken, GatewayConnectionContext types
src/access/store.ts                     # + gateway_connection_tokens table + mint/authenticate/rotate/revoke/list methods
src/mcp-v1/auth.ts                      # EXPORT isAllowedAuthGateEmail (currently private at :75)
src/mcp-v1/connection-auth.ts           # authenticateGatewayConnectionMcpRequest() — connection-token bearer + auth-gate, returns ConnectionMcpActor
src/mcp-v1/connection-routes.ts         # createGatewayConnectionMcpRouter() mounted at /mcp/v1/connections/:connectionId
src/mcp-v1/connection-tools.ts          # connectionScopedTools[] (read-only) + READ_ONLY_MODE allowlist + callConnectionScopedTool()
src/mcp-v1/routes.ts                     # + cross-surface guard in handleToolsList/handleToolCall (reject owner-prefix connection:)
src/mcp-v1/types.ts                     # + ConnectionMcpActor, ScopedToolMode
src/api/routes.ts                       # + 4 token-management endpoints on /api/v1, BEFORE the '*' 404 catch-all (:276)
src/admin/types.ts                      # + connection_token.* + connection_mcp_*.* AuditAction; + 'connection_token' targetType (:112)
src/config.ts                           # + mcpConnectionBaseUrl (case-preserving parser)
src/index.ts                            # mount /mcp/v1/connections/:connectionId; pass mcpConnectionBaseUrl into the /api/v1 router
test/access-connection-tokens.test.ts
test/mcp-connection-auth.test.ts
test/mcp-connection-routes.test.ts
test/mcp-connection-tools.test.ts
test/api-connection-token-routes.test.ts
```

## Data Model

### New table: `gateway_connection_tokens`

Added to `GatewayAccessStore.runMigrations()` (alongside `gateway_api_keys`, same style: plain `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`, the standalone-store pattern — **not** the versioned `gateway_schema_migrations` table). It is a **binding** row: the secret itself lives in `gateway_api_keys` (reusing the entire hash/fingerprint/verify path); this row records which connection the key is scoped to and mirrors lifecycle status for fast listing.

```sql
CREATE TABLE IF NOT EXISTS gateway_connection_tokens (
  id            TEXT PRIMARY KEY,        -- conntok_<ISO-digits>_<hex> (see ID convention below)
  connection_id TEXT NOT NULL,           -- e.g. devapi_haverford_au_shopify / connection_*
  brand_id      TEXT NOT NULL,           -- denormalised connection identity (re-validated per request)
  region_id     TEXT NOT NULL,
  connector_slug TEXT NOT NULL,          -- hyphenated slug from connector.slug (e.g. 'shopify', 'google-analytics-4')
  api_key_id    TEXT NOT NULL UNIQUE,    -- FK to gateway_api_keys.id (one key per token)
  client_id     TEXT NOT NULL,           -- FK to gateway_api_clients.id (per-connection synthetic client)
  label         TEXT NOT NULL,
  status        TEXT NOT NULL,           -- 'active' | 'revoked' (mirrors the key)
  created_at    TEXT NOT NULL,
  created_by    TEXT NOT NULL,
  rotated_at    TEXT,
  revoked_at    TEXT,
  revoked_by    TEXT,
  FOREIGN KEY(api_key_id) REFERENCES gateway_api_keys(id),
  FOREIGN KEY(client_id)  REFERENCES gateway_api_clients(id)
);
CREATE INDEX IF NOT EXISTS gateway_connection_tokens_connection_idx
  ON gateway_connection_tokens(connection_id);
CREATE UNIQUE INDEX IF NOT EXISTS gateway_connection_tokens_active_label_unique_idx
  ON gateway_connection_tokens(connection_id, label)
  WHERE status = 'active';
```

**ID convention.** `conntok_` prefix, generated by the store's existing `generatedId("conntok_")` helper (`store.ts:98`; `${prefix}${ISO-digits}_${randomHex}`), consistent with the `api_client_` / `api_key_` / `api_usage_` prefixes already in use. The `conntok_` prefix is reserved as an immutable contract.

**Why a synthetic per-connection `gateway_api_clients` row.** `authenticate(secret)` (`store.ts:413-525`) joins `gateway_api_keys` → `gateway_api_clients` and requires both `active` (`store.ts:482`). We mint one synthetic client per connection token (`type: "agent"`, `owner: "connection:<connectionId>"`, `scopes: ["mcp.read"]`). This gives us, for free: the active/active gate, the `last_used_at` side-effect, audit events, and an instant revoke surface (revoking the client or key kills the token). The synthetic client is invisible to the connection-token flow's isolation logic (which validates against the binding table); and although the gateway-wide `/mcp/v1` flow can resolve these clients too, the cross-surface guard (Security section) rejects any actor whose backing client `owner` begins with `connection:`, so they can only ever reach their dedicated endpoint.

### New types

```typescript
// src/access/connection-tokens.ts
export interface GatewayConnectionContext {
  connectionId: string;
  brandId: string;
  regionId: string;
  connectorSlug: string;       // hyphenated slug from connector.slug (NOT connectorId)
}

export interface ConnectionTokenRecord extends GatewayConnectionContext {
  id: string;                  // conntok_*
  apiKeyId: string;
  clientId: string;
  label: string;
  preview: string;             // gw_live_...XXXX (from previewApiKeySecret)
  fingerprint: string;
  status: "active" | "revoked";
  createdAt: string;
  createdBy: string;
  rotatedAt?: string;
  revokedAt?: string;
  revokedBy?: string;
  lastUsedAt?: string;         // mirrored from the underlying key
}

export interface CreateConnectionTokenInput {
  connectionId: string;
  context: GatewayConnectionContext; // resolved + validated from the live snapshot by the caller
  label: string;
  actor: string;
}

export interface MintedConnectionToken {
  token: ConnectionTokenRecord;
  secret: string;              // gw_live_... — returned ONCE, never re-fetchable
  mcpUrl: string;              // <mcpConnectionBaseUrl>/mcp/v1/connections/<connectionId> (or relative when unset)
}
```

```typescript
// src/mcp-v1/types.ts (additions)
export type ScopedToolMode = "read"; // intentionally a closed union — adding "write" is a deliberate, reviewed act

export type ConnectionMcpActor =
  | {
      type: "connection_token";
      authMethod: "connection_token";
      actorId: string;            // conntok_* id
      context: GatewayConnectionContext;
      scopes: GatewayApiScope[];  // always exactly ["mcp.read"]
      tokenId: string;
      apiKeyId: string;
      clientId: string;
    }
  | {
      type: "auth_gate";
      authMethod: "auth_gate";
      actorId: string;            // email
      email: string;
      domain: string;
      context: GatewayConnectionContext; // taken from the :connectionId path, validated against snapshot
      scopes: GatewayApiScope[];  // ["mcp.read"]
    };
```

No changes to `Connection`, `GatewayState`, or `configSummary` — connection identity is read from the live snapshot, never stored on the token beyond the denormalised tuple used for fast isolation checks. The tuple is re-validated against the snapshot on every request (defence in depth against stale denormalisation).

### Audit-union edits (owned by THIS spec)

Add to `AuditAction` (`src/admin/types.ts:9-33`):

```typescript
  | "connection_token.created"
  | "connection_token.rotated"
  | "connection_token.revoked"
  | "connection_mcp_auth.succeeded"
  | "connection_mcp_auth.failed"
  | "connection_mcp_tool.listed"
  | "connection_mcp_tool.called"
  | "connection_mcp_tool.failed";
```

And add `'connection_token'` to the closed `AuditEvent.targetType` union (`src/admin/types.ts:112`), so it becomes `"brand" | "region" | "connection" | "api_key" | "api_client" | "connection_token"`. `AccessAuditInput.targetType` (`src/access/types.ts:62`) derives from `AuditEvent["targetType"]`, so it follows automatically — no separate edit there. This is necessary because both unions are closed types and `writeAccessAudit`/`insertAudit` are typed against them; emitting an unlisted action or targetType is a compile error.

Every connection-MCP audit event carries `metadata.authMethod: "connection_token"` (or `"auth_gate"`), `metadata.connectionId`, and `metadata.tokenId`/`metadata.fingerprint`. Audit metadata passes through the existing sanitizer in `insertAudit`, so no secret leaks into logs.

## Access store methods

All added to `GatewayAccessStore`, all wrapped in `this.db.transaction(...)` like the existing lifecycle methods (nested better-sqlite3 transactions are supported and already used throughout the store).

```typescript
mintConnectionToken(input: CreateConnectionTokenInput): MintedConnectionToken;
authenticateConnectionToken(connectionId: string, secret: string): { record: ConnectionTokenRecord; client: ApiClient; key: ApiKey } | undefined;
rotateConnectionToken(connectionId: string, tokenId: string, actor: string): MintedConnectionToken;
revokeConnectionToken(connectionId: string, tokenId: string, actor: string): ConnectionTokenRecord;
listConnectionTokens(connectionId: string): ConnectionTokenRecord[];
```

- **`mintConnectionToken`** — inside one transaction: (1) `createClient({ name: "conn:<connectionId>:<label>", type: "agent", owner: "connection:<connectionId>", scopes: ["mcp.read"] }, actor)`; (2) `createKey(clientId, { label }, actor)` → `{ key, secret }`; (3) insert the `gateway_connection_tokens` binding row (with `connector_slug` from `input.context`); (4) `writeAccessAudit({ action: "connection_token.created", targetType: "connection_token", targetId: token.id, actor, metadata: { connectionId, connectorSlug, fingerprint, clientId, keyId } })`. Returns `{ token, secret, mcpUrl }`. The secret is returned once and is never re-fetchable.
- **`authenticateConnectionToken(connectionId, secret)`** — reuses the existing fingerprint path: call `this.authenticate(secret)` (which does the `fingerprintApiKeySecret` lookup, `verifyApiKeySecret` timing-safe compare, requires both key+client active, and fires the `last_used_at` update — `store.ts:413-525`). If it returns `undefined`, return `undefined`. Otherwise load the binding row by `api_key_id` and assert `binding.connection_id === connectionId AND binding.status = 'active'`. If the fingerprint matches a key bound to a *different* connection, return `undefined` (isolation). On success return `{ record, client, key }`.
- **`rotateConnectionToken`** — reuse `rotateKey(clientId, apiKeyId, actor)` (which throws 409 if the key or client is revoked — `store.ts:337,341`), set `rotated_at` on the binding, keep the same `connection_id`/`connector_slug` binding and `conntok_*` id, write a `connection_token.rotated` audit, return `{ token, secret, mcpUrl }`. The old secret stops verifying immediately because `rotateKey` re-hashes.
- **`revokeConnectionToken`** — reuse `revokeKey(clientId, apiKeyId, actor)` + flip binding `status='revoked'`, set `revoked_at`/`revoked_by`, write a `connection_token.revoked` audit. `revokeKey` throws 409 on an already-revoked key (`store.ts:388`); the method catches that case and treats a double-revoke as an idempotent no-op (returns the already-revoked record). Optionally also `updateClient(clientId, { status: 'revoked' }, actor)` to kill the synthetic client.
- **`listConnectionTokens(connectionId)`** — read binding rows for the connection (no secrets), hydrate `preview`/`fingerprint`/`lastUsedAt` from the joined key.

## MCP / API Surface

### Connection-scoped JSON-RPC endpoint

`POST /mcp/v1/connections/:connectionId` — mounted via `createGatewayConnectionMcpRouter` in `src/index.ts` as its OWN mount (`app.use("/mcp/v1/connections/:connectionId", ...)`), registered alongside the existing `/mcp/v1` mount (`src/index.ts:79-88`). The existing `/mcp/v1` router only handles `'/'` (`router.post("/")` + `router.all("/")`, `routes.ts:47-52`), so sub-paths under `/mcp/v1` would 404 there; the connection mount must therefore be a distinct `app.use(...)` so it is reachable and not shadowed. Express matches the more specific path; register the connection mount adjacent to the `/mcp/v1` mount.

**Auth middleware** (`src/mcp-v1/connection-auth.ts`, modelled on `authenticateRequest` in `routes.ts:64-109`):
1. Read `:connectionId` from the path.
2. Resolve the live snapshot, find the connection. If absent → `404 not_found`. If `connection.status !== "connected"` → `403 forbidden` with code `connection_unavailable`. (The real `ConnectionStatus` union is `needs_config | pending | connected | needs_reconnect | error` — `src/admin/types.ts:5`. `connected` is the only usable state; the other four are all unavailable. There is NO `active`/`disabled` connection status — those are `EntityStatus` for brands/regions.) We do not leak metadata for unavailable connections beyond the coarse status itself.
3. Bearer path: `authenticateConnectionToken(connectionId, bearerSecret)`. On success, build a `connection_token` actor with `context` from the binding (re-validated against the snapshot tuple — `brandId`/`regionId`/`connectorSlug` must match the live connection).
4. Auth-gate path: if no/invalid bearer, fall back to `mcpAuthGateEmailFromHeaders(headers)` + `isAllowedAuthGateEmail(email, authGateAllowedDomains, authGateAllowedUsers)`. On success, build an `auth_gate` actor whose `context` is the path connection's tuple. Empty allowlist denies (no fall-open).
5. On failure: `connection_mcp_auth.failed` audit + `401`/`403`. On success: `connection_mcp_auth.succeeded` audit with `metadata.connectionId` + auth method.

**JSON-RPC methods** (subset of the gateway-wide handler):
- `initialize` → `serverInfo.name: "haverford-gateway-connection"`, `serverInfo.version: "v1"`, capabilities `{ tools: { listChanged: false } }`.
- `notifications/initialized` → `202`.
- `ping` → `{}`.
- `tools/list` → returns ONLY `connectionScopedTools` (below). Gated on `scopeAllowed(actor.scopes, "mcp.read")` (always true for these actors). Audits `connection_mcp_tool.listed`.
- `tools/call` → see read-only enforcement below.

Mint response example (`POST /api/v1/connections/:connectionId/mcp-tokens`):
```json
{
  "token": {
    "id": "conntok_20260605T041200000Z_9f3a1c20",
    "connectionId": "devapi_haverford_au_shopify",
    "brandId": "brand_haverford",
    "regionId": "region_haverford_au",
    "connectorSlug": "shopify",
    "label": "haverford-au-shopify-agent",
    "preview": "gw_live_...8x2k",
    "fingerprint": "3f9c1e0a7b2d4c81",
    "status": "active",
    "createdAt": "2026-06-05T04:12:00.000Z"
  },
  "secret": "gw_live_8aF...redacted-in-logs...8x2k",
  "mcpUrl": "https://gateway.haverford.au/mcp/v1/connections/devapi_haverford_au_shopify"
}
```

`tools/list` response on the connection URL:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "tools": [
      { "name": "connection_get", "description": "Get this connection's metadata.", "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false } },
      { "name": "connection_status", "description": "Get this connection's status.", "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false } },
      { "name": "connection_list_app_installs", "description": "List app installs for this connection's brand+region.", "inputSchema": { "type": "object", "properties": { "status": { "type": "string", "enum": ["pending", "enabled", "disabled", "error"] } }, "additionalProperties": false } }
    ]
  }
}
```

(The `status` enum on `connection_list_app_installs` is the app-install status `GatewayAppInstallStatus = pending | enabled | disabled | error` — `src/apps/types.ts:1` — which is distinct from `ConnectionStatus` and is the correct filter for `appInstallStore.listInstalls({ status })`, `src/apps/store.ts:103-107`.)

### Connection-scoped tools (read-only, structural enforcement)

`src/mcp-v1/connection-tools.ts`. Each tool carries an explicit `mode`. The union `ScopedToolMode = "read"` is closed; the dispatcher refuses anything else. `GatewayMcpToolResult` (`{ content, structuredContent, isError }`, `src/mcp-v1/types.ts:26`) and the `toolError` helper (`src/mcp-v1/tools.ts`) are reused.

```typescript
interface ConnectionScopedToolDefinition extends McpToolDefinition {
  mode: ScopedToolMode; // must be "read"
}

const READ_ONLY_MODE: ScopedToolMode = "read";

export const connectionScopedTools: ConnectionScopedToolDefinition[] = [
  { name: "connection_get",               mode: "read", description: "...", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "connection_status",            mode: "read", description: "...", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "connection_list_app_installs", mode: "read", description: "...", inputSchema: { type: "object", properties: { status: { type: "string", enum: ["pending", "enabled", "disabled", "error"] } }, additionalProperties: false } }
];

export async function callConnectionScopedTool(
  name: string,
  args: unknown,
  context: GatewayConnectionContext,
  state: GatewayState,
  appInstallStore?: GatewayAppInstallStore
): Promise<GatewayMcpToolResult> {
  const def = connectionScopedTools.find((t) => t.name === name);
  if (def === undefined || def.mode !== READ_ONLY_MODE) {
    return toolError(`Unknown or non-read tool: ${name}`); // structural reject — no state touched
  }
  // Filter state to ONLY the target connection before any read runs.
  const scoped = filterStateToConnection(state, context);
  switch (name) {
    case "connection_get":               return getThisConnection(scoped, context);
    case "connection_status":            return getThisConnectionStatus(scoped, context);
    case "connection_list_app_installs": return listThisConnectionInstalls(args, context, appInstallStore);
    default:                             return toolError(`Unknown tool: ${name}`);
  }
}
```

`filterStateToConnection(state, ctx)` returns a `GatewayState` whose `connections` is `[targetConnection]`, `brands` is `[parentBrand]`, `regions` is `[parentRegion]`, `connectors` is `[parentConnector]` — everything else empty. This is the structural isolation boundary: even if a tool implementation tried to read `state.connections`, it would only ever see the one connection.

Read-only is enforced at three layers, none of which a caller can widen:
1. **No write tools exist** in `connectionScopedTools`. There is no name a caller could pass that maps to a mutation.
2. **Mode allowlist.** Every definition is `mode: "read"`; the dispatcher rejects any def whose mode is not `READ_ONLY_MODE`. The `ScopedToolMode` union has no `"write"` member, so adding one is a compile-time, code-review-visible change.
3. **No backend mutation reachable.** `callConnectionScopedTool` only ever calls `backend.snapshot()` (read) and `appInstallStore.listInstalls` (read). It never receives or calls `createConnection`, `updateBrand`, `createInstall`, `createClient`, etc.

> **Note on scopes (correction).** `scopeAllowed` (`src/access/types.ts:88-96`) does NOT implement a general write-implies-read rule — it only maps `api_clients.write → api_clients.read` and `apps.write → apps.read`. There is no `mcp.write` scope at all in `gatewayApiScopes` (`types.ts:3-14`). The synthetic client is granted exactly `["mcp.read"]`; the connection MCP never checks or honours any `.write` scope, so the matter is moot. The grant decision is correct; the earlier "write implies read" justification was not.

`connection_get` returns the `GatewayConnectionApiResource` for the bound connection (via `toConnectionApiResource(state, connection)`, `src/api/resources.ts:62`, which redacts secrets through `safeConfigSummary`).

`connection_status` sources its fields from the right places (correction — the raw `Connection` does NOT have `runtimeStatus`/`migrationStatus`):
- `status`, `lastTestedAt`, `lastUsedAt`, `lastError` come from the **raw `Connection`** (`src/admin/types.ts:70-82`).
- `runtimeStatus`, `migrationStatus` come from `toConnectionApiResource(state, connection)` (`src/api/resources.ts:62`), where they are currently HARD-CODED constants `"metadata_only"` and `"not_started"` (`resources.ts:74-75`) — they are not per-connection runtime values. We surface them as-is for forward-compatibility.
- When `status !== "connected"`, `connection_status` returns only the coarse `status` enum and deliberately **omits** `lastError` and config detail (avoids leaking auth/config failure detail). In practice the auth middleware already 403s before any tool runs for non-`connected` connections, so this branch is defence in depth.

### Authenticated token-management endpoints (on `/api/v1`, NOT the admin router)

> **Correction — endpoint placement.** `createAdminRouter` performs NO bearer/scope authentication; `actorFromRequest` (`src/admin/routes.ts:60-68`) only reads headers for audit attribution and falls back to `local-admin`. Scope enforcement (`api_clients.read`/`api_clients.write`) exists ONLY on the `/api/v1` router via `gatewayApiAuth + assertGatewayApiScope` (`src/api/auth.ts:25-76`, `src/api/routes.ts:73-124`). Therefore all four authenticated token-management endpoints go on the `/api/v1` router, NOT the admin router. They are registered in `createGatewayApiRouter` BEFORE the `router.use("*", ...)` 404 catch-all at `src/api/routes.ts:276`, using the existing `gatewayApiRead(...)`-style middleware pattern (or a write-capable analogue) so `gatewayApiAuth(accessStore, '<scope>')` runs first and `assertGatewayApiScope` gates the scope.

These endpoints need the `mcpConnectionBaseUrl` config (threaded into `CreateGatewayApiRouterOptions` from `src/index.ts`) so the mint/rotate responses can emit the absolute `mcpUrl`. Before minting, the route resolves the connection from the live snapshot, requires `status === "connected"`, and derives `connectorSlug` from the connector record (`connector.slug` where `connector.id === connection.connectorId`) — so a token can never be minted for a broken/non-existent connection.

| Method | Path | Scope | Behaviour |
|---|---|---|---|
| POST | `/api/v1/connections/:connectionId/mcp-tokens` | `api_clients.write` | Mint; body `{ label }`; returns `MintedConnectionToken` (secret once) |
| GET | `/api/v1/connections/:connectionId/mcp-tokens` | `api_clients.read` | List (no secrets) |
| POST | `/api/v1/connections/:connectionId/mcp-tokens/:tokenId/rotate` | `api_clients.write` | Rotate; returns new secret once |
| DELETE | `/api/v1/connections/:connectionId/mcp-tokens/:tokenId` | `api_clients.write` | Revoke |

Active-label uniqueness per connection is enforced by the binding's partial unique index (mirrors the key's `assertActiveLabelAvailable`); re-minting needs a unique active label, e.g. `haverford-au-shopify-agent-2`.

### Config

> **Correction — new config field.** `src/config.ts` has no base-URL setting today. Add `mcpConnectionBaseUrl?: string` to `GatewayConfig` (`config.ts:7-27`), parsed from a new env var `MCP_CONNECTION_BASE_URL`. The parser MUST preserve case — do NOT route it through `parseCommaList` (`config.ts:51-58`), which lowercases — use a dedicated `optionalEnv(env, "MCP_CONNECTION_BASE_URL")` read (trim only, no case-folding) so `https://Gateway.Haverford.au` survives intact. When unset, `mcpUrl` is emitted as a relative path (`/mcp/v1/connections/<connectionId>`); the caller (the agent operator) is expected to prefix the gateway origin. Document this fallback explicitly so an unconfigured deployment still returns a usable, unambiguous path.

## Security

- **Token secrets** use the existing `gw_live_` scrypt (N=16384, r=8, p=1, `secret.ts:6`) hash and SHA256-first-16 fingerprint lookup; plaintext is never stored and only returned at mint/rotation. Verification is `verifyApiKeySecret`'s constant-time `crypto.timingSafeEqual` (`secret.ts:64`).
- **Isolation.** A token's fingerprint may match in `gateway_api_keys`, but `authenticateConnectionToken` additionally requires the binding's `connection_id` to equal the URL's `:connectionId`. A token bound to connection A presented at connection B's URL returns `undefined` → 401.
- **Cross-surface guard (edit to the EXISTING gateway-wide router).** Presenting a connection token at `/mcp/v1` (gateway-wide) would otherwise authenticate as a normal client with `["mcp.read"]` and see gateway-wide tools. To close this, `src/mcp-v1/routes.ts` `handleToolsList` (~`routes.ts:156`) and `handleToolCall` (~`routes.ts:188`) gain a guard: when `actor.type === "api_client"` and `actor.authenticated.client.owner` begins with `connection:`, reject with `403 forbidden` ("connection-scoped tokens must use their connection URL"). Note `actorMetadata`/`recordUsage` only branch on `type === "api_client"` (`routes.ts:275,302`), so the guard reads `actor.authenticated.client.owner` only for that variant. `src/mcp-v1/routes.ts` is therefore in the changed-files set.
- **No write scopes.** Synthetic clients are created with exactly `["mcp.read"]`. There is no `mcp.write` scope in the system; the connection MCP never checks any `.write` scope.
- **Revocation is instant.** Opaque store-backed tokens mean the next request after `revokeConnectionToken` (or after the connection leaves `connected`) fails at auth. No JWT TTL window.
- **Connection-state gating.** The auth middleware returns `403 connection_unavailable` when `connection.status !== "connected"` (i.e. any of `needs_config`/`pending`/`needs_reconnect`/`error`). `connection_status` may still report the coarse status but never `lastError` or config detail for non-`connected` connections.
- **Audit.** Every auth and tool event is written with `authMethod` (`connection_token` vs `auth_gate`), `connectionId`, `tokenId`/`fingerprint`. Audit metadata passes through `insertAudit`'s sanitizer so no secret leaks into logs.
- **Auth-gate allowlist** unchanged and still fail-closed on empty allowlist (`auth.ts:80`); auth-gate identity does not bypass connection scoping.
- **No impersonation.** The connection endpoint ignores any caller-supplied identity header beyond the auth-gate email priority list (`mcpAuthGateEmailFromHeaders`, `auth.ts:57`): the actor context is fixed by the token's binding, not by a caller-supplied header.

## Testing Strategy

- **`test/access-connection-tokens.test.ts`**
  - `mintConnectionToken` returns a `gw_live_` secret, a `conntok_*` id, an `mcpUrl` containing the connection id, and `connectorSlug` equal to the connector's hyphenated `.slug`.
  - `authenticateConnectionToken(connectionId, secret)` succeeds for the bound connection (returns `{ record, client, key }`).
  - `authenticateConnectionToken(otherConnectionId, secret)` returns `undefined` (isolation).
  - Secret is not re-fetchable; `listConnectionTokens` never returns a secret.
  - `rotateConnectionToken` returns a new secret; the old secret no longer authenticates; same `conntok_*` id and binding preserved.
  - `revokeConnectionToken` makes the next `authenticateConnectionToken` return `undefined`; idempotent on an already-revoked token (no 409 thrown to the caller).
  - Active-label uniqueness per connection enforced; a revoked label may be reused.
  - Synthetic client carries scopes exactly `["mcp.read"]` and `owner` prefixed `connection:`.
- **`test/mcp-connection-auth.test.ts`**
  - Valid bearer → `connection_token` actor with correct `context` tuple (including hyphenated `connectorSlug`).
  - Bearer for a different connection → 401.
  - Unknown `:connectionId` → 404; connection with `status` in `{needs_config, pending, needs_reconnect, error}` → 403 `connection_unavailable`; only `connected` is admitted.
  - Auth-gate allowed email → `auth_gate` actor scoped to the path connection; disallowed/empty-allowlist email → 401.
  - A non-auth-gate caller-supplied identity header is ignored (context unchanged).
- **`test/mcp-connection-tools.test.ts`**
  - `connection_get` returns only the target connection (secrets redacted via `safeConfigSummary`).
  - `filterStateToConnection` yields exactly one connection/brand/region/connector; a tool cannot observe sibling connections.
  - `connection_status` sources `runtimeStatus`/`migrationStatus` from `toConnectionApiResource` (asserts `metadata_only`/`not_started`) and `status`/`lastTestedAt`/`lastUsedAt` from the raw Connection; omits `lastError` when status is not `connected`.
  - `connection_list_app_installs` returns installs only for the connection's brand+region (via `listInstalls({ brandId, regionId, status })`).
  - Calling a non-read / unknown tool name returns a JSON-RPC tool error and does NOT touch the backend (assert `snapshot`/store read not invoked for the reject path).
- **`test/mcp-connection-routes.test.ts`** (supertest)
  - `tools/list` on `/mcp/v1/connections/:id` returns only the 3 connection-scoped tools (none of the gateway-wide tools).
  - End-to-end `tools/call connection_get` with a minted token returns the bound connection; another connection's token → 401.
  - A connection token presented at gateway-wide `/mcp/v1` `tools/list` AND `tools/call` → 403 (owner `connection:` rejected by the cross-surface guard).
  - Revoked token → 401 on the next request.
  - JSON-RPC `initialize`/`ping` work; invalid JSON → -32700; unknown method → -32601.
  - `connection_mcp_auth.succeeded`/`.failed` and `connection_mcp_tool.called` audit events written with `connectionId` + `authMethod`.
- **`test/api-connection-token-routes.test.ts`** (supertest, against the `/api/v1` router)
  - POST mint with a valid bearer carrying `api_clients.write` returns the secret once + `mcpUrl`; a bearer lacking the scope → 403; no bearer → 401.
  - Mint against unknown connection → 404; against a non-`connected` connection → 400/403.
  - GET list with `api_clients.read` (or `api_clients.write`, via `scopeAllowed`) returns tokens with no secrets.
  - Rotate returns a new secret; DELETE revokes; double-revoke is safe.

## Verification Gate

`npm run typecheck` clean, `npm run build` clean, full `npm test` green.
