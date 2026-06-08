# Haverford Unified Gateway — Account Credential Layer — Design Spec

**Status:** draft — pending review
**Issue:** [#31](https://github.com/leebaroneau/template-gateway/issues/31)
**Epic:** [#19](https://github.com/leebaroneau/template-gateway/issues/19)
**Date:** 2026-06-05
**Branch:** `task/31-account-credential-layer`

## Context

OAuth credentials in this gateway are not always per-brand, but the storage model assumes they are. The OAuth subsystem map is explicit: "each brand+region (Google) or shop (Shopify) receives an independent credential record, meaning a single OAuth account authorizing multiple stores results in duplicate credentials and tokens in the database."

The real topology:

- **Shopify** — 3 separate Partner orgs spread across ~20 brands. The Partner org (and the app installed under it) is the unit of authorisation; individual store access tokens hang off it.
- **Google** — ONE admin account (`googleAccountEmail`) covering GA4/GSC/Ads/Merchant Center properties for every brand. Forcing brand-level OAuth means re-consenting the same admin account 20 times.

This is exactly the account/org-vs-connection split Composio models. The gateway must support BOTH scopes:

- **account/org scope** — one platform credential per `(service, account)`, authorised once, encrypted at rest.
- **brand scope** — an individual brand+region(+connection) link that DERIVES from an account credential.

This spec introduces a **brand-agnostic account-credential layer**: a `gateway_oauth_accounts` table storing a platform-level credential per `(service, external_account_id)` with encryption at rest (reusing `src/shared/token-crypto.ts` exactly as Google and Shopify do today), plus a `gateway_oauth_account_links` table that fans one account credential out to many brand+region connections.

**Scope boundary.** This spec is the FOUNDATION that the Google OAuth spec and the Shopify multi-org work build on. Its deliverable is the shared tables, the `GatewayAccountStore`, the shared TypeScript types, and the audit-union edits — named precisely so the downstream specs reference them verbatim. It deliberately does **not**:

- Migrate the existing `gateway_google_credentials` / `gateway_shopify_credentials` flows. Those tables keep storing the per-brand+region / per-shop **live** token as the connection's credential. The downstream specs rewire their adapters to provision FROM an account credential.
- Add new HTTP or MCP endpoints. The account layer is internal infrastructure consumed by the Google/Shopify adapters; admin and MCP surfaces are owned by the flows that already expose them (`/admin/google-oauth`, `/admin/shopify-oauth`).
- Change the encryption primitive or key material. Per-platform `*_OAUTH_ENCRYPTION_KEY` env vars remain the source of key material (gotcha: "Encryption key is environment/config global; all linked brands share the same key").

**Audit-union ownership (suite decision D1).** ACL OWNS all audit-union edits for the credential layer. Even though ACL emits no events itself (it has no endpoints), it adds the `oauth_account.*` / `oauth_account_link.*` members to `AuditAction` AND the `'oauth_account'` / `'oauth_account_link'` members to `AuditEvent.targetType` in the SAME change, so the downstream Google spec can emit them against an already-extended closed union rather than each spec re-litigating it. The downstream Google spec only EMITS these actions; it does not re-declare them.

## Module Layout

```
src/account-credentials/types.ts     # OAuthAccount, OAuthAccountLink, OAuthService, payload + input types
src/account-credentials/store.ts     # GatewayAccountStore (gateway_oauth_accounts + gateway_oauth_account_links)
src/account-credentials/crypto.ts    # typed re-export of shared/token-crypto.ts (matches google-oauth/crypto.ts pattern verbatim)
src/admin/types.ts                   # + AuditAction: oauth_account.* / oauth_account_link.* ; + AuditEvent.targetType: 'oauth_account' / 'oauth_account_link'
src/index.ts                         # construct one GatewayAccountStore UNCONDITIONALLY (mirror appInstallStore); share with Google + Shopify adapters
test/account-store.test.ts           # upsert idempotency, link fan-out, scope lookup, cascade delete, crypto round-trip
```

The module is a sibling of `google-oauth/` and `shopify-oauth/` and follows the same shape: `types.ts` for the public contract, `store.ts` for the SQLite persistence, `crypto.ts` as a typed re-export of the shared AES-256-GCM helpers.

## Why a separate account layer (not a new ad-hoc store)

The model map notes "configSummary is read-only metadata, not credential storage" and that future OAuth integration "will add separate credential tables." The Google and Shopify stores already prove the seam: each is a standalone `Database` on `config.gatewayStorePath` with its own `runMigrations()` using plain `CREATE TABLE IF NOT EXISTS` (verified: `google-oauth/store.ts:275-311`, `apps/store.ts:160-175` — none touch `gateway_schema_migrations`). `GatewayAccountStore` extends that same seam rather than overloading either platform store, because:

1. **Polymorphic, not per-platform.** One Google account and one Shopify Partner org must live in the same conceptual table so the downstream specs share lookup/refresh code. A `service` discriminator column handles both (resolves the OAuth map's open question on unified-vs-polymorphic storage in favour of unified with a `service` enum).
2. **Identity differs from token.** The account row holds the durable, refreshable secret (Google's `refresh_token`; the Shopify Partner-org/app identity). The per-store live token (Shopify store access token) stays in `gateway_shopify_credentials` as the connection's live credential, provisioned FROM the account. This preserves the existing webhook (`app/uninstalled`, `shop/redact`) and `getCredentialByShop()` paths — the downstream Shopify spec adds the reverse `shop -> account` lookup via the link table.

## Data Model

Two new tables in the shared gateway SQLite file (created by `GatewayAccountStore.runMigrations()`, `foreign_keys = ON`, same as the Google/Shopify/apps stores). Migrations use plain `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS` — explicitly NOT the versioned `gateway_schema_migrations` table (that table is owned only by `access/store.ts` and `overlay-store.ts`; standalone platform stores never use it).

### `gateway_oauth_accounts`

The platform-level credential. One row per `(service, external_account_id)`.

```sql
CREATE TABLE IF NOT EXISTS gateway_oauth_accounts (
  id                  TEXT PRIMARY KEY NOT NULL,          -- oauth_acct_<ts>_<hex>
  service             TEXT NOT NULL,                       -- 'google' | 'shopify' (OAuthService)
  external_account_id TEXT NOT NULL,                       -- google account email | shopify partner org id
  display_name        TEXT,                                -- human label e.g. "Haverford Google Admin"
  encrypted_payload   TEXT NOT NULL,                       -- AES-256-GCM via shared/token-crypto.ts
  scope               TEXT,                                -- space/comma list as granted (nullable)
  status              TEXT NOT NULL,                       -- 'connected' | 'needs_reconnect' | 'error'
  token_expiry_at     TEXT,
  last_refreshed_at   TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  error_detail        TEXT,
  UNIQUE(service, external_account_id)
);
```

- `external_account_id` is the natural account key per service: Google uses `googleAccountEmail`; Shopify uses the Partner org / app identifier (the downstream Shopify spec decides the exact string, but it MUST be Partner-org-scoped, not shop-scoped — shop stays in `gateway_shopify_credentials`).
- `UNIQUE(service, external_account_id)` is the whole point: re-authorising the same admin account updates one row (via `upsertAccount`'s `ON CONFLICT(service, external_account_id) DO UPDATE`) instead of inserting a duplicate. This directly fixes the duplicate-credential problem.
- `encrypted_payload` stores an `OAuthAccountTokenPayload` (below). The payload column is NEVER present on the public `OAuthAccount` type — `store.ts` strips it exactly as `google-oauth/store.ts` and `shopify-oauth/store.ts` do.
- `status` reuses the existing `connected | needs_reconnect | error` vocabulary shared by `GoogleCredentialStatus` and `ShopifyCredentialStatus`, so downstream code maps account status onto connection status without translation.

### `gateway_oauth_account_links`

The account -> connection fan-out. One row per brand+region(+connection) that derives from an account.

```sql
CREATE TABLE IF NOT EXISTS gateway_oauth_account_links (
  id              TEXT PRIMARY KEY NOT NULL,               -- oauth_link_<ts>_<hex>
  account_id      TEXT NOT NULL,                            -- FK -> gateway_oauth_accounts(id)
  brand_id        TEXT NOT NULL,
  region_id       TEXT NOT NULL,
  connector_slug  TEXT NOT NULL,                            -- hyphenated connector slug: 'shopify', 'google-analytics-4'
  connection_id   TEXT,                                     -- nullable: gateway/devapi connection id once provisioned
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE(account_id, brand_id, region_id, connector_slug),
  FOREIGN KEY(account_id) REFERENCES gateway_oauth_accounts(id)
);

CREATE INDEX IF NOT EXISTS idx_oauth_links_account ON gateway_oauth_account_links(account_id);
CREATE INDEX IF NOT EXISTS idx_oauth_links_scope
  ON gateway_oauth_account_links(brand_id, region_id, connector_slug);
```

- A link binds the brand-scope tuple `(brand_id, region_id, connector_slug)` to an account-scope credential. This is the mechanism that lets one Google admin account fan out to 20 brands and one Shopify Partner org fan out to many stores.
- **`connector_slug` is the suite-wide connection discriminator (decision D3): the connector's hyphenated `.slug` value** (e.g. `'shopify'`, `'google-analytics-4'`), derived from the connector's `slug` field — NEVER from `connector_id` (e.g. `'connector_shopify'`) and NEVER by string-parsing a connection id. The Per-Connection MCP per-connection-token table keys on this same `connector_slug` value, so the whole suite uses one vocabulary.
- `UNIQUE(account_id, brand_id, region_id, connector_slug)` prevents duplicate links and gives `linkAccount` clean upsert semantics. `connector_slug` is included because the same brand+region may bind to multiple connectors (Shopify commerce + GA4 analytics) backed by different accounts.
- `connection_id` is nullable so a link can be created at consent time and populated once the gateway provisions the actual `Connection`. Connection-id format follows the suite convention (decision D4): Dev-API-sourced ids use UNDERSCORE normalization `devapi_<brand>_<region>_<connector_slug_idParted>` (e.g. `devapi_haverford_au_google_analytics_4`, where idPart replaces `[^a-z0-9]+` with `_` per `dev-api-mapper.ts:197-203,288`); fixture-sourced ids use the `connection_<...>` form. The scope index supports the hot reverse lookup the downstream specs need: given a connection's brand+region+connector_slug, resolve the parent account for token fetch/refresh (resolves the OAuth map gotcha that "account credentials must resolve brand+region -> account credential -> token fetch").
- ID prefixes `oauth_acct_` and `oauth_link_` follow the existing `generatedId(prefix)` convention (`google_cred_`, `shopify_cred_`, `google_bind_`, `appinstall_`). Per the model map, ID prefixes are an immutable contract; these two are newly reserved here.

### Relationship to existing tables

```
gateway_oauth_accounts (1) ──< gateway_oauth_account_links (N)
                                        │
        link.connection_id ────────────┘ (nullable, points at a gateway Connection)

gateway_google_credentials   — UNCHANGED. Downstream Google spec adds a connector_slug column + (brand_id, region_id, connector_slug) upsert.
gateway_shopify_credentials  — UNCHANGED. Shop stays the live-token key; downstream adds shop -> account reverse lookup.
```

The account layer sits *above* the existing platform credential tables. The platform tables keep holding the live, connection-scoped token; the account table holds the durable account-scope secret that those live tokens are minted from.

## Type Surface

```typescript
// src/account-credentials/types.ts

export type OAuthService = "google" | "shopify";
export const oauthServices: OAuthService[] = ["google", "shopify"];

// Reuses the connected | needs_reconnect | error vocabulary shared by
// GoogleCredentialStatus and ShopifyCredentialStatus.
export type OAuthAccountStatus = "connected" | "needs_reconnect" | "error";

// Encrypted-at-rest payload. Polymorphic by service; the downstream specs
// narrow it. Stored via shared/token-crypto.ts; never exposed on OAuthAccount.
export interface OAuthAccountTokenPayload {
  service: OAuthService;
  // Google: long-lived refresh token (the durable account-scope secret).
  // Shopify: Partner-org / app-level secret material (NOT a store access token).
  refreshToken?: string;
  accessToken?: string;          // present when the account also holds a live token
  scope?: string;
  externalAccountId: string;     // mirror of the row's external_account_id for integrity checks
}

// Public-facing account record. NO encryptedPayload field.
export interface OAuthAccount {
  id: string;                    // oauth_acct_*
  service: OAuthService;
  externalAccountId: string;
  displayName?: string;
  scope?: string;
  status: OAuthAccountStatus;
  tokenExpiryAt?: string;
  lastRefreshedAt?: string;
  createdAt: string;
  updatedAt: string;
  errorDetail?: string;
}

export interface OAuthAccountLink {
  id: string;                    // oauth_link_*
  accountId: string;
  brandId: string;
  regionId: string;
  connectorSlug: string;         // hyphenated connector slug, e.g. 'shopify', 'google-analytics-4'
  connectionId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertAccountInput {
  service: OAuthService;
  externalAccountId: string;
  displayName?: string;
  encryptedPayload: string;
  scope?: string;
  status: OAuthAccountStatus;
  tokenExpiryAt?: string;
}

export interface LinkAccountInput {
  accountId: string;
  brandId: string;
  regionId: string;
  connectorSlug: string;         // derive from connector.slug, NOT connector_id, NOT a parsed connection id
  connectionId?: string;
}

export interface AccountScopeQuery {
  service: OAuthService;
  brandId: string;
  regionId: string;
  connectorSlug: string;
}
```

### `crypto.ts` — typed re-export (verbatim shape match)

`src/account-credentials/crypto.ts` re-exports the shared AES-256-GCM helpers narrowed to `OAuthAccountTokenPayload`, byte-for-byte mirroring `src/google-oauth/crypto.ts` (verified at that path). It must use the concrete payload type, NOT the generic `<T>` form, so the wrapper is type-safe:

```typescript
// src/account-credentials/crypto.ts
import type { OAuthAccountTokenPayload } from "./types.js";
import {
  decryptCredential as sharedDecryptCredential,
  encryptCredential as sharedEncryptCredential
} from "../shared/token-crypto.js";

export const encryptCredential = (payload: OAuthAccountTokenPayload, base64urlKey: string): string =>
  sharedEncryptCredential(payload, base64urlKey);

export const decryptCredential = (encrypted: string, base64urlKey: string): OAuthAccountTokenPayload =>
  sharedDecryptCredential<OAuthAccountTokenPayload>(encrypted, base64urlKey);
```

No new crypto is written. The shared `encryptCredential<T>` / `decryptCredential<T>` (AES-256-GCM, 12-byte IV, 16-byte tag, `iv:tag:ciphertext` base64url) is used unchanged.

### Audit-union edits (`src/admin/types.ts`) — owned by ACL (D1)

`AuditAction` (currently `src/admin/types.ts:9-33`) gains five members and `AuditEvent.targetType` (currently the closed union `"brand" | "region" | "connection" | "api_key" | "api_client"` at `src/admin/types.ts:112`) gains two members:

```typescript
// added to the AuditAction union:
  | "oauth_account.created"
  | "oauth_account.updated"
  | "oauth_account.revoked"
  | "oauth_account_link.created"
  | "oauth_account_link.removed"

// AuditEvent.targetType extended to:
  targetType: "brand" | "region" | "connection" | "api_key" | "api_client" | "oauth_account" | "oauth_account_link";
```

`AccessAuditInput.targetType` derives from `AuditEvent['targetType']` (`src/access/types.ts:62`), so it follows automatically with no separate edit. ACL emits none of these events itself; the members exist so the downstream Google spec can emit `oauth_account.*` / `oauth_account_link.*` against an already-complete closed union. Adding both the action members and the matching targetType members together avoids the half-wired-contract failure mode (action present, targetType missing) the feasibility review flagged.

## Store API — `GatewayAccountStore`

`src/account-credentials/store.ts`. Constructor signature and lifecycle match `GatewayGoogleStore` / `GatewayShopifyStore` / `GatewayAppInstallStore`: `new GatewayAccountStore(dbPath: string)` (a PATH STRING — the constructor internally does `new Database(dbPath)`, never receives a db object), `fs.mkdirSync(path.dirname(dbPath), { recursive: true })`, `pragma("foreign_keys = ON")`, idempotent `runMigrations()` (plain `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`), `close()`.

```typescript
class GatewayAccountStore {
  constructor(dbPath: string);   // PATH STRING; does new Database(dbPath) internally
  close(): void;

  // ── Accounts ────────────────────────────────────────────────────────────
  // INSERT ... ON CONFLICT(service, external_account_id) DO UPDATE SET ... RETURNING id.
  // Returns the RETURNING id (the EXISTING row's id on conflict), NOT the freshly generated id.
  upsertAccount(input: UpsertAccountInput): string;                       // returns account id
  getAccount(id: string): (OAuthAccount & { encryptedPayload: string }) | undefined;
  getAccountByExternalId(
    service: OAuthService,
    externalAccountId: string
  ): (OAuthAccount & { encryptedPayload: string }) | undefined;
  listAccounts(service?: OAuthService): Array<OAuthAccount & { encryptedPayload: string }>;
  updateAccountPayload(id: string, encryptedPayload: string, tokenExpiryAt?: string): void;
  updateAccountStatus(id: string, status: OAuthAccountStatus, errorDetail?: string): void;
  deleteAccount(id: string): void;                                        // cascades links in one tx

  // ── Links (account -> brand+region+connection fan-out) ───────────────────
  // INSERT ... ON CONFLICT(account_id, brand_id, region_id, connector_slug) DO UPDATE SET ... RETURNING id.
  linkAccount(input: LinkAccountInput): string;                           // returns link id
  listLinksForAccount(accountId: string): OAuthAccountLink[];
  getLinkForScope(query: AccountScopeQuery): OAuthAccountLink | undefined; // hot reverse-lookup
  setLinkConnectionId(linkId: string, connectionId: string): void;
  removeLink(linkId: string): void;
}
```

### Idempotent-id upsert mechanism (feasibility correction — load-bearing)

`generatedId('oauth_acct_')` computes a fresh id on every call, but the acceptance test "calling `upsertAccount` twice with the same `(service, external_account_id)` returns the same id" requires the EXISTING row's id to be returned on the second call. The existing Google/Shopify/apps stores never needed this — they use plain `INSERT` (`google-oauth/store.ts:144`) or `INSERT OR REPLACE` keyed on the same generated id (`apps/store.ts:53`, then re-SELECT by that id). Neither pattern can be copied verbatim here:

- `INSERT OR REPLACE` is forbidden — it deletes and re-inserts the row, changing its rowid/id and breaking the same-id guarantee. Decision D6 prohibits it.
- The store therefore uses `INSERT ... ON CONFLICT(<natural key>) DO UPDATE SET ... RETURNING id` and returns the value `better-sqlite3` hands back from `.get()` (RETURNING is supported on `better-sqlite3 ^12.10.0`, confirmed in `package.json:24`), NOT the freshly generated id.

```typescript
// upsertAccount — natural key UNIQUE(service, external_account_id)
const now = timestamp();
const newId = generatedId("oauth_acct_");
const row = this.db
  .prepare(
    `INSERT INTO gateway_oauth_accounts (
       id, service, external_account_id, display_name, encrypted_payload,
       scope, status, token_expiry_at, last_refreshed_at, created_at, updated_at, error_detail
     )
     VALUES (
       @id, @service, @externalAccountId, @displayName, @encryptedPayload,
       @scope, @status, @tokenExpiryAt, NULL, @now, @now, NULL
     )
     ON CONFLICT(service, external_account_id) DO UPDATE SET
       display_name      = excluded.display_name,
       encrypted_payload = excluded.encrypted_payload,
       scope             = excluded.scope,
       status            = excluded.status,
       token_expiry_at   = excluded.token_expiry_at,
       updated_at        = excluded.updated_at,
       error_detail      = NULL
     RETURNING id`
  )
  .get({ id: newId, /* ...input fields..., */ now }) as { id: string };
return row.id;   // existing id on conflict; newId on first insert
```

`linkAccount` uses the same shape keyed on `ON CONFLICT(account_id, brand_id, region_id, connector_slug) DO UPDATE SET connection_id = COALESCE(excluded.connection_id, connection_id), updated_at = excluded.updated_at RETURNING id`, so re-linking the same tuple advances `updated_at` and returns the original link id.

### Conventions copied verbatim from the existing stores

- `getAccount`/`getAccountByExternalId`/`listAccounts` return the row WITH `encryptedPayload` for internal callers (adapters that decrypt); the public `OAuthAccount` (payload stripped) is what flows to any future API/MCP surface — same split Google/Shopify use (`GoogleOAuthCredential & { encryptedPayload: string }`, verified at `google-oauth/store.ts:327`).
- `getLinkForScope` is the brand-scope -> account-scope resolution the adapters call before fetching/refreshing a token. `deleteAccount` runs the link delete + account delete inside a single `db.transaction(...)`, mirroring `GatewayGoogleStore.deleteCredential` (`google-oauth/store.ts:226-236`).
- `crypto.ts` re-exports `encryptCredential`/`decryptCredential` typed to `OAuthAccountTokenPayload` (shown above), exactly as `google-oauth/crypto.ts` re-exports the shared helpers for `GoogleTokenPayload`. No new crypto is written.

## API / MCP Surface

**None introduced by this spec.** The account layer is internal infrastructure. It is consumed by:

- the existing `/admin/google-oauth` router (rewired by the downstream Google spec to upsert one account and link brand+region tuples to it),
- the existing `/admin/shopify-oauth` router (rewired by the downstream Shopify multi-org spec to resolve `shop -> account` and provision per-store tokens FROM the Partner-org account).

Per suite decision D2, the gateway's only scope-enforcing surface is `/api/v1` (`gatewayApiAuth` + `assertGatewayApiScope`); `createAdminRouter` has NO in-app scope auth. ACL adds no endpoints to either router, so it does not interact with that decision — but any read surface for accounts/links that a downstream spec adds for client management MUST land on `/api/v1` behind `gatewayApiAuth`, not on the admin router. This foundation does not pre-commit a route shape, keeping the surface area minimal per the repo's "keep the custom surface as small as possible" rule.

## Security

- **Encryption at rest.** `encrypted_payload` is AES-256-GCM (random 12-byte IV, 16-byte tag) via `src/shared/token-crypto.ts` — the exact primitive Google and Shopify already use (verified: `IV_LENGTH = 12`, `TAG_LENGTH = 16`, `iv:tag:ciphertext` base64url). No plaintext token ever touches `gateway_oauth_accounts`. The account layer adds zero new crypto code; it re-exports.
- **Key material.** Encryption keys remain per-platform env vars (`GOOGLE_OAUTH_ENCRYPTION_KEY`, `SHOPIFY_OAUTH_ENCRYPTION_KEY`), passed in by the adapter that owns the account, not stored or duplicated by `GatewayAccountStore`. The store is key-agnostic: callers hand it already-encrypted payloads (matching `SaveCredentialInput.encryptedPayload` in both existing stores). This preserves the documented behaviour that "all linked brands share the same key material, so key rotation affects all account credentials atomically" per service.
- **No secret leakage on public types.** `OAuthAccount` has no `encryptedPayload` field; the store strips it for any non-internal consumer, exactly as `credentialFromRow` does for Google/Shopify. The model map's `secretLikeKeyPattern` redaction in `configSummary` is unaffected — account credentials never flow through `configSummary`.
- **Account isolation.** `getLinkForScope` constrains resolution to a single `(service, brandId, regionId, connectorSlug)` tuple; an account is reachable only through an explicit link row, so a brand cannot resolve another brand's account by guessing. The `UNIQUE` constraints prevent link/account spoofing via duplicate inserts.
- **Cascade integrity.** `deleteAccount` removes dependent links in the same transaction (FK + explicit delete) so revoking an account cannot orphan links that would otherwise dangle and silently resolve to a deleted account.
- **Status, not data, on reconnect.** Following the Shopify `handleUninstall` precedent, account revocation/uninstall flips `status` to `needs_reconnect` rather than deleting where downstream brand links must survive a temporary disconnect; `shop/redact`-style hard deletes remain the platform store's responsibility.

## Testing Strategy

`test/account-store.test.ts` (new), following the structure of `test/access-store.test.ts` and the OAuth store tests — fresh temp SQLite file per test, no network:

- **upsert idempotency / same id** — `upsertAccount({service:'shopify', externalAccountId:'org_1', ...})` twice returns the SAME id and leaves exactly one row (asserts `UNIQUE(service, external_account_id)` + `ON CONFLICT ... DO UPDATE ... RETURNING id` returns the existing row's id, not the freshly generated one). This is the test that fails if `INSERT OR REPLACE` or a returned `generatedId` is used.
- **upsert mutates in place** — second `upsertAccount` with a new `encryptedPayload`/`status` updates the row and advances `updated_at`; `created_at` is unchanged.
- **distinct services share an external id** — `('google','admin@x')` and `('shopify','admin@x')` coexist as two rows (uniqueness is per `(service, external_account_id)`, not `external_account_id` alone).
- **crypto round-trip** — encrypt an `OAuthAccountTokenPayload` with a 32-byte base64url key via `account-credentials/crypto.ts`, `upsertAccount`, `getAccount`, `decryptCredential`, assert `refreshToken`/`scope`/`externalAccountId` survive; assert `getAccount` callers can read `encryptedPayload` but `OAuthAccount`-shaped consumers never see it.
- **link fan-out** — one account, `linkAccount` three distinct `(brandId, regionId, connectorSlug)` tuples (e.g. `'shopify'`, `'google-analytics-4'`, `'google-search-console'`); `listLinksForAccount` returns 3; re-linking the same tuple upserts (still 3, returns the same link id, `updatedAt` advances).
- **scope reverse-lookup** — `getLinkForScope({service:'google', brandId, regionId, connectorSlug:'google-analytics-4'})` returns the link whose `accountId` points at the shared admin account; unknown scope returns `undefined`.
- **connection binding** — `setLinkConnectionId(linkId, 'devapi_haverford_au_google_analytics_4')` populates `connection_id` (underscore-normalized form per D4); subsequent `getLinkForScope` reflects it.
- **cascade delete** — link two tuples, `deleteAccount(id)`, assert account gone AND both links gone in one transaction (no orphans, no FK violation).
- **status transitions** — `updateAccountStatus(id, 'needs_reconnect', 'uninstalled')` sets status + `error_detail`; `updateAccountPayload` resets to `connected` and advances `last_refreshed_at`/`token_expiry_at` (mirrors `GatewayGoogleStore.updateCredentialPayload`).
- **migration idempotency** — running `runMigrations()` twice is a no-op (plain `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`); no `gateway_schema_migrations` row is written.

A small audit-union typecheck assertion lives in the test too: constructing an `AuditEvent`-shaped object with `action: 'oauth_account.created'` and `targetType: 'oauth_account'` must compile, proving the union edits in `src/admin/types.ts` are wired.

No changes to existing tests are required because no existing table or public type is mutated (the `AuditAction` / `AuditEvent.targetType` additions are purely additive to closed unions and break no existing exhaustive switch — verified no `assertNever`-style exhaustive consumer over these unions exists for the new members).

## Verification Gate

- `npm run typecheck` clean (including the additive `AuditAction` / `AuditEvent.targetType` members in `src/admin/types.ts`)
- `npm run build` clean
- full `npm test` green (including the new `test/account-store.test.ts`)
- new tables created idempotently (running `runMigrations()` twice is a no-op); `foreign_keys = ON` enforced; NO `gateway_schema_migrations` interaction
- `upsertAccount` returns the existing row's id on the second call for the same `(service, external_account_id)` (asserts `ON CONFLICT ... DO UPDATE ... RETURNING id`, NOT `INSERT OR REPLACE`)
- `GatewayAccountStore` constructed unconditionally in `src/index.ts` on `config.gatewayStorePath`, mirroring `appInstallStore` (index.ts:52)
- no plaintext token persisted in `gateway_oauth_accounts` (asserted by the crypto round-trip test reading the raw `encrypted_payload` column and confirming it does not contain the cleartext refresh token substring)
