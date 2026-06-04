# Haverford Unified Gateway Phase 2 Access API Front Door - Design Spec

**Status:** draft for Lee review  
**Issue:** [#19](https://github.com/leebaroneau/template-gateway/issues/19)  
**Date:** 2026-06-04  
**Repo:** `leebaroneau/template-gateway`

## Context

Phase 1.5 made the Haverford Unified Gateway useful as a persistent admin control plane. It can read current Dev API state, add gateway-owned brands, regions, and connections, store safe overrides on the gateway data volume, show provenance, and reset source overrides.

The next phase should let Haverford users and clients start changing their API base URL to the gateway without forcing the OAuth migration first. The gateway should store and manage the current setup, expose a stable versioned API contract for that setup, and add gateway-owned API access controls. Current provider execution remains backed by the current setup and later phases; Phase 2 should not pretend OAuth, Nango, Composio, native connector execution, or MCP read routing are complete.

## Confirmed Decisions

- `/admin/*` remains the internal admin UI/API surface, not the public API contract.
- `/api/v1/*` becomes the canonical gateway API for new Haverford clients.
- `/api/compat/*` is reserved for narrow compatibility aliases only when a real current client needs a Dev API-shaped route.
- `/mcp` remains a separate surface. MCP capability/tool versioning is handled by the MCP contract, not by copying the HTTP API version.
- Current setup should remain manageable through the gateway while OAuth is being built later.
- Connection setup in this phase stores safe metadata and references only. Raw secrets, OAuth tokens, service-account JSON, and bearer values remain forbidden.
- Provider execution and real OAuth connection flow are out of scope for Phase 2.

## Goals

- Let clients point their API base URL at the gateway for brand, region, connector, connection, and access metadata.
- Add persistent gateway API clients and API keys to the existing `/data/gateway.sqlite` store.
- Support API key creation with one-time secret reveal, key hashing, preview, fingerprint, rotation, revocation, and last-used tracking.
- Add scopes/permissions for the new `/api/v1` metadata routes.
- Add usage counters and audit history for API authentication, allowed reads, denied reads, key creation, rotation, revocation, and scope changes.
- Add an explicit transition setup model for current/manual-ref connections so the UI/API can distinguish current setup from later OAuth-managed setup.
- Preserve the Phase 1.5 merged source model: Dev API and fixture source records plus gateway-owned records plus gateway overrides.

## Non-Goals

- Do not proxy live provider read/write calls in `/api/v1` yet.
- Do not implement native Google OAuth, Nango auth, Composio setup wiring, or token refresh.
- Do not expose current Dev API secrets or deployment env vars through the gateway.
- Do not try to clone the Dev API route-for-route.
- Do not add write-capable MCP tools.
- Do not migrate existing Dev API credential storage into the gateway.

## Recommended Architecture

Use the existing Phase 1.5 admin backend as the canonical read model for control-plane state, then layer a public API router and access store around it:

```text
HTTP clients
  -> /api/v1
    -> Gateway API auth middleware
      -> GatewayAccessStore on /data/gateway.sqlite
      -> GatewayConnectionBackend snapshot
        -> Dev API source or fixture source
        -> gateway overlay records and overrides
```

This avoids unnecessary custom code because:

- The brand/region/connector/connection model already exists in `GatewayState`.
- The Dev API read-through adapter already imports current setup records.
- The overlay store already owns SQLite migration and audit primitives.
- Dev API's internal client model gives a proven local pattern for scopes, secret hashing, rotation, revocation, and one-time reveal.

The custom Phase 2 surface should be small:

- API key/client tables and helper methods in the gateway store.
- A scoped API auth middleware for `/api/v1`.
- A read-only `/api/v1` router backed by `GatewayConnectionBackend.snapshot()`.
- Setup-mode fields on connection API responses.
- Admin/API routes for creating, rotating, revoking, and listing gateway API clients.

## Public API Shape

`/api/v1` is the stable external contract for new clients. It should use gateway-shaped resources, not Dev API internals.

Initial read routes:

```text
GET /api/v1/health
GET /api/v1/brands
GET /api/v1/brands/:brandId
GET /api/v1/brands/:brandId/regions
GET /api/v1/regions/:regionId
GET /api/v1/regions/:regionId/connections
GET /api/v1/connectors
GET /api/v1/connectors/:connectorId
GET /api/v1/connections
GET /api/v1/connections/:connectionId
GET /api/v1/me
```

Write/mutation routes are limited to API access management and should require admin scopes:

```text
POST /admin/api/api-clients
PATCH /admin/api/api-clients/:clientId
POST /admin/api/api-clients/:clientId/keys
POST /admin/api/api-clients/:clientId/keys/:keyId/rotate
POST /admin/api/api-clients/:clientId/keys/:keyId/revoke
```

The admin UI can continue using `/admin/api/state` for its richer whole-page state. `/api/v1` should be a consumer-facing contract and should not return implementation-only UI payloads.

In production, `/admin/*` is expected to sit behind Auth Gate or trusted internal routing. Admin mutations should record an actor from trusted identity headers when available, falling back to an explicit local development actor in local smoke tests.

## API Authentication

Phase 2 should use API keys for `/api/v1`:

```http
Authorization: Bearer gw_live_<secret>
```

The gateway stores:

- API client metadata.
- Hashed key secret using `scrypt` or the same crypto approach as Dev API internal clients.
- Key preview and fingerprint.
- Key status: `active` or `revoked`.
- Created/rotated/revoked timestamps and actor.
- Last-used timestamp and counters.

Secrets are revealed once at creation or rotation. After that, only preview and fingerprint are visible.

## Scopes

Initial Phase 2 scopes:

```text
brands.read
regions.read
connectors.read
connections.read
api_clients.read
api_clients.write
audit.read
```

Scope behavior:

- `api_clients.write` implies `api_clients.read`.
- No route grants access without a matching scope.
- Unknown scopes are rejected when creating or updating clients.
- Revoked clients and revoked keys cannot authenticate.
- Authentication failures and missing-scope denials are audited.

MCP-oriented scopes such as `mcp.read` can be reserved in the schema, but the actual MCP read gateway should wait for Phase 3.

## Transition Setup Model

Phase 2 should expose current setup explicitly instead of implying it is already OAuth-managed.

Add these response-level fields for connections:

```ts
type GatewaySetupMode = "current" | "manual_ref" | "oauth_managed";
type GatewayRuntimeStatus = "metadata_only" | "read_proxy_ready" | "oauth_ready";
type GatewayMigrationStatus = "not_started" | "oauth_ready" | "migrated";

interface GatewayConnectionApiResource {
  id: string;
  brandId: string;
  regionId: string;
  connectorId: string;
  backendType: "internal" | "native" | "composio" | "nango";
  displayName: string;
  status: string;
  setupMode: GatewaySetupMode;
  runtimeStatus: GatewayRuntimeStatus;
  migrationStatus: GatewayMigrationStatus;
  source: "dev_api" | "gateway" | "fixture";
  configSummary: Record<string, string>;
  credentialRef?: string;
}
```

Default mapping:

- Dev API imported connections: `setupMode="current"`, `runtimeStatus="metadata_only"`, `migrationStatus="not_started"`.
- Gateway-owned connections with safe refs and no OAuth binding: `setupMode="manual_ref"`, `runtimeStatus="metadata_only"`, `migrationStatus="not_started"`.
- Later OAuth-managed connections: `setupMode="oauth_managed"`, `runtimeStatus="oauth_ready"`, `migrationStatus="migrated"`.

`credentialRef` is a non-secret pointer only. It can come from safe config keys such as `credential_ref`, `credential_group`, or future gateway credential metadata. It must never contain a raw token or secret value.

## Persistent Store Additions

Extend the existing SQLite store with:

```sql
gateway_api_clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  owner TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revoked_at TEXT,
  revoked_by TEXT
);

gateway_api_keys (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  label TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  preview TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  rotated_at TEXT,
  rotated_by TEXT,
  revoked_at TEXT,
  revoked_by TEXT,
  last_used_at TEXT,
  FOREIGN KEY(client_id) REFERENCES gateway_api_clients(id)
);

gateway_api_usage (
  id TEXT PRIMARY KEY,
  client_id TEXT,
  key_id TEXT,
  route TEXT NOT NULL,
  method TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  scope TEXT,
  occurred_at TEXT NOT NULL,
  duration_ms INTEGER
);
```

Reuse `gateway_audit_events` for user-facing audit history. `gateway_api_usage` is for counters and recent usage summaries.

## Audit Events

Add actions:

```text
api_client.created
api_client.updated
api_client.revoked
api_key.created
api_key.rotated
api_key.revoked
api_auth.succeeded
api_auth.failed
api_scope.denied
api_read.succeeded
api_read.failed
```

Audit metadata should include actor/client id, key fingerprint when known, route, method, status code, required scope, and target id where relevant. Audit metadata must not include raw API keys, Authorization headers, upstream tokens, or provider response payloads.

## Error Handling

- Missing `Authorization` on `/api/v1` returns `401`.
- Invalid or revoked key returns `401`.
- Missing scope returns `403`.
- Unknown brand, region, connector, or connection returns `404`.
- Invalid client/key mutation input returns `400`.
- Duplicate API client id or key label under a client returns `409`.
- Store open/migration errors fail startup for access-enabled modes.
- `/api/v1` responses should be structured JSON with `{ "error": { "code": "...", "message": "..." } }`.

## Compatibility Policy

Do not add `/api/compat` routes preemptively.

Add a compatibility route only when there is a named existing consumer that cannot switch to `/api/v1` yet. Each compatibility route must:

- Be backed by the same service/read model as `/api/v1`.
- Be documented as temporary.
- Avoid expanding Phase 2 into live provider execution.
- Have tests proving it maps from the gateway model to the old shape.

## Testing Strategy

Unit tests:

- API client creation hashes secrets and returns the secret only once.
- API key rotation replaces the secret hash for the same key id, returns the new secret once, records `rotated_at`, and makes the old secret invalid immediately.
- Revoked clients and keys cannot authenticate.
- Scope checks allow and deny the correct `/api/v1` routes.
- Connection API resources derive `setupMode`, `runtimeStatus`, and `migrationStatus` correctly from source/gateway records.
- `credentialRef` never exposes forbidden secret-like values.

Route tests:

- `/api/v1/brands`, `/regions`, `/connectors`, `/connections`, and `/me` require authentication.
- Read routes return only records allowed by scope.
- Missing scope returns `403`.
- Unknown ids return `404`.
- Key create/rotate/revoke admin routes update state and audit events.

Local smoke:

- Run in `fixture-overlay`.
- Create an API client and key.
- Call `/api/v1/brands` with the new key.
- Restart the gateway with the same SQLite path.
- Confirm the same key still authenticates and usage/audit data persisted.

Optional live smoke:

- If a local Haverford Dev API is running, run in `dev-api-overlay`.
- Confirm `/api/v1/brands` and `/api/v1/connections` expose the Dev API imported setup through the gateway contract.

## Acceptance Criteria

- A user/client can switch its base API URL to the gateway for control-plane metadata.
- `/api/v1` exposes versioned brand, region, connector, and connection metadata.
- Current setup is visible and manageable as `current` or `manual_ref`, not misrepresented as OAuth-managed.
- API clients and keys are persisted on the gateway data volume.
- API key secrets are revealed only at creation or rotation.
- Revocation and scope denials work.
- Usage and audit history record API access without storing secrets.
- No provider execution or OAuth behavior is added in Phase 2.

## Later Phase Boundaries

- Phase 3: add read-only MCP gateway behavior for approved Auth Gate users/domains and API clients.
- Phase 4: add native Google OAuth and credential binding for GA4, GSC, Google Ads, and Merchant Center.
- Phase 5: add the Shopify app/dashboard layer on top of storefront connections.
- Phase 6: evaluate Nango, Composio, ACI, and Obot against real adapter seams.
