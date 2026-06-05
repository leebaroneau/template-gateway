# Haverford Unified Gateway — Google OAuth Brand-Region Property Linking — Design Spec

**Status:** draft — pending review
**Issue:** [#32](https://github.com/leebaroneau/template-gateway/issues/32)
**Epic:** [#19](https://github.com/leebaroneau/template-gateway/issues/19)
**Date:** 2026-06-05
**Branch:** `task/32-google-oauth-brand-region-property-linking`

## Context

There is exactly **one** Google admin account behind every Haverford brand's Google data. That single account (`googleAccountEmail`) owns the GA4 properties, Search Console sites, Google Ads customer IDs, and Merchant Center IDs for ~20 brands across multiple regions. The Phase 4 native Google OAuth subsystem (`src/google-oauth/*`, routes under `/admin/google-oauth/*`) works correctly but is **brand-scoped**: `POST /admin/google-oauth/start` embeds a single `brandId`+`regionId`+`products[]`+`bindings[]` in the OAuth state, and `completeFlow` writes one `gateway_google_credentials` row per call (`adapter.ts:119-127`). Authorising the same admin account for 20 brands means 20 consents and 20 credential rows holding the same refresh token — the duplicate-credential problem the OAuth subsystem map calls out directly: *"each brand+region (Google) … receives an independent credential record, meaning a single OAuth account authorizing multiple stores results in duplicate credentials and tokens."*

The **Account Credential Layer (ACL)** spec (dependency) introduces the fix: a `gateway_oauth_accounts` table holding one credential per `(service, external_account_id)` and a `gateway_oauth_account_links` table fanning that account out to many `(account_id, brand_id, region_id, connector_slug)` tuples, behind a `GatewayAccountStore`. This spec consumes that layer for Google.

The mapping data is **already present**. The Dev API read-through (`dev-api-mapper.ts`) seeds one `connector_google_*` connection per configured Google service per brand+region, and copies the non-secret resource identifier straight into `configSummary` via `safeConfigSummary`:

| Dev API service | Connector `.id` / `.slug` (`dev-api-mapper.ts:31-94`) | `configSummary` key | Maps to `GoogleProduct` |
|---|---|---|---|
| `ga4` | `connector_google_analytics_4` / `google-analytics-4` | `property_id` (e.g. `properties/123456789`) | `ga4` |
| `gsc` | `connector_google_search_console` / `google-search-console` | `site_url` (e.g. `https://brand.example`) | `gsc` |
| `google_ads` | `connector_google_ads` / `google-ads` | `customer_id` (e.g. `1234567890`) | `google_ads` |
| `merchant_center` | `connector_merchant_center` / `merchant-center` | `merchant_center_id` (e.g. `1234567`) | `merchant_center` |

These IDs are non-secret (they never match `secretLikePattern`, `dev-api-mapper.ts:194-218`), so they survive redaction and are reliably available in `connection.configSummary`. That means the gateway can **derive** every brand+region Google binding mechanically — there is nothing to ask the admin to type. The admin's only job is: (1) authorise the one account once, (2) review the auto-derived plan, (3) confirm.

### Hard precondition — ACL must land first (blocking)

This spec is **blocked** until the Account Credential Layer spec is implemented and merged. The ACL provides — and OWNS — everything below, none of which exists in the repo today (verified via `find` + `grep`: no `src/account-credentials/` directory, zero hits for `gateway_oauth_accounts` / `GatewayAccountStore` / `oauth_acct_` in `src/` or `test/`):

- `src/account-credentials/` with `GatewayAccountStore` — tables `gateway_oauth_accounts` and `gateway_oauth_account_links`, the `oauth_acct_` / `oauth_link_` id prefixes.
- Types: `OAuthService` (`"google"` is a member), `OAuthAccount`, `OAuthAccountLink`, `OAuthAccountTokenPayload`, `UpsertAccountInput`, `LinkAccountInput`, `AccountScopeQuery`.
- Methods consumed here: `upsertAccount`, `getAccount`, `listAccounts`, `getLinkForScope`, `linkAccount`, `setLinkConnectionId`, `updateAccountStatus`, `deleteAccount`.
- **Audit-union edits (ACL owns these, per suite decision D1):** ACL adds `oauth_account.created|updated|revoked` and `oauth_account_link.created|removed` to the `AuditAction` union AND `'oauth_account'` + `'oauth_account_link'` to the `AuditEvent.targetType` union (`src/admin/types.ts:9-33` and `:112`) in the same change.

GOL imports these verbatim. It does **not** assert reuse of code as if it exists yet; treat anything in this list as "provided by the ACL dependency". Until ACL merges, GOL cannot typecheck or build.

**Scope boundary.** This spec:

- **Consumes** the ACL tables/types: `gateway_oauth_accounts`, `gateway_oauth_account_links`, `GatewayAccountStore`, `OAuthService`, `OAuthAccount`, `OAuthAccountLink`, `OAuthAccountTokenPayload`, `UpsertAccountInput`, `LinkAccountInput`, `AccountScopeQuery`, and the `oauth_acct_` / `oauth_link_` id prefixes. It introduces no new account-layer concepts.
- **Builds on** the existing Phase 4 google-oauth adapter/store/routes. The per-brand+region `gateway_google_credentials` row remains the connection's **live, refreshable token** (preserving `refreshTokenIfNeeded`, `getCredentialStatus`, and the existing `/credentials/*` routes), now provisioned FROM the account credential and joined to it by a new nullable `account_id` column.
- Does **not** add any `AuditAction` / `AuditEvent.targetType` union members — those are owned by ACL (D1). GOL only *emits* the ACL-provided actions plus the pre-existing `connection.saved`.
- Does **not** change the Shopify flow, the Dev API mapper, `configSummary` redaction, or the encryption primitive (`GOOGLE_OAUTH_ENCRYPTION_KEY` + `shared/token-crypto.ts` re-exported by `google-oauth/crypto.ts` stays the source of key material; `config.ts:128`).
- Does **not** add MCP tools. The MCP surface is read-only metadata (subsystem map); account linking is an admin-bearer HTTP concern.

## Module Layout

```
src/google-oauth/types.ts          # + GoogleLinkPlan, GoogleLinkPlanEntry, GoogleLinkRequest,
                                    #   GoogleLinkResult, GoogleLinkPlanStatus, googleConnectorBinding map
src/google-oauth/linker.ts         # NEW — GoogleAccountLinker: scan connections, derive ids, build plan, apply links
src/google-oauth/store.ts          # + account_id + connector_slug columns on gateway_google_credentials;
                                    #   getCredentialByScope(); upsertCredential() ON CONFLICT(brand,region,connector_slug);
                                    #   dedup/backfill migration BEFORE the unique index
src/google-oauth/adapter.ts        # + startAccountFlow(); completeAccountFlow(); provisionConnectionCredential();
                                    #   refreshTokenIfNeeded resolves account_id -> account refresh token (fan-out)
src/google-oauth/routes.ts         # + /account/start, /account/callback, /account/link-plan, /account/link
                                    #   (distinct account handlers; do NOT route through per-brand /start|/callback)
src/index.ts                       # inject shared GatewayAccessStore + ACL GatewayAccountStore + audit emitter
                                    #   into GoogleOAuthAdapter + router; build GoogleAccountLinker
test/google-account-linker.test.ts # id-derivation, plan generation, idempotency, re-link of new connections
test/google-oauth-account-routes.test.ts # supertest: account consent, link-plan, link, refresh fan-out
```

`linker.ts` is the only genuinely new file; everything else extends a sibling that already exists in `src/google-oauth/`. The linker depends on the read-only `GatewayConnectionBackend` snapshot (to enumerate `connector_google_*` connections), the ACL `GatewayAccountStore` (account + link persistence), and the `GatewayGoogleStore` (connection-scope live credentials) — it owns no SQLite of its own.

**No `AuditAction` / `AuditEvent.targetType` edit happens in `src/admin/types.ts` from this spec.** Those union members (`oauth_account.*`, `oauth_account_link.*`, and the matching targetType members) are added by the ACL dependency (D1). The earlier draft's claim "no new actions needed — reuses oauth_account.* from dep" was false against the actual closed union (`src/admin/types.ts:9-33`, `:112`); the corrected position is: the members are **provided by ACL**, and GOL only emits them.

## Why a linker, not another consent flow

Phase 4 already proved native Google OAuth. The gap is purely **fan-out**: one consent must populate N connections. Rather than fork the OAuth flow per brand, the linker exploits the fact that the brand+region binding data is deterministic and already seeded:

1. **The account is the unit of consent.** The new `/account/start` flow requests all four product scopes in a single grant and writes exactly one `gateway_oauth_accounts` row keyed on `(google, googleAccountEmail)`. ACL's `upsertAccount` uses `INSERT ... ON CONFLICT(service, external_account_id) DO UPDATE SET ... RETURNING id`, so re-authorisation updates that one row and returns the *existing* id — no duplicates.
2. **The connection is the unit of binding.** Each `connector_google_*` connection already carries its resource id in `configSummary`. The linker derives `(product, resourceId)` and creates a `gateway_oauth_account_links` row per connection, then provisions/updates one `gateway_google_credentials` row (the live token) carrying `account_id` and `connector_slug`. This preserves every existing per-connection code path (refresh, status, delete) while removing redundant consent.
3. **Re-link is just re-running the plan.** Because links are upserted on `UNIQUE(account_id, brand_id, region_id, connector_slug)` and credentials are upserted on `UNIQUE(brand_id, region_id, connector_slug)`, re-running after the Dev API surfaces a new Google connection adds only the new rows. This resolves the OAuth-map gotcha: *"if the admin account is reused for new brand+region, must not duplicate credential but instead create new link to existing account credential."*

## Data Model

This spec adds **no new tables**. It consumes the ACL's `gateway_oauth_accounts` and `gateway_oauth_account_links` verbatim, and adds **two nullable columns plus one unique index** to the existing Phase 4 `gateway_google_credentials` table.

### `gateway_google_credentials` — additive migration

Run inside `GatewayGoogleStore.runMigrations()`. The current table (`store.ts:286-299`) has **no** unique constraint, and `saveCredential` (`store.ts:141-170`) is a plain `INSERT` with a fresh `generatedId('google_cred_')` per call — so a populated Phase-4 DB may already hold multiple rows for the same `(brand, region, product)` tuple. The unique index therefore CANNOT be created blindly; a dedup/backfill step runs first.

```sql
-- 1) Add columns idempotently (SQLite has no ADD COLUMN IF NOT EXISTS;
--    guard with PRAGMA table_info(gateway_google_credentials)).
ALTER TABLE gateway_google_credentials ADD COLUMN account_id TEXT;       -- advisory FK -> gateway_oauth_accounts(id)
ALTER TABLE gateway_google_credentials ADD COLUMN connector_slug TEXT;   -- hyphenated slug, e.g. 'google-analytics-4'

-- 2) BACKFILL connector_slug for pre-existing single-product rows so the natural key is populated:
--    products_json holds a JSON array (e.g. '["ga4"]'); for single-product rows derive the slug
--    from the product via the inverse of googleConnectorBinding. Multi-product Phase-4 rows
--    (products.length > 1) are LEFT NULL and never participate in the unique index (see below).
UPDATE gateway_google_credentials
   SET connector_slug = <slug derived from json_extract(products_json,'$[0]')>
 WHERE connector_slug IS NULL
   AND json_array_length(products_json) = 1;

-- 3) DEDUP rows that now collide on (brand_id, region_id, connector_slug): keep the most recently
--    updated row, delete its older duplicates (and their bindings) in a transaction, BEFORE the
--    unique index is created. This is the step the original draft omitted.

-- 4) Now the partial unique index is safe. It is partial so legacy/multi-product rows
--    (connector_slug IS NULL) never collide and the back-compatible path is preserved.
CREATE INDEX IF NOT EXISTS idx_google_cred_account
  ON gateway_google_credentials(account_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_google_cred_scope
  ON gateway_google_credentials(brand_id, region_id, connector_slug)
  WHERE connector_slug IS NOT NULL;
```

- `account_id` (nullable) points at `gateway_oauth_accounts(id)`. The FK is advisory (SQLite cannot `ALTER`-add a column-level FK); it is enforced in application code via `GatewayAccountStore`. A Phase-4-era row created before linking has `account_id = NULL` and keeps its own refresh token (back-compatible). A linked row resolves its refresh token from the account.
- `connector_slug` (nullable) is the **natural-key discriminator** for idempotent provisioning. It holds the connector's hyphenated `.slug` (`google-analytics-4`, `google-search-console`, `google-ads`, `merchant-center`), derived from the connector's `.slug` field (D3) — never from `connector_id` and never by string-parsing a connection id.
- **Why not `products_json`?** `products_json` is a JSON array string (`store.ts:148,160`); a unique index on it is order/whitespace sensitive and is the wrong identity (a multi-product Phase-4 credential would never match a single-product linked row). The connection-scope identity the spec actually needs is `(brand_id, region_id, connector_slug)` (D6). The original draft's `idx_google_cred_scope(brand_id, region_id, products_json)` is dropped entirely.
- `saveCredential` is supplemented by `upsertCredential` using `INSERT ... ON CONFLICT(brand_id, region_id, connector_slug) DO UPDATE SET ... RETURNING id` (better-sqlite3 `^12.10.0` supports `RETURNING`, confirmed in `package.json`). It returns the `RETURNING id` value — NOT a freshly generated id — so a re-provision returns the existing `google_cred_*`. `INSERT OR REPLACE` is explicitly NOT used (it would change the rowid/id and break the same-id guarantee, D6).

### Account + link rows (owned by the ACL dependency, populated here)

```
gateway_oauth_accounts                       gateway_oauth_account_links
  id = oauth_acct_*                             id = oauth_link_*
  service = 'google'              ◄──────────── account_id  (FK)
  external_account_id = <email>                 brand_id
  encrypted_payload (refresh tok)               region_id
  scope = 'analytics.readonly …'                connector_slug ∈ {google-analytics-4,
  status = connected                                              google-search-console,
                                                                  google-ads, merchant-center}
                                                connection_id  ← set to devapi_*/connection_* on link
                                                UNIQUE(account_id, brand_id, region_id, connector_slug)

gateway_google_credentials (live token per connection)
  id = google_cred_*
  brand_id, region_id, connector_slug (NEW), products_json
  account_id  ────────────────────────────────► gateway_oauth_accounts(id)   (NEW, nullable)
  encrypted_payload (access token minted from the account)
```

One Google account → many links → one live `gateway_google_credentials` row per linked connection. The link table is the source of truth for *which* connection belongs to *which* account; the google_credentials row is the cache of the *live access token* for that connection.

## Type Surface

```typescript
// src/google-oauth/types.ts  (additions)

import type { GoogleProduct } from "./types.js"; // ga4 | gsc | google_ads | merchant_center (existing)

// Maps the seeded connector slug -> Phase 4 GoogleProduct, and the configSummary key the
// resourceId is read from. This is the single source of truth for derivation.
// Keyed on the connector's .slug field (hyphenated), per suite decision D3.
export const googleConnectorBinding: Record<
  string,
  { product: GoogleProduct; configKey: string }
> = {
  "google-analytics-4":     { product: "ga4",             configKey: "property_id" },
  "google-search-console":  { product: "gsc",             configKey: "site_url" },
  "google-ads":             { product: "google_ads",      configKey: "customer_id" },
  "merchant-center":        { product: "merchant_center", configKey: "merchant_center_id" }
};

export type GoogleLinkPlanStatus = "proposed" | "already_linked" | "unmatched";

// One row per Google connection in the snapshot.
export interface GoogleLinkPlanEntry {
  connectionId: string;        // devapi_<brand>_<region>_<connector_slug_idParted> | connection_<...>
  brandId: string;
  regionId: string;
  connectorSlug: string;       // from connector.slug: google-analytics-4 | google-search-console | google-ads | merchant-center
  product: GoogleProduct;
  resourceId?: string;         // derived from configSummary[configKey]; undefined => unmatched
  resourceName?: string;       // connection.displayName, for the review UI
  status: GoogleLinkPlanStatus;
  existingLinkId?: string;     // present when already_linked
  reason?: string;             // e.g. "configSummary has no property_id"
}

export interface GoogleLinkPlan {
  accountId: string;
  googleAccountEmail: string;
  entries: GoogleLinkPlanEntry[];
  counts: { proposed: number; alreadyLinked: number; unmatched: number };
}

// Body of POST /account/link. Empty/omitted connectionIds => link ALL proposed entries.
export interface GoogleLinkRequest {
  connectionIds?: string[];
}

export interface GoogleLinkResult {
  accountId: string;
  linked: Array<{ connectionId: string; linkId: string; credentialId: string }>;
  skipped: Array<{ connectionId: string; reason: string }>;
}
```

The existing `GoogleProduct`, `googleProductScopes`, `GoogleOAuthCredential`, `GoogleTokenPayload`, `GoogleOAuthState` types are unchanged. The account-layer types (`OAuthAccount`, `OAuthAccountLink`, `OAuthAccountTokenPayload`, `UpsertAccountInput`, `LinkAccountInput`, `AccountScopeQuery`, `OAuthService`) are imported from `src/account-credentials/types.ts` exactly as defined by the ACL dependency.

## Linking Algorithm — `GoogleAccountLinker`

`src/google-oauth/linker.ts`. Constructed with the read-only backend, the ACL `GatewayAccountStore`, the `GatewayGoogleStore`, and the `GoogleOAuthAdapter` (for minting connection access tokens).

```typescript
class GoogleAccountLinker {
  constructor(
    private readonly backend: GatewayConnectionBackend,
    private readonly accountStore: GatewayAccountStore,
    private readonly googleStore: GatewayGoogleStore,
    private readonly adapter: GoogleOAuthAdapter
  ) {}

  async buildPlan(accountId: string): Promise<GoogleLinkPlan>;
  async applyLinks(accountId: string, request: GoogleLinkRequest): Promise<GoogleLinkResult>;
}
```

### `buildPlan(accountId)` — derive, match, classify

1. Load the account via `accountStore.getAccount(accountId)`; require `service === "google"` and `status === "connected"`. (404/409 surfaced by the route.)
2. Snapshot connections via `backend.snapshot()`. For each connection, resolve its connector by `connection.connectorId` and read the connector's `.slug`. Filter to the four Google connector slugs (`googleConnectorBinding` keys). `connectorSlug` is taken from the connector's `.slug` field — **never** parsed from the connection id (D3). Non-Google connections are ignored.
3. For each Google connection, derive the binding:
   - `{ product, configKey } = googleConnectorBinding[connectorSlug]`.
   - `resourceId = connection.configSummary[configKey]?.trim()`.
   - Normalise per product: GA4 accepts the `properties/` prefix; GSC keeps the `sc-domain:`/URL form as-is; Ads strips dashes/spaces from `customer_id`; Merchant Center keeps the bare numeric id. Normalisation is read-only — it does not mutate `configSummary`.
4. Classify each entry:
   - **`unmatched`** if `resourceId` is empty/absent → `reason: "configSummary has no <configKey>"`. (Connection is configured in the gateway but the Dev API did not supply the id; admin must fix upstream.)
   - **`already_linked`** if `accountStore.getLinkForScope({ service:"google", brandId, regionId, connectorSlug })` resolves to a link whose `accountId` equals this account → carries `existingLinkId`.
   - **`proposed`** otherwise.
5. Return the `GoogleLinkPlan` with counts. The plan is **pure** (no writes), so it is safe to call from a GET route and re-call freely.

### `applyLinks(accountId, request)` — confirm + provision

Runs once per confirmed connection; a mid-batch failure on one connection records a `skipped` entry rather than aborting the batch.

For each target connection (`request.connectionIds` ∩ `proposed`, or all `proposed` when omitted):

1. **Link.** `accountStore.linkAccount({ accountId, brandId, regionId, connectorSlug, connectionId })` — upsert on `UNIQUE(account_id, brand_id, region_id, connector_slug)`, returns `oauth_link_*`. Re-applying an `already_linked` entry is a no-op upsert (id stable, `updatedAt` advances).
2. **Provision the live token.** `adapter.provisionConnectionCredential({ accountId, brandId, regionId, connectorSlug, product, resourceId, resourceName })`:
   - Decrypt the account payload (`OAuthAccountTokenPayload.refreshToken`) with `GOOGLE_OAUTH_ENCRYPTION_KEY`.
   - Mint a fresh access token from the account refresh token (reuse the `GOOGLE_TOKEN_URL` `grant_type=refresh_token` path already in `adapter.ts:204-242`).
   - Build a `GoogleTokenPayload` (`accessToken` only; `refreshToken` omitted at connection scope — the account owns it, see Security), `scope = googleProductScopes[product]`, `googleAccountEmail`.
   - `googleStore.upsertCredential({ brandId, regionId, connectorSlug, accountId, products:[product], googleAccountEmail, encryptedPayload, tokenExpiryAt, status:"connected" })` — idempotent upsert on `(brand_id, region_id, connector_slug)` via `ON CONFLICT ... DO UPDATE ... RETURNING id`, returns `google_cred_*` (stable id on re-provision).
3. **Bind the link to the connection credential.** `accountStore.setLinkConnectionId(linkId, connectionId)` (already populated in step 1; reasserted for clarity) and record `{ connectionId, linkId, credentialId }` in `linked`.
4. **Audit.** Emit `oauth_account_link.created` (ACL-provided action + `oauth_account_link` targetType, D1) and `connection.saved` (pre-existing action, `connection` targetType) for the provisioned credential, via the injected `GatewayAccessStore.writeAccessAudit` (see API/MCP Surface for the wiring).

`unmatched` and not-requested entries are returned in `skipped` with a reason. The method is idempotent: a second call after a Dev API refresh links only newly-appeared connections.

### Re-link behaviour when new connections appear

The Dev API is read fresh on every `snapshot()` (no caching in Phase 1), so new Google connections appear automatically. The admin (or a scheduled job) re-calls `GET /account/link-plan`: previously-linked connections show `already_linked`, brand-new ones show `proposed`. `POST /account/link` with no body links exactly the new `proposed` set. No existing link, credential, or account row is recreated or duplicated. If a connection's `configSummary` id later changes upstream, the entry stays `already_linked` (scope key is brand+region+connector_slug, not the id); a future iteration MAY add a `resync` flag to re-mint on id drift — out of scope here.

## API / MCP Surface

Four new routes on the existing `/admin/google-oauth` router (`src/google-oauth/routes.ts`). The `/account/start`, `/account/link-plan`, and `/account/link` routes require the gateway `Bearer` token via the existing `requireBearer` middleware (`routes.ts:42-52`); `/account/callback` is the browser redirect and is gated by single-use `state`. When `GOOGLE_OAUTH_*` env is absent the router already returns `501` for everything (`routes.ts:31-39`); these routes inherit that.

**Note on auth scope.** The `requireBearer` check is the gateway shared-bearer used by all Phase 4 google-oauth mutation routes — it is NOT the `/api/v1` `gatewayApiAuth`/scope system (D2). These `/account/*` routes are operator-facing google-oauth routes and intentionally stay on the google-oauth router behind the same shared bearer as the Phase 4 `/start`, `/credentials/*`, and `/refresh` routes. They are not `/api/v1` client-management endpoints, so D2's "move to /api/v1" rule does not apply here.

**Router wiring (real, non-free — D9).** `createGoogleOAuthRouter` currently receives only `{config, adapter, store, bearer}` (`routes.ts:8-13`) and is constructed at `index.ts:90-98` with no audit dependency. This spec extends `CreateGoogleOAuthRouterOptions` to also accept:

```typescript
export interface CreateGoogleOAuthRouterOptions {
  config: GoogleOAuthConfig | undefined;
  adapter: GoogleOAuthAdapter | undefined;
  store: GatewayGoogleStore | undefined;
  bearer: string;
  accessStore?: GatewayAccessStore;   // NEW — for audit emission on /account/* (D9)
  accountStore?: GatewayAccountStore; // NEW — ACL store (D8: constructed as new GatewayAccountStore(STORE_PATH))
  linker?: GoogleAccountLinker;       // NEW — built in index.ts
}
```

`index.ts` injects the already-constructed `accessStore` (`index.ts:42`, `new GatewayAccessStore(config.gatewayStorePath)`) and the ACL `accountStore` (constructed as `new GatewayAccountStore(config.gatewayStorePath)` — a PATH STRING, per D8, never a db object), and builds the `GoogleAccountLinker`. The `/account/*` handlers call `accessStore.writeAccessAudit({ action, targetType, targetId, detail, actor, metadata })` (signature `AccessAuditInput`, `src/access/types.ts:60-67`; method `src/access/store.ts:557`). The `action`/`targetType` values (`oauth_account.*`, `oauth_account_link.*`) are valid only because ACL has added them to the closed unions (D1).

### `POST /admin/google-oauth/account/start` — one consent for the whole account

Requests all four product scopes in a single grant. Uses a **distinct** code path `adapter.startAccountFlow()` (D-google: account flow must NOT be a sentinel on the per-brand `completeFlow`, which unconditionally calls `store.saveCredential` and iterates `oauthState.bindings`, `adapter.ts:119-148`). `startAccountFlow` writes an account-flow state row (its own state table OR a flagged column; the implementer chooses, but the callback dispatches on it so it can never fall through to per-brand `saveCredential`).

Request: `{}` (no brand/region — that is the whole point). Response:
```json
{ "redirectUrl": "https://accounts.google.com/o/oauth2/v2/auth?...scope=openid+email+profile+analytics.readonly+webmasters.readonly+adwords+content...", "state": "..." }
```

### `GET /admin/google-oauth/account/callback` — store the account credential

Browser redirect (no bearer, validated by single-use `state`). Dispatches to `adapter.completeAccountFlow()` — the distinct account path — which exchanges the code, fetches userinfo for `googleAccountEmail`, then upserts ONE account row:
```typescript
const payload: OAuthAccountTokenPayload = {
  service: "google",
  refreshToken: tokenResponse.refresh_token,   // the durable account secret
  accessToken: tokenResponse.access_token,
  scope: tokenResponse.scope,
  externalAccountId: userInfo.email
};
const accountId = accountStore.upsertAccount({
  service: "google",
  externalAccountId: userInfo.email,
  displayName: "Haverford Google Admin",
  encryptedPayload: encryptAccount(payload, encryptionKey),
  scope: tokenResponse.scope,
  status: "connected",
  tokenExpiryAt
});
```
`upsertAccount` uses `ON CONFLICT(service, external_account_id) DO UPDATE ... RETURNING id` and returns the existing id on re-auth (ACL contract). Response: `{ "account": { "id": "oauth_acct_*", "service": "google", "externalAccountId": "...", "status": "connected", ... } }` (no `encryptedPayload`). Audit: `oauth_account.created` (or `oauth_account.updated` on re-auth), targetType `oauth_account` — both ACL-provided.

### `GET /admin/google-oauth/account/link-plan?accountId=oauth_acct_*` — preview

Returns the pure `GoogleLinkPlan`. When `accountId` is omitted and exactly one `google` account exists, it is inferred via `accountStore.listAccounts("google")`.
```json
{
  "accountId": "oauth_acct_20260605_ab12",
  "googleAccountEmail": "admin@haverford.com.au",
  "counts": { "proposed": 38, "alreadyLinked": 0, "unmatched": 2 },
  "entries": [
    { "connectionId": "devapi_haverford_au_google_analytics_4", "brandId": "brand_haverford",
      "regionId": "region_haverford_au", "connectorSlug": "google-analytics-4",
      "product": "ga4", "resourceId": "properties/123456789",
      "resourceName": "Haverford AU Google Analytics 4", "status": "proposed" },
    { "connectionId": "devapi_haverford_au_merchant_center", "brandId": "brand_haverford",
      "regionId": "region_haverford_au", "connectorSlug": "merchant-center",
      "product": "merchant_center", "status": "unmatched",
      "reason": "configSummary has no merchant_center_id" }
  ]
}
```

The `connectionId` values use the **underscore** form: the mapper emits `devapi_${idPart(brand.slug)}_${idPart(region.region)}_${idPart(connector.slug)}` where `idPart` replaces `[^a-z0-9]+` with `_` (`dev-api-mapper.ts:197-203,288`), so `google-analytics-4` becomes `google_analytics_4` → `devapi_haverford_au_google_analytics_4` (D4). Fixture-sourced ids use the `connection_<...>` form. The `connectorSlug` field always carries the hyphenated connector `.slug`, derived from the connector — not from the id (D3).

### `POST /admin/google-oauth/account/link` — confirm + provision

Body `GoogleLinkRequest` (`{ "connectionIds": [...] }` or `{}` to link all proposed). Returns `GoogleLinkResult`:
```json
{
  "accountId": "oauth_acct_20260605_ab12",
  "linked": [
    { "connectionId": "devapi_haverford_au_google_analytics_4",
      "linkId": "oauth_link_20260605_cd34", "credentialId": "google_cred_20260605_ef56" }
  ],
  "skipped": [
    { "connectionId": "devapi_haverford_au_merchant_center", "reason": "unmatched: no merchant_center_id" }
  ]
}
```
Errors: `404 not_found` (unknown `accountId`), `409 conflict` (account not `connected`), `400 invalid_input` (malformed body). Per-connection provisioning failures land in `skipped`, never abort the batch.

### Admin review UI

A thin admin page renders `link-plan` as a table grouped by brand → region, with a count summary (`38 proposed, 0 linked, 2 unmatched`), per-row checkboxes (pre-checked for `proposed`, disabled for `unmatched` with the reason shown inline), and a **Confirm linking** button that POSTs the checked `connectionIds` to `/account/link`. `already_linked` rows render greyed with their `existingLinkId`. After confirm, the page re-fetches `link-plan` so the admin sees everything flip to `already_linked`. This is review-and-confirm, not data entry — there are no editable fields. No MCP tools are added.

## Security

- **One encrypted account secret.** The account refresh token lives only in `gateway_oauth_accounts.encrypted_payload`, AES-256-GCM via `shared/token-crypto.ts` (re-exported by `google-oauth/crypto.ts`) with the existing `GOOGLE_OAUTH_ENCRYPTION_KEY` (`config.ts:128`). Connection-scope `gateway_google_credentials` rows store only a short-lived **access** token (no refresh token), so the durable secret exists in exactly one row — fewer copies than today's per-brand duplication. `account/*` routes return payload-stripped `OAuthAccount` objects (the ACL dependency guarantees `OAuthAccount` has no `encryptedPayload`).
- **Refresh resolves up, not sideways.** `refreshTokenIfNeeded(credentialId)` reads the connection credential's `account_id`; if set, it loads the account, refreshes the **account** refresh token once (`GOOGLE_TOKEN_URL` `grant_type=refresh_token`, `adapter.ts:204-242`), and updates the access token on this and (in a batch refresh helper) every other connection credential sharing that `account_id`. A connection credential with `account_id = NULL` (legacy Phase 4) keeps its own refresh path unchanged. This honours the OAuth-map gotcha that *"account credentials must resolve brand+region → account credential → token fetch to preserve refresh semantics."*
- **Account isolation.** A connection reaches the account only through an explicit `gateway_oauth_account_links` row (`getLinkForScope` constrains to one `(service, brandId, regionId, connectorSlug)` tuple) or its own `account_id` FK. The `UNIQUE` constraints prevent duplicate/spoofed links.
- **Non-secret IDs only.** `configSummary` resource ids (`property_id`, `site_url`, `customer_id`, `merchant_center_id`) are non-secret by construction (they never match `secretLikePattern`, so `safeConfigSummary` keeps them, `dev-api-mapper.ts:194-218`, confirmed). The linker reads them, never writes credentials into `configSummary`, and never logs the account token. The model-map redaction contract is untouched.
- **Single-use state, distinct callback path.** `/account/start` uses a single-use, 10-min-TTL state for CSRF protection; `/account/callback` dispatches to `completeAccountFlow` (a distinct path), so an account callback can never be replayed as a per-brand callback or fall through to per-brand `saveCredential`.
- **Bearer parity.** All `/account/*` non-browser routes use the same `requireBearer` timing-safe check as Phase 4 (`routes.ts:42-52`); only the browser `callback` is bearer-less and is gated by the one-time state.
- **Revocation.** Revoking the Google account flips `gateway_oauth_accounts.status` to `needs_reconnect` (ACL `updateAccountStatus`); linked connection credentials surface `needs_reconnect` on their next status check. Links survive a temporary disconnect (per the ACL's "status, not data, on reconnect" rule); a hard `deleteAccount` cascades links in one transaction. Account revocation/deletion audits use the ACL-provided `oauth_account.revoked` / `oauth_account_link.removed` actions (D1).

## Testing Strategy

Both new test files use a fresh temp SQLite file per test and a stubbed `fetchFn` — no network. A shared `GatewayAccessStore` + ACL `GatewayAccountStore` + `GatewayGoogleStore` are constructed on the same temp db path (each via its PATH-STRING constructor, D8), mirroring `test/access-store.test.ts` and the existing google-oauth tests.

### `test/google-account-linker.test.ts`

- **id derivation per product** — fixture snapshot with one connection per slug (connector resolved by `connectorId`, slug read from connector `.slug`); assert `buildPlan` derives `ga4←property_id`, `gsc←site_url`, `google_ads←customer_id`, `merchant_center←merchant_center_id`, with GA4 `properties/` and Ads dash normalisation applied. Assert `connectorSlug` comes from the connector, not from the id string.
- **connection-id form** — assert a `devapi`-sourced GA4 connection has id `devapi_<brand>_<region>_google_analytics_4` (underscores) and a fixture-sourced one uses `connection_<...>`; derivation is unaffected by id form.
- **unmatched classification** — a `google-analytics-4` connection whose `configSummary` lacks `property_id` is `unmatched` with the reason string; never linked by `applyLinks`.
- **proposed → linked idempotency** — `applyLinks(account, {})` links all proposed; a second `applyLinks` produces zero new links (still N rows), link ids stable, `updatedAt` advances; one `gateway_google_credentials` row per connection (upsert on `(brand,region,connector_slug)`, id stable, not duplicated).
- **already_linked detection** — after `applyLinks`, `buildPlan` reports the same connections as `already_linked` with their `existingLinkId`; counts shift from `{proposed:N}` to `{alreadyLinked:N}`.
- **re-link of new connection** — extend the snapshot with a brand-new `google-ads` connection, re-`buildPlan`: only the new one is `proposed`; `applyLinks({})` links exactly it; total link count = N+1, no duplicates.
- **connection_id binding** — every created link has `connection_id` set to the source connection id (`getLinkForScope(...).connectionId` matches).
- **multi-brand fan-out** — one account, connections across 3 brands × 2 regions × 4 products; assert one account row, 24 links, 24 credentials, all `account_id` equal.
- **dedup/backfill migration** — seed a Phase-4-style DB with two duplicate `(brand,region,product)` rows and a NULL `connector_slug`; run `runMigrations()`; assert backfill populates `connector_slug` for single-product rows, dedup leaves one row per `(brand,region,connector_slug)`, the unique index creates without throwing, and multi-product legacy rows (NULL `connector_slug`) are untouched and excluded from the partial index.

### `test/google-oauth-account-routes.test.ts`

- **account consent upsert** — drive `/account/start` then `/account/callback` (stubbed token+userinfo); assert one `gateway_oauth_accounts` row, status `connected`, response has no `encryptedPayload`; second callback for the same email upserts (still one row, SAME id returned, `oauth_account.updated` audit with targetType `oauth_account`).
- **distinct account path** — assert `/account/callback` writes NO `gateway_google_credentials` row and does NOT invoke the per-brand `saveCredential` path (only the account row is created).
- **link-plan GET** — after seeding Google connections, `GET /account/link-plan` returns correct `counts` and entry statuses; omitting `accountId` infers the sole google account.
- **link POST all** — `POST /account/link {}` returns `linked` for every proposed connection and `skipped` for unmatched; emits `oauth_account_link.created` + `connection.saved` audits via the injected `accessStore`; re-POST returns empty `linked` (idempotent).
- **link POST subset** — `POST /account/link {connectionIds:[one]}` links only that connection.
- **account-level refresh fan-out** — provision two connections from one account, expire both access tokens, call refresh on one connection credential; stubbed refresh returns a new token; assert the account refresh token was used and BOTH connection credentials got the new access token + advanced expiry, while the account refresh token is unchanged.
- **errors** — unknown `accountId` → 404; account in `needs_reconnect` → 409; `GOOGLE_OAUTH_*` unset → all `/account/*` routes 501.

No existing Phase 4 test is modified except adding coverage for the additive `account_id`/`connector_slug` column round-trip (a Phase-4-style per-brand credential with `account_id = NULL` and `connector_slug = NULL` still saves, reads, and refreshes exactly as before, and is excluded from the partial unique index).

## Verification Gate

- `npm run typecheck` clean (only possible AFTER the ACL dependency has merged and provides the account types + audit-union members)
- `npm run build` clean
- full `npm test` green (including `test/google-account-linker.test.ts` and `test/google-oauth-account-routes.test.ts`)
- additive migration is idempotent AND safe on populated data: running `GatewayGoogleStore.runMigrations()` twice does not error on `account_id`/`connector_slug` (guarded by `PRAGMA table_info`); the dedup/backfill runs before `CREATE UNIQUE INDEX idx_google_cred_scope` so the index never throws on a Phase-4 DB with pre-existing duplicate rows
- exactly one `gateway_oauth_accounts` row after repeated `/account/start` + `/account/callback` for the same `googleAccountEmail`, with the SAME `oauth_acct_*` id returned each time
- the account callback never writes a per-brand `gateway_google_credentials` row (distinct code path verified)
- no plaintext token persisted in `gateway_google_credentials` or returned by any `/account/*` route (asserted by reading the raw `encrypted_payload` column and confirming it does not contain the cleartext access/refresh token substring)
- `configSummary` of every Google connection is byte-for-byte unchanged after linking (linker is read-only against the snapshot)
- `accessStore.writeAccessAudit` is reachable from the `/account/*` handlers and emits `oauth_account.*` / `oauth_account_link.created` / `connection.saved` without a type error (depends on ACL having added the union members per D1)
