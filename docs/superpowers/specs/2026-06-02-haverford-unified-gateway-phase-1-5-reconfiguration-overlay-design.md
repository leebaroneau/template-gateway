# Haverford Unified Gateway Phase 1.5 Reconfiguration Overlay - Design Spec

**Status:** approved for implementation
**Issue:** [#19](https://github.com/leebaroneau/template-gateway/issues/19)  
**Date:** 2026-06-02  
**Repo:** `leebaroneau/template-gateway`  

## Context

Phase 1 added a local admin UI and a read-through backend that maps the current Haverford Dev API brand data into the gateway admin model. The UI can display the current setup, but Dev API mode is intentionally read-only. That means imported brands, regions, and connections cannot be reconfigured once they appear in the gateway.

Lee approved a transition scope where Dev API and the gateway may drift during the migration. Dev API remains the current source of truth for the existing setup, but the gateway becomes a separate persistent entry point for reconfiguration and new gateway-owned setup.

This spec defines the smallest Phase 1.5 backend/UI layer needed to make the admin prototype useful locally and deployably without wiring real Nango, Composio, native connector execution, OAuth flows, or production credential migration.

## Confirmed Decisions

- Dev API remains the read-through source for existing Haverford brands, regions, and connections.
- Gateway-owned edits are stored on the gateway's persistent app volume.
- New gateway-owned brands, regions, and connections are stored on the same persistent volume.
- Dev API and gateway records can drift during the transition.
- The UI must show provenance clearly: `Dev API`, `Gateway`, or `Dev API + Gateway override`.
- Resetting an imported record removes the gateway override and reveals the Dev API source value again.
- Phase 1.5 does not write back to Dev API.
- Phase 1.5 does not run real OAuth, Nango, Composio, or native connector setup logic.
- Raw secrets must not be accepted into or returned from UI/API config summaries.

## Goals

- Make existing Dev API-imported brands reconfigurable in the gateway UI.
- Make existing Dev API-imported regions reconfigurable in the gateway UI.
- Make existing Dev API-imported connections reconfigurable in the gateway UI.
- Allow creation of new gateway-owned brands, regions, and connections.
- Persist gateway edits and new records across process restarts using `/data/gateway.sqlite` or a configured equivalent.
- Preserve the current fixture and Dev API read-through modes for local testing and fallback.
- Keep the connector model compatible with later Nango, Composio, native, and internal adapters.
- Record create, edit, reset, test, rotate, and revoke events in gateway audit history.

## Non-Goals

- Do not migrate Dev API data or secrets into the gateway.
- Do not mutate Dev API records.
- Do not implement real connector execution.
- Do not implement real OAuth consent, token refresh, or credential encryption in this phase.
- Do not add MCP read/write gateway behavior in this phase.
- Do not add app dashboards or Shopify app installs in this phase.
- Do not hard-delete imported Dev API records from the gateway view.

## Reused Primitives

Phase 1.5 should extend existing code rather than replace it:

- `GatewayConnectionBackend` remains the admin backend boundary.
- `DevApiGatewayBackend` remains the source adapter for current Haverford setup.
- `FixtureGatewayBackend` remains the local mock backend and contains reusable validation patterns for safe connection config summaries.
- `mapDevApiBrandsToGatewayState` remains the import mapper for Dev API records.
- The current admin UI structure remains the starting point: overview, brands, connectors, API access, audit.
- Dev API `provider_connections` remains the reference shape for future provider/account/resource modeling.
- The backend transition spec's `/data/gateway.sqlite` direction remains the persistent volume target.

The Dev API uses `node:sqlite`, but `template-gateway` currently supports Node `>=20.0.0`. Phase 1.5 should use a maintained Node 20-compatible SQLite package. The current recommended package is `better-sqlite3`, which supports Node 20 according to the package metadata checked on 2026-06-02. Raising the gateway runtime to Node 22 just to reuse `node:sqlite` is not required for this phase.

## Recommended Architecture

Add a persistent overlay backend that wraps an existing source backend:

```text
Admin UI
  -> admin routes
    -> OverlayGatewayBackend
      -> source backend: DevApiGatewayBackend or FixtureGatewayBackend
      -> GatewayOverlayStore on /data/gateway.sqlite
```

`OverlayGatewayBackend` is responsible for:

1. Fetching the source snapshot.
2. Loading gateway-owned records from the persistent store.
3. Loading overrides for imported records.
4. Merging source records, overrides, gateway-owned records, and gateway audit events into one `GatewayState`.
5. Writing edits and new records only to the gateway store.

This keeps the custom surface small. The source backend continues to own source reads, the store owns persistence, and the UI talks to the same admin routes.

## Data Ownership

| Data | Owner in Phase 1.5 | Notes |
| --- | --- | --- |
| Imported brand identity | Dev API | Gateway can override display/status fields, not source identity. |
| Imported region identity | Dev API | Gateway can override display/domain/status fields, not source brand/code identity. |
| Imported connection identity | Dev API | Gateway can override display/config/status notes, not source connector identity. |
| New gateway brands | Gateway store | Source badge is `Gateway`. |
| New gateway regions | Gateway store | Must belong to a visible brand. |
| New gateway connections | Gateway store | Must belong to a visible brand/region and connector. |
| Gateway overrides | Gateway store | Patch records keyed by entity type and source entity id. |
| Gateway audit | Gateway store | Combined with source/read-through audit events in the UI. |
| Secrets/tokens | Out of scope | UI accepts only safe refs/summaries. |

## Entity Metadata

The admin state should expose source metadata without changing every UI lookup pattern.

```ts
type GatewayEntitySource = "dev_api" | "gateway" | "fixture";

interface GatewayEntityMeta {
  entityType: "brand" | "region" | "connection";
  entityId: string;
  source: GatewayEntitySource;
  hasOverride: boolean;
  overrideFields: string[];
  sourceLabel: string;
  updatedAt?: string;
  updatedBy?: string;
}

interface GatewayState {
  brands: Brand[];
  regions: Region[];
  connectors: Connector[];
  connections: Connection[];
  apiClients: ApiClient[];
  auditEvents: AuditEvent[];
  entityMeta?: GatewayEntityMeta[];
}
```

`entityMeta` keeps provenance additive. Existing table rendering can keep using `brands`, `regions`, and `connections`, while updated UI components can look up source/override badges when available.

## Persistent Store

Initial SQLite tables:

```sql
gateway_schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

gateway_brands (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

gateway_regions (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  domain TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  UNIQUE(brand_id, code)
);

gateway_connections (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL,
  region_id TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  backend_type TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL,
  config_summary_json TEXT NOT NULL,
  last_tested_at TEXT,
  last_used_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

gateway_entity_overrides (
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  source TEXT NOT NULL,
  patch_json TEXT NOT NULL,
  source_fingerprint TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  PRIMARY KEY(entity_type, entity_id)
);

gateway_audit_events (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  detail TEXT NOT NULL,
  actor TEXT NOT NULL,
  metadata_json TEXT,
  timestamp TEXT NOT NULL
);
```

`patch_json` should contain only allowed fields. It is not a dumping ground for entire imported records.

## Editable Fields

Imported Dev API brands:

- Editable: `name`, `status`.
- Not editable in Phase 1.5: `id`, `slug`.

Gateway-owned brands:

- Editable: `name`, `slug`, `status`.
- Slug edits must reject duplicates.

Imported Dev API regions:

- Editable: `name`, `domain`, `status`.
- Not editable in Phase 1.5: `id`, `brandId`, `code`.

Gateway-owned regions:

- Editable: `code`, `name`, `domain`, `status`.
- Moving a region to another brand is out of scope.

Imported Dev API connections:

- Editable: `displayName`, `status`, `configSummary`, `lastError` as an operator note.
- Not editable in Phase 1.5: `id`, `brandId`, `regionId`, `connectorId`.
- `backendType` can be overridden only as a planned backend selection for future migration, not as a real runtime adapter switch.

Gateway-owned connections:

- Editable: `displayName`, `backendType`, `status`, `configSummary`, `lastError`.
- Moving a connection to another region or changing connector identity is out of scope.

Disable/archive should be represented with status fields. Hard delete is out of scope for imported records and can wait for a separate lifecycle design.

## Config Summary Rules

Phase 1.5 config summaries are safe operational metadata only.

Allowed examples:

- `shop_domain`
- `property_id`
- `site_url`
- `customer_id`
- `merchant_center_id`
- `account_id`
- `credential_group`
- `credential_ref`
- `oauth_provider`
- `notes`

Rejected examples:

- `access_token`
- `refresh_token`
- `client_secret`
- `authorization`
- `bearer`
- raw password values

The implementation should extract the current fixture config sanitizer into a reusable admin config validation module, then use it for fixture, overlay, and route validation.

## API Changes

Add update and reset routes:

```text
PATCH /admin/api/brands/:brandId
PATCH /admin/api/regions/:regionId
PATCH /admin/api/connections/:connectionId
POST  /admin/api/entities/:entityType/:entityId/reset
```

The existing create routes stay:

```text
POST /admin/api/brands
POST /admin/api/brands/:brandId/regions
POST /admin/api/regions/:regionId/connections
```

In overlay mode, create routes write gateway-owned records. In plain `dev-api` mode, they remain read-only and return the current conflict error.

Recommended config modes:

```text
ADMIN_DATA_SOURCE=fixture
ADMIN_DATA_SOURCE=dev-api
ADMIN_DATA_SOURCE=fixture-overlay
ADMIN_DATA_SOURCE=dev-api-overlay
GATEWAY_STORE_PATH=/data/gateway.sqlite
```

`fixture-overlay` gives a persistent local test path without needing Dev API. `dev-api-overlay` is the real transition mode.

## UI Changes

The UI should keep its operational admin feel and add reconfiguration in-place:

- Add source badges in brand, region, and connection rows.
- Add an `Edit` action beside each brand, region, and connection.
- Open edits in a right-side drawer or compact inline panel.
- Show source provenance at the top of the drawer.
- For imported records with overrides, show `Reset to Dev API`.
- For imported records without overrides, show `Source: Dev API`.
- For gateway-owned records, show `Source: Gateway`.
- After save or reset, refresh the state and keep the user on the same selected brand/region.

Connection edit drawer sections:

- Identity: connector, brand, region, source.
- Editable setup summary: display name, backend selection where allowed, status, safe config summary fields.
- Current health: last tested, last used, last error/operator note.
- Actions: save, reset to source when available, test mock connection.

## Merge Behavior

Snapshot merge order:

1. Source records from Dev API or fixtures.
2. Gateway overrides applied to matching source records.
3. Gateway-owned brands appended.
4. Gateway-owned regions appended when their brand is visible.
5. Gateway-owned connections appended when their brand/region/connector is visible.
6. Gateway audit events prepended or merged with source audit events.
7. Entity metadata generated for all visible brands, regions, and connections.

Duplicate handling:

- Gateway brand slugs must not duplicate any visible source or gateway brand slug.
- Gateway region codes must not duplicate another visible region under the same brand.
- Gateway connection IDs are generated by the store and should not collide with source IDs.
- If a source record disappears, its override remains in the store but is not visible until the source returns. The audit still records that the override exists.

## Error Handling

- Unknown entity id returns `404`.
- Invalid editable field returns `400`.
- Duplicate slug/code returns `409`.
- Attempting to edit a source-owned identity field returns `409`.
- Attempting to write in plain `dev-api` mode keeps the current read-only `409`.
- Invalid JSON or non-object config summary returns `400`.
- Unsafe config summary secret keys return `400`.
- SQLite open/migration errors fail startup in overlay modes.

## Testing

Unit tests:

- Store migrations create all tables.
- Gateway-owned brand/region/connection create persists after backend recreation.
- Imported brand/region/connection patch persists after backend recreation.
- Reset removes imported record override.
- Source and override merge produces correct final records and metadata.
- Duplicate slug/code validation checks both source and gateway records.
- Unsafe config summary keys are rejected.
- Plain `dev-api` mode remains read-only.

Route tests:

- `PATCH` brand, region, connection.
- Reset route.
- Create route in overlay mode writes gateway-owned records.
- State response includes `entityMeta`.

Local verification:

- Run `npm test`.
- Run `npm run typecheck`.
- Run `npm run build`.
- Start local gateway in `fixture-overlay` and confirm edits survive restart.
- Start local gateway in `dev-api-overlay` against local Dev API and confirm imported record overrides work.

Task 8 verification record:

- `npm test` passed: 12 files / 127 tests.
- `npm run typecheck` passed.
- `npm run build` passed.
- Fixture-overlay persistence smoke passed.
- Smoke used port `3003` because `3002` was occupied.
- Smoke used temp store path `/tmp/template-gateway-overlay-smoke.0k5hUM/gateway-smoke.sqlite`.
- Created `Smoke Overlay` / `smoke-overlay`, restarted with the same SQLite path, verified it persisted via `/admin/api/state`, then stopped the server and removed the temp directory.

## Acceptance Criteria

- The local UI can edit an existing Dev API-imported brand.
- The local UI can edit an existing Dev API-imported region.
- The local UI can edit an existing Dev API-imported connection.
- The local UI can reset an imported record back to the Dev API source value.
- The local UI can create a new gateway-owned brand, region, and connection.
- Created gateway-owned records persist after restarting the gateway.
- Edits to imported records persist after restarting the gateway.
- The UI clearly distinguishes Dev API source records, gateway records, and overridden Dev API records.
- Audit history records create, update, reset, and mock test actions.
- No raw secret-like config keys are accepted or returned.

## Later Phase Boundaries

Phase 2 should build persistent policy and API access on the same store: clients, key fingerprints, scopes, usage, revocation, rotation, and audit.

Phase 3 should add MCP read gateway behavior for approved users/domains, using the gateway policy store and source/overlay connection state.

Phase 4 should add native Google OAuth and credential binding for GA4, GSC, Google Ads, and Merchant Center.

Phase 5 should add the Shopify app layer on top of storefront connections.

Phase 6 should evaluate Nango, Composio, ACI, and Obot with real adapter seams already in place.

## Spec Self-Review

- No placeholders remain.
- Phase 1.5 does not wire real connector execution or OAuth.
- Dev API drift is explicit and handled through source metadata.
- The storage design is scoped to reconfiguration, gateway-owned creates, and audit only.
- The implementation can be planned without guessing which fields are editable.
