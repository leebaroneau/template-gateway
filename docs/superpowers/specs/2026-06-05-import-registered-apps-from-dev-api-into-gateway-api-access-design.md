# Import Registered Apps from the Haverford Dev API into Gateway API Access — Design Spec

**Status:** draft — pending review
**Issue:** [#34](https://github.com/leebaroneau/template-gateway/issues/34)
**Epic:** [#19](https://github.com/leebaroneau/template-gateway/issues/19)
**Date:** 2026-06-05
**Branch:** `task/34-import-dev-api-apps-into-gateway-api-access`

## Context

Today, external apps reach the Haverford Dev API by sending `x-internal-client-id` / `x-internal-client-secret` HTTP headers (configured via `HAVERFORD_DEV_API_*` env). The gateway has already proven it can own its own API Access tier: `gateway_api_clients` (OAuth apps / microservices / agents) holding scopes and statuses, and `gateway_api_keys` (scrypt-hashed `gw_live_*` bearer secrets with SHA256 first-16 fingerprints for lookup). See `src/access/store.ts`, `src/access/secret.ts`, `src/access/types.ts`.

The remaining gap for the gateway to fully **replace** the Dev API is migrating the *callers*. Each app that currently authenticates with internal client credentials must be re-issued as a gateway-native client with a fresh gateway key, so the app owner can swap to a NEW base URL + NEW `gw_live_` bearer token and keep working. After all apps have swapped, the Dev API internal-client credentials can be retired.

**Critical ground-truth constraint.** The Dev API map confirms there is **no endpoint that lists registered internal clients/apps**. The only implemented internal endpoint is `GET /api/internal/brands` (`src/admin/dev-api-client.ts`). The devapi subsystem's own Open Questions explicitly record that `GET /api/internal/clients` is "Not found in current codebase." This spec therefore makes the importer **manifest-driven** — the list of apps to import is supplied by a committed config manifest, not fetched live. Live discovery (a future `/api/internal/clients` endpoint) is deferred to the Open Questions section and is NOT assumed by any code path here.

This phase delivers:
1. A seed/import script `scripts/import-dev-api-apps.mjs` mirroring the existing `scripts/seed-from-dev-api.mjs` pattern (dotenv load → read source → write via the canonical store → print next steps).
2. A manifest format `config/dev-api-apps.manifest.json` + committed `.example` that enumerates the apps to import.
3. A shared pure module `src/access/app-import.ts` for manifest validation, owner normalization, and scope derivation — used by both the script and the authenticated import endpoint.
4. Two **authenticated `/api/v1` endpoints** — `POST /api/v1/api-clients/import` (mint clients+keys from a manifest body) and `GET /api/v1/api-clients?owner_prefix=dev-api:` (list importer-tagged clients) — behind `gatewayApiAuth` + `assertGatewayApiScope` (`api_clients.write` / `api_clients.read`).
5. The swap runbook `docs/runbooks/dev-api-app-swap.md` documenting exactly what each app owner changes.
6. A correctness fix to `scripts/seed-from-dev-api.mjs` so its `gateway_audit_events` DDL matches the store's (the two scripts share `./data/gateway.sqlite`).

**Out of scope:** no new SQLite tables; no per-connection MCP tokens (separate spec); no changes to OAuth credential storage; no automatic rotation of the Dev API's own `x-internal-client-secret`; no live enumeration of Dev API clients; no change to `CreateApiClientInput` (no new `metadata` field).

## Suite Coordination (resolved decisions)

These suite-wide decisions bind this spec and are not re-litigated here:

- **D2 — Authenticated endpoint placement.** `createAdminRouter` performs NO in-app scope auth — it only calls `actorFromRequest(req)` for audit attribution (`src/admin/routes.ts:60-68`), which falls back to `local-admin`. Scope enforcement exists ONLY on the `/api/v1` router via `gatewayApiAuth` + `assertGatewayApiScope` (`src/api/auth.ts:25-96`, `src/api/routes.ts`). **Therefore all new authenticated client-management endpoints (import, list/filter) go on the `/api/v1` router behind `gatewayApiAuth(accessStore, '<scope>')`, registered BEFORE the `router.use('*', ...)` 404 catch-all at `src/api/routes.ts:276`.** The Per-Connection MCP spec applies the same decision for its token endpoints.
- **D5 — Shared `gateway.sqlite` audit DDL.** `GatewayAccessStore` is the SOLE owner of `gateway_audit_events` (`timestamp TEXT NOT NULL`, nullable `metadata_json` — `src/access/store.ts:574-583`). This spec includes the fix to `scripts/seed-from-dev-api.mjs` so its DDL matches.
- **D7 — Import provenance.** `createClient` hardcodes audit metadata to `{owner,type}` (`src/access/store.ts:227`) and `CreateApiClientInput` has NO `metadata` field (`src/access/types.ts:21-26`). Provenance is carried ONLY in `owner` as `dev-api:<key>`. All `import_source`/`manifest_key` audit-metadata claims are dropped; no `CreateApiClientInput.metadata` change is introduced.
- **D8 — Store constructor.** `new GatewayAccessStore(STORE_PATH)` takes a PATH STRING; it internally does `new Database(dbPath)` (`src/access/store.ts:179-183`). Never pass a db object.

## Module Layout

```
config/dev-api-apps.manifest.example.json   # committed example manifest (no secrets)
config/dev-api-apps.manifest.json           # gitignored real manifest (operator-supplied; no secrets)
scripts/import-dev-api-apps.mjs             # NEW importer; mirrors seed-from-dev-api.mjs; new GatewayAccessStore(STORE_PATH)
scripts/seed-from-dev-api.mjs               # FIX: gateway_audit_events DDL -> store shape (timestamp NOT NULL, nullable metadata_json)
src/access/app-import.ts                    # NEW pure: manifest schema, normalize, scope derivation
src/access/store.ts                         # reuse createClient()/createKey()/listApiClients(); NO changes to the store
src/api/routes.ts                           # + POST /api-clients/import (api_clients.write); + GET /api-clients (api_clients.read, owner_prefix filter)
src/api/resources.ts                        # (reuse; no change needed for the client list — clients are returned as-is)
src/admin/client-script.ts                  # admin UI: read-only "Imported (dev-api:*)" view + copy-once secret reveal (single inline file)
docs/runbooks/dev-api-app-swap.md           # NEW per-app owner swap runbook
test/access-app-import.test.ts              # manifest validation + scope derivation (pure)
test/import-dev-api-apps.test.ts            # script behavior (create, idempotency, rotate, dry-run)
test/api-api-clients-import.test.ts         # supertest: POST/GET /api/v1/api-clients* incl. auth/scope enforcement
test/access-store-import-owner.test.ts      # store integration: owner-prefix provenance + fingerprint-only audit
```

There is no `src/admin/ui/` directory — the admin UI is the single inline `src/admin/client-script.ts` (plus `page.ts` / `styles.ts`). UI edits target that file only.

## Data Model

**No new tables.** Imported apps are ordinary `gateway_api_clients` + `gateway_api_keys` rows. We reuse the existing schema and ID conventions exactly:

- `gateway_api_clients` — `id` generated as `generatedId("api_client_")` (`src/access/store.ts:202`); columns `id, name, type, status, owner, scopes_json, created_at, updated_at, revoked_at, revoked_by` (`src/access/store.ts:205-219`, table DDL at `:584-595`).
- `gateway_api_keys` — `id` generated as `generatedId("api_key_")` (`src/access/store.ts:297`); secret created via `createApiKeySecret()` (`gw_live_` prefix + 32 random bytes base64url, `src/access/secret.ts:9-11`), stored as `hashApiKeySecret()` (scrypt N=16384 r=8 p=1, `src/access/secret.ts:21-25`) with `fingerprintApiKeySecret()` SHA256-first-16 for lookup (`:17-19`). Active-label uniqueness is enforced by `assertActiveLabelAvailable()` (`src/access/store.ts:711-718`, `WHERE status='active'`); revoked keys may reuse a label.
- `gateway_audit_events` — written by the private `insertAudit()` (`src/access/store.ts:685-709`); actions `api_client.created` and `api_key.created` already exist in the `AuditAction` union (`src/admin/types.ts`). **No new `AuditAction` or `AuditEvent.targetType` values are introduced by this spec.** The created-client audit metadata is HARDCODED to `{ owner, type }` (`src/access/store.ts:227`) and is not extensible without a store change — which this spec does not make.

### Provenance + idempotency convention (in-row, no schema change)

To make imported clients identifiable for the list filter and idempotent across re-runs, provenance lives ONLY in the existing `owner` field:

- `ApiClient.owner` carries the originating app's stable manifest key as `dev-api:<key>` (e.g. `dev-api:quatra-ops`). The `dev-api:` prefix marks provenance and is the sole idempotency anchor.
- There is **no** import-specific audit metadata. The `api_client.created` audit row carries the store's standard `{ owner, type }` — `owner` already contains `dev-api:<key>`, so provenance is captured for free without touching the store.

A read helper over `listApiClients()` filters active clients whose `owner === \`dev-api:${manifestKey}\`` to support idempotent re-runs and the `owner_prefix` list filter. This is a pure read over `gateway_api_clients` via the existing `listApiClients()` method; it adds no table, column, or store method.

### Manifest schema (`config/dev-api-apps.manifest.json`)

```jsonc
{
  "version": 1,
  "issuedKeyLabelPrefix": "dev-api-import",        // optional; default "dev-api-import"
  "apps": [
    {
      "key": "quatra-ops",                          // stable manifest key (idempotency anchor; immutable once imported)
      "name": "Quatra Ops Sync",                    // -> ApiClient.name
      "type": "service",                            // service | agent | worker (validated against the store's client types)
      "owner": "quatra-ops",                         // stored as ApiClient.owner = "dev-api:quatra-ops"
      "scopes": ["brands.read", "connections.read"], // validated against gatewayApiScopes
      "notes": "Reads brand/region config for warehouse ticket sync"
    }
  ]
}
```

`config/dev-api-apps.manifest.example.json` is committed (no secrets). The real `config/dev-api-apps.manifest.json` is gitignored — it carries no secrets either (only names/owners/scopes) but is operator-curated per deployment.

## API / MCP Surface

This phase adds **no MCP tools** and **no public unauthenticated endpoints**, and touches **no admin-router routes** (the admin router has no scope auth to enforce per D2). It adds two authenticated routes to the existing `/api/v1` router (`createGatewayApiRouter`, `src/api/routes.ts`), behind `gatewayApiAuth` + `assertGatewayApiScope`, registered before the `router.use("*", ...)` 404 catch-all at `src/api/routes.ts:276`. This mirrors the existing authenticated write surface in `src/apps/api-routes.ts` (`POST /api/v1/app-installs` behind `apps.write`).

### `POST /api/v1/api-clients/import` — scope `api_clients.write`

Bulk-creates clients + one key each from a manifest body, returns issued secrets once. Authenticated by a `gw_live_*` bearer whose client holds `api_clients.write` (note: `scopeAllowed` treats `api_clients.write` as also satisfying `api_clients.read`, `src/access/types.ts:89-90`).

Request:
```json
{
  "apps": [
    { "key": "quatra-ops", "name": "Quatra Ops Sync", "type": "service",
      "owner": "quatra-ops", "scopes": ["brands.read", "connections.read"] }
  ],
  "issuedKeyLabelPrefix": "dev-api-import",
  "rotate": false
}
```

Response `201`:
```json
{
  "imported": [
    {
      "manifestKey": "quatra-ops",
      "client": { "id": "api_client_...", "name": "Quatra Ops Sync",
                  "type": "service", "status": "active",
                  "owner": "dev-api:quatra-ops",
                  "scopes": ["brands.read", "connections.read"] },
      "key": { "id": "api_key_...", "label": "dev-api-import-2026-06-05",
               "preview": "gw_live_...abcd", "fingerprint": "0f1e2d3c4b5a6978",
               "status": "active" },
      "secret": "gw_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      "action": "created"
    }
  ],
  "skipped": []
}
```

Semantics:
- Each app: if no active client exists with `owner === \`dev-api:${key}\``, call `store.createClient({ name, type, owner: \`dev-api:${owner}\`, scopes }, actor)` then `store.createKey(clientId, { label }, actor)`. `action: "created"`. `createKey` returns `{ key, secret }` (`ApiKeyWithSecret`, `src/access/types.ts:40-43`); the `secret` is surfaced once.
- If an active client already exists for the key and the request does NOT set `rotate: true`, the app is reported under `skipped` with `reason: "exists"` (no duplicate). `action` omitted, `secret` omitted.
- If `rotate: true`, issue a fresh key with a date-suffixed label (collision-safe per the active-label rule) and report `action: "rotated"` — using `createKey` (a new key) rather than `rotateKey` so the prior key can drain gracefully during the swap window.
- `actor` is derived from the authenticated client id for these `/api/v1` requests (the gateway records `actor = authenticated.client.id` for `/api/v1` audits, `src/api/auth.ts:61,87`). There is no `dev-api-importer` actor on this path — that string is reserved for the CLI (see script section).
- `secret` is returned **once**; never re-fetchable (the store returns `{ key, secret }` from `createKey` and stores only the scrypt hash).

Errors:
- `401` missing/invalid bearer; `403` bearer lacks `api_clients.write` (both via `gatewayApiAuth`/`assertGatewayApiScope`).
- `400` invalid manifest body (unknown scope, missing `key`/`name`/`type`/`owner`, bad `type`) — surfaced by `validateAppImportManifest()` before any DB write, wrapped as `GatewayApiError(400, "invalid_request", ...)`.
- `409` if `rotate: true` targets a revoked client (cannot un-revoke; existing `AccessStoreError` 409 from `createKey` on a revoked client at `src/access/store.ts:291-293`), wrapped as `GatewayApiError(409, ...)`.

### `GET /api/v1/api-clients?owner_prefix=dev-api:` — scope `api_clients.read`

There is currently **no** `api_clients` list route on `/api/v1` (clients reach the admin UI only via the admin router's `/api/state` snapshot, which calls `accessStore.listApiClients()`). This spec adds a NEW authenticated read route on `/api/v1`:

- Returns `{ apiClients: ApiClient[] }` from `accessStore.listApiClients()`.
- When `owner_prefix` is supplied, filters to clients whose `owner` starts with that prefix (use `owner_prefix=dev-api:` to list importer-tagged clients). The filter is applied in the route handler; no new store method.
- No secrets are returned (clients carry no secret material; keys are listed separately and never expose plaintext).

## The Importer Script (`scripts/import-dev-api-apps.mjs`)

Mirrors `scripts/seed-from-dev-api.mjs` structure exactly: dotenv load → read source → map → write via the canonical store → print next-step guidance.

```
1. Load .env via dynamic import("dotenv") (same try/catch as seed script).
2. Resolve MANIFEST_PATH (default ./config/dev-api-apps.manifest.json) and
   GATEWAY_STORE_PATH (default ./data/gateway.sqlite) — same store path env the seed script uses.
3. Parse CLI flags: --rotate (re-issue keys for existing clients), --dry-run (validate + print plan, no writes).
4. Read + JSON.parse the manifest. Validate via dist/access/app-import.js:validateAppImportManifest()
   (require `npm run build` first — same dist import guard the seed script uses for the mapper).
5. Open the store: `new GatewayAccessStore(GATEWAY_STORE_PATH)` from dist/access/store.js (PATH STRING, not a db
   object — the constructor does `new Database(dbPath)` internally and runs migrations). This routes creation,
   hashing, fingerprinting, audit, and label-uniqueness through the canonical code path (NOT hand-rolled SQL).
6. For each app, scan store.listApiClients() for an active client with owner === `dev-api:${key}`:
     - none      -> createClient(...) + createKey(...)            -> print secret, mark CREATED
     - exists, !rotate -> skip, mark EXISTS
     - exists, rotate  -> createKey(... fresh dated label ...)     -> print secret, mark ROTATED
7. Print a table: manifestKey | clientId | keyId | fingerprint | action.
8. Print each issued secret ONCE under a clearly-marked "COPY THESE NOW — not re-fetchable" block.
9. Print swap next-steps pointing at docs/runbooks/dev-api-app-swap.md.
```

Env / inputs:
- `MANIFEST_PATH` (optional; default `./config/dev-api-apps.manifest.json`)
- `GATEWAY_STORE_PATH` (optional; default `./data/gateway.sqlite`) — identical to the seed script
- `ACTOR` constant = `"dev-api-importer"`, passed as the `actor` argument to `createClient`/`createKey` (the CLI sets the service identity directly; this is distinct from the `/api/v1` endpoint, which records `actor = authenticated.client.id`).

The script does **not** read `HAVERFORD_DEV_API_*` and does **not** call the Dev API — there is no list-clients endpoint to call. The manifest is the sole source of the app list.

### Shared-store DDL fix (`scripts/seed-from-dev-api.mjs`)

Both `seed-from-dev-api.mjs` and the importer (via `GatewayAccessStore`) co-locate on `./data/gateway.sqlite`. The seed script currently creates `gateway_audit_events` with `created_at TEXT NOT NULL` + `metadata_json TEXT NOT NULL DEFAULT '{}'` (`scripts/seed-from-dev-api.mjs:132-141`), whereas `GatewayAccessStore.runMigrations` creates it with `timestamp TEXT NOT NULL` + nullable `metadata_json` (`src/access/store.ts:574-583`). If the seed script ran first, `CREATE TABLE IF NOT EXISTS` keeps its shape and the store's `insertAudit` (which writes `timestamp`, not `created_at`) fails with a `no such column: timestamp` / NOT NULL error. **Fix:** change the seed script's `gateway_audit_events` DDL to the store's exact shape:

```sql
CREATE TABLE IF NOT EXISTS gateway_audit_events (
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

This is a correctness fix regardless of the importer; it makes `GatewayAccessStore` the single owner of the audit-table shape on the shared file (D5). (Pre-existing databases already created with the old shape on a running deployment require a one-time manual reconciliation; note this in the runbook. New/seeded deployments are fixed by the DDL change.)

## `src/access/app-import.ts` (shared pure module)

```typescript
import { validateGatewayApiScopes, type CreateApiClientInput } from "./types.js";

export interface DevApiAppManifestEntry {
  key: string;
  name: string;
  type: CreateApiClientInput["type"];   // service | agent | worker (GatewayApiClientType)
  owner: string;
  scopes: string[];
  notes?: string;
}

export interface DevApiAppManifest {
  version: 1;
  issuedKeyLabelPrefix?: string;        // default "dev-api-import"
  apps: DevApiAppManifestEntry[];
}

export interface NormalizedImportApp {
  manifestKey: string;
  client: CreateApiClientInput;          // owner already prefixed "dev-api:"; scopes validated+sorted
  keyLabel: string;                      // "<prefix>-<YYYY-MM-DD>"
}

export function validateAppImportManifest(value: unknown): DevApiAppManifest;
export function normalizeImportApps(
  manifest: DevApiAppManifest,
  today: string                          // YYYY-MM-DD, injected for testability
): NormalizedImportApp[];
```

- `validateAppImportManifest` throws `Error` on: non-array `apps`, missing/empty `key`/`name`/`owner`, invalid `type`, or any scope rejected by `validateGatewayApiScopes` (which dedupes — `src/access/types.ts:73-86`). Manifest keys must be unique.
- `normalizeImportApps` maps each entry to `{ owner: \`dev-api:${owner}\`, scopes: validateGatewayApiScopes(...) }` (the store re-sorts scopes via `sortedScopes` in `createClient`) and builds the dated key label `\`${prefix}-${today}\``. Injecting `today` keeps it deterministic for tests. The module performs NO DB access — it is pure and shared by the CLI and the `/api/v1` handler.

## Security

- **Endpoint authentication.** The import and list endpoints live on `/api/v1` and are protected by `gatewayApiAuth` (validates the `gw_live_` bearer, resolves client+key) and `assertGatewayApiScope` (`api_clients.write` / `api_clients.read`). The admin router is NOT used for these — it has no in-app scope auth (only `actorFromRequest` for attribution, falling back to `local-admin`; any admin-plane protection is an external reverse-proxy concern, not code this spec relies on or tests).
- **Secret handling.** Secrets (`gw_live_*`) are generated by `createApiKeySecret()` and returned exactly once from `createKey()`. The script and the import endpoint surface them once and never persist them. Stored form is scrypt-hashed; lookup uses the SHA256-first-16 fingerprint, never the plaintext (`src/access/secret.ts`).
- **No raw secrets in audit/logs.** Audit metadata is sanitized by the store's `insertAudit()` (`sanitizeAuditMetadata`); the created-client audit carries only the store's hardcoded `{ owner, type }` and the key-created audit carries the fingerprint/label, never the secret. The script's "copy now" block writes to stdout only, not to any file or audit row.
- **Actor attribution.** The CLI sets `actor = "dev-api-importer"` (passed to `createClient`/`createKey`). The `/api/v1` endpoint records `actor = authenticated.client.id` (the calling client's id), per the gateway API audit path (`src/api/auth.ts`). These are different, by design — there is no `actorFromRequest`/`local-admin` involvement on either path.
- **No un-revoke.** A revoked client cannot be reactivated (`updateClient` 409 at `src/access/store.ts:243-245`; `createKey`/`rotateKey` 409 on revoked at `:291-293`). Re-importing a revoked app requires a new client (new manifest key), preventing accidental resurrection.
- **Label collision safety.** Re-import / `--rotate` uses a date-suffixed label so the active-label UNIQUE constraint (`assertActiveLabelAvailable`, `WHERE status='active'`) never collides; old keys remain valid until the operator revokes them, enabling a zero-downtime swap window.
- **No secret transport over the Dev API.** The importer never touches Dev API credentials; it cannot leak `x-internal-client-secret` because it never reads it.
- **Least privilege scopes.** Manifest scopes are validated against `gatewayApiScopes` and sorted by the store; operators map each app to the minimal read scopes it actually needs (e.g. an app that only read `/api/internal/brands` gets `brands.read` + `regions.read`, not `apps.write`). The runbook instructs owners to request scope reductions before swap.
- **Manifest is not a secret store.** The manifest contains only names/owners/scopes. It is gitignored by default to keep deployment-specific app lists out of the template repo, but it is safe even if leaked (no credentials).

## Testing Strategy

- **`test/access-app-import.test.ts`** — pure module.
  - `validateAppImportManifest` accepts the example manifest; rejects unknown scope (`"apps.delete"`), missing `name`, invalid `type` (`"robot"`), duplicate `key`, non-array `apps`.
  - `normalizeImportApps` prefixes owner to `dev-api:quatra-ops`, validates scopes, builds label `dev-api-import-2026-06-05` from injected `today`.
- **`test/access-store-import-owner.test.ts`** — store integration (constructed via `new GatewayAccessStore(tempPath)`).
  - `createClient` with `owner: "dev-api:quatra-ops"` produces an `api_client_*` id; filtering `listApiClients()` by `owner === "dev-api:quatra-ops"` finds it; an unrelated owner is not matched.
  - The `api_client.created` audit event metadata is exactly `{ owner: "dev-api:quatra-ops", type: "service" }` (asserting NO `import_source`/`manifest_key` keys — provenance is owner-only).
  - The `api_key.created` audit event contains the fingerprint and label but NOT the secret (assert the issued secret string does not appear in any audit metadata value).
- **`test/import-dev-api-apps.test.ts`** — script behavior against a temp SQLite store.
  - First run creates N clients + N keys; prints N secrets; each secret has the `gw_live_` prefix; each client `owner` is `dev-api:<key>`.
  - Second run with no flag is idempotent: 0 created, N skipped (`reason: "exists"`), no duplicate `api_client_*` rows for the same manifest key.
  - Second run with `--rotate` issues a fresh dated-label key per client (no active-label collision); prior keys remain active.
  - `--dry-run` writes nothing (client/key counts unchanged) but prints the plan.
- **`test/api-api-clients-import.test.ts`** — supertest against the `/api/v1` router (with a real `GatewayAccessStore` and a minted `gw_live_` key for the test client).
  - `POST /api/v1/api-clients/import` with NO bearer → `401`; with a bearer whose client lacks `api_clients.write` → `403`; with `api_clients.write` and a valid body → `201`, `imported[].secret` present once, `imported[].client.owner` is `dev-api:*`.
  - Re-POST same body → `201` with the app under `skipped` (`reason: "exists"`), no new client.
  - `rotate: true` against a revoked client → `409`.
  - Invalid scope in body → `400` with no client created.
  - `GET /api/v1/api-clients?owner_prefix=dev-api:` with `api_clients.read` returns only `dev-api:*`-owned clients; without the bearer → `401`.

## Swap Runbook (`docs/runbooks/dev-api-app-swap.md`) — summary

Per app owner, the swap is two coordinated changes plus a verification:
1. **Base URL** — change from the Dev API base (`HAVERFORD_DEV_API_BASE_URL`, e.g. `https://api.haverford.au`) to the gateway base (the gateway's public host, `/api/v1`).
2. **Auth header** — replace the pair `x-internal-client-id` / `x-internal-client-secret` with a single `Authorization: Bearer gw_live_...` header (the issued gateway key). The gateway's `gatewayApiAuth` middleware validates the bearer and resolves the client+scopes (`src/api/auth.ts`).
3. **Verify** — call an endpoint the app actually uses with the new key; confirm `200` and confirm a matching `api_auth.succeeded` audit event for the new client. Then the Dev API internal credential for that app can be retired.

The runbook also documents the shared-DB note: on an already-deployed gateway whose `gateway.sqlite` was first created by the OLD seed-script audit DDL, run the one-time table reconciliation before the importer writes audits.

The runbook stresses the overlap window: old `x-internal-client-*` access keeps working until the Dev API is decommissioned, and old gateway keys (if `--rotate` was used) stay active until explicitly revoked — so owners can cut over without downtime.

## Open Questions

1. **(Manifest-vs-live) Does the Dev API have, or will it gain, an endpoint to list registered internal clients/apps (e.g. `GET /api/internal/clients`)?** The Dev API map confirms it does NOT exist today (only `GET /api/internal/brands`). This spec ships the manifest-driven importer regardless. **Live-discovery follow-up:** if/when such an endpoint lands, add a `DevApiClientsClient` (mirroring `DevApiBrandsClient` in `src/admin/dev-api-client.ts`) and a `--from-dev-api` flag that fetches the live list and merges it into the manifest plan. This is explicitly out of scope here and must not be coded against an unconfirmed endpoint.
2. **Scope mapping fidelity.** The Dev API does not expose per-client scopes (no client enumeration at all). For Phase 1 the manifest author decides per app from operational knowledge. Should we add an observability step (log which `/api/internal/*` routes each `x-internal-client-id` hits, on the Dev API side) to derive minimal scopes before import? That work lives in the Dev API repo, not here.
3. **Idempotency anchor robustness.** We anchor idempotency on `owner === \`dev-api:${manifestKey}\``. If an operator changes a manifest `key` for an already-imported app, the re-run will create a second client. Proposed: keep `key` as the sole anchor and document that keys are immutable once imported.
4. **Key rotation policy.** `--rotate` issues a NEW key (dated label) and leaves the old one active for a drain window, rather than calling `rotateKey()` (which atomically supersedes). Proposed: drain window for safer cutover; operator revokes the old key after verifying the swap.
5. **Import endpoint input shape.** Should `POST /api/v1/api-clients/import` accept the manifest by server-side path or only an inline body? Proposed: inline body only (the API server may not have filesystem access to the operator's manifest); the CLI handles file paths.
6. **Manifest location / gitignore.** Should `config/dev-api-apps.manifest.json` live in this template repo at all, or in the per-deployment wrapper repo? Proposed: ship only the `.example` here; the real manifest is wrapper-owned and gitignored in the template.
7. **Which existing client gets `api_clients.write` to call the import endpoint?** The import endpoint requires a `gw_live_` bearer with `api_clients.write`. Bootstrapping that first administrative client is an operator step (mint via the existing admin create path or a seed). Proposed: document the bootstrap in the runbook; the CLI path (`scripts/import-dev-api-apps.mjs`) needs no bearer because it drives the store directly.
8. **Pre-existing audit-table reconciliation.** On a deployment whose `gateway.sqlite` was first initialized by the OLD seed-script DDL (`created_at NOT NULL`), the importer's `insertAudit` will fail until the table is reconciled to the store shape. Proposed: ship a one-time reconciliation snippet in the runbook (rename/migrate the column) and treat fresh/seeded environments as fixed by the DDL change alone.

## Verification Gate

`npm run typecheck` clean, `npm run build` clean, full `npm test` green (including the four named test files). Manual: `node scripts/import-dev-api-apps.mjs --dry-run` against `config/dev-api-apps.manifest.example.json` prints a valid plan and writes nothing; a real run prints `gw_live_*` secrets once and creates exactly one `api_client_*` (owner `dev-api:<key>`) + one `api_key_*` per manifest app; a second run is idempotent. `POST /api/v1/api-clients/import` rejects a missing/under-scoped bearer (`401`/`403`) and succeeds with `api_clients.write`. Running `seed-from-dev-api.mjs` then the importer against the same `./data/gateway.sqlite` does not error on the audit table.
