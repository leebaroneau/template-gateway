# Haverford Unified Gateway — Phase 5a: Shopify OAuth Install — Design Spec

**Status:** approved for implementation
**Issue:** [#23](https://github.com/leebaroneau/template-gateway/issues/23)
**Epic:** [#19](https://github.com/leebaroneau/template-gateway/issues/19)
**Date:** 2026-06-05
**Repo:** `leebaroneau/template-gateway`
**Branch:** `story/23-phase-5a-shopify-oauth`

## Context

Phase 5 of the backend transition is the Shopify app layer. Lee chose **real Shopify public-app OAuth** (not a model-only prototype) and chose to **split** Phase 5:

- **5a (this spec):** real Shopify public-app OAuth install + encrypted per-shop offline token store + reconnect/status + webhook HMAC handling.
- **5b (next):** app manifest/catalog model, app installs per brand/region/connection, auto-provisioning, and the `apps.*` API/MCP read surfaces + admin-UI dashboard shell.

5a is a pure backend OAuth/credential module. It mirrors the Phase 4 `src/google-oauth/` module 1:1 in structure.

## Confirmed Decisions

- **App type:** Shopify Public/Partner app, authorization-code grant.
- **Token mode:** **Offline** access token (omit `grant_options[]`). Non-expiring, tied to the shop, not a user. No refresh logic.
- **Natural key:** `shop` (`*.myshopify.com` domain). One credential per shop; `UNIQUE(shop)`; reinstall does `INSERT OR REPLACE` (overwrite).
- **Crypto:** Extract a generic `src/shared/token-crypto.ts` (AES-256-GCM). Both `google-oauth` and `shopify-oauth` import it. Google's existing `crypto.ts` becomes a thin typed re-export so existing Google tests stay green unchanged.
- **Surfaces (5a):** `/admin/shopify-oauth/*` only. No MCP tools, no Connection-record writes, no admin UI (all 5b).
- **Config:** all-or-nothing parse of `SHOPIFY_OAUTH_*`; routes `501 not_configured` when unset (mirrors Google).
- **Reuse over reinvent:** port the dependency-free helpers from Dev API `lib/shopify-auth.ts` (shop normalization, callback HMAC, webhook HMAC, token exchange) — pure `node:crypto` + `fetch`, no SDK.

## Out of Scope (→ 5b or later)

- App manifest/catalog model and app installs per brand/region.
- Auto-provisioning pending installs from Shopify connection availability.
- MCP `apps.*` read tools; `apps.read`/`apps.write` API scopes.
- Admin-UI dashboard shell / connect buttons.
- Writing/binding to the existing `connector_shopify` `Connection` records in `GatewayState`.
- Online (per-user) tokens; expiring offline tokens + refresh rotation.
- Calling the Shopify Admin API with the stored token (no data reads in 5a).

## Module Layout

Mirror `src/google-oauth/`:

```
src/shared/token-crypto.ts        # generic AES-256-GCM encrypt/decrypt<T>
src/shopify-oauth/types.ts        # domain types
src/shopify-oauth/crypto.ts       # typed re-export of shared token-crypto for ShopifyTokenPayload
src/shopify-oauth/hmac.ts         # verifyCallbackHmac (hex) + verifyWebhookHmac (base64) + normalizeShopDomain
src/shopify-oauth/store.ts        # GatewayShopifyStore (better-sqlite3, prefixed tables)
src/shopify-oauth/adapter.ts      # ShopifyOAuthConfig + ShopifyOAuthAdapter
src/shopify-oauth/routes.ts       # createShopifyOAuthRouter (501-guard, Bearer, callback, webhooks)
src/config.ts                     # + parseShopifyOAuthConfig, shopifyOAuth on GatewayConfig
src/index.ts                      # conditional instantiate + mount /admin/shopify-oauth
```

## Shopify OAuth Flow (canonical, from shopify.dev)

### Authorize URL (start)
`GET https://{shop}/admin/oauth/authorize?client_id={apiKey}&scope={csvScopes}&redirect_uri={redirectUri}&state={nonce}`
- **Omit `grant_options[]`** → offline token.
- `shop` validated first (see below).
- `state` = crypto-random nonce, persisted (single-use), TTL (10 min, mirrors Google `STATE_TTL_MINUTES`).
- `redirect_uri` must be the gateway callback URL, pre-registered in the Shopify Dev Dashboard allow-list.

### Callback verification (order matters)
1. Validate `shop` query param against the anchored regex.
2. **Verify query-param HMAC** (see HMAC section) — proves Shopify origin; do this before trusting anything.
3. Look up the stored OAuth state; delete it (single-use); assert it exists, is not expired, and `state.shop === query.shop`.
4. Exchange `code` for a token.
5. Re-read the returned `scope`; confirm required scopes present.
6. Encrypt and store the token; status `connected`.

### Token exchange
`POST https://{shop}/admin/oauth/access_token`
Headers: `Content-Type: application/x-www-form-urlencoded`, `Accept: application/json`
Body (form-encoded): `client_id={apiKey}`, `client_secret={apiSecret}`, `code={code}`
Response (offline, non-expiring): `{ "access_token": "...", "scope": "read_products,read_orders" }`
No `expires_in`, no `refresh_token`.

### Shop validation (open-redirect/SSRF defense)
Anchored both ends:
```
/^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/
```
Reject anything not matching before constructing any URL or host header from `shop`. (Dev API `normalizeShopDomain` is the port source.)

## HMAC Verification — two distinct schemes

**These must not be conflated.** Both use the app **client secret** (`SHOPIFY_OAUTH_API_SECRET`) as the key and a timing-safe compare (`crypto.timingSafeEqual`, length-guarded).

### Callback query-param HMAC (`hmac` query param)
1. Take all query params; **remove `hmac` (and defensively `signature`)**.
2. Sort remaining keys alphabetically.
3. Join as `key=value` pairs with `&` (decoded values).
4. `HMAC-SHA256` **hex** digest with client secret.
5. Timing-safe compare to received `hmac`.

### Webhook body HMAC (`X-Shopify-Hmac-Sha256` header)
1. Use the **raw request body bytes** (Buffer) — never parsed/re-serialized JSON.
2. `HMAC-SHA256` over raw body with client secret → **base64**.
3. Timing-safe compare to the header.
- The webhook route must use `express.raw({ type: 'application/json' })` (or a `verify` hook capturing `req.rawBody`), NOT the router-level `express.json()`.

## Webhooks (5a includes lifecycle + compliance)

`POST /admin/shopify-oauth/webhooks` (no Bearer; HMAC-gated). On invalid HMAC → `401`. On valid HMAC, switch on `X-Shopify-Topic`:

- `app/uninstalled` → token already revoked by Shopify; mark the shop credential `needs_reconnect` (do not call the Admin API). Respond `200`.
- `shop/redact` → delete the shop credential (it is the only shop data the gateway stores). Respond `200`.
- `customers/data_request`, `customers/redact` → the gateway stores no customer PII; audit-log and respond `200`.
- Unknown topic with valid HMAC → `200` (ack), audit.

Respond `2xx` fast (Shopify 5s timeout). Read `X-Shopify-Topic`, `X-Shopify-Shop-Domain`, `X-Shopify-Webhook-Id` (for dedup/idempotency notes). Mandatory compliance topics are declared app-specifically in `shopify.app.toml` at deploy time (operational, not code) — the gateway only needs the verified endpoint to respond correctly.

## Persistence — `GatewayShopifyStore`

Same `gatewayStorePath` sqlite file as the other stores; tables prefixed `gateway_shopify_*`. `foreign_keys = ON`. All columns TEXT; ISO-8601 timestamps; `*_json` for arrays. Mirror `GatewayGoogleStore` ctor/migrations/id-gen/row-mapper conventions.

### `gateway_shopify_oauth_states`
`state` PK, `shop` NOT NULL, `scopes_json`, `created_at`, `expires_at`.
Methods: `saveOAuthState`, `getOAuthState`, `deleteOAuthState`, `pruneExpiredStates`.

### `gateway_shopify_credentials`
`id` PK (`shopify_cred_<ts>_<hex>`), `shop` NOT NULL **`UNIQUE`**, `encrypted_payload`, `scope`, `status` (`connected|needs_reconnect|error`), `created_at`, `updated_at`, `error_detail` (nullable).
**No** `token_expiry_at` / `last_refreshed_at` columns (offline token never expires).
Methods: `saveCredential` (INSERT OR REPLACE keyed by `shop`, returns id), `getCredential(id)`, `getCredentialByShop(shop)`, `listCredentials()`, `updateCredentialStatus(id|shop, status, errorDetail?)`, `deleteCredential(id)`, `deleteCredentialByShop(shop)`.
`get*`/`list*` return the row **including** `encryptedPayload` (stripping happens in routes), mirroring Google.

No bindings table in 5a (Shopify binds at shop level; per-resource binding is a 5b concern).

## Adapter — `ShopifyOAuthAdapter`

`ShopifyOAuthConfig { apiKey; apiSecret; redirectUri; encryptionKey; scopes: string[] }` (defined in `adapter.ts`, imported by `config.ts`).
`constructor(config, store)`.
Constants: `STATE_TTL_MINUTES = 10`. Per-shop URLs built from validated `shop`.

- `startFlow(input: { shop; scopes? }): StartFlowResult` — validate shop; `crypto.randomBytes(24).toString('base64url')` state; save `ShopifyOAuthState`; build authorize URL (scopes default to `config.scopes`); return `{ redirectUrl, state }`. Synchronous.
- `completeFlow(input: CompleteFlowInput, fetchFn = fetch): Promise<CompleteFlowResult>` — verify callback HMAC → throw `Invalid HMAC` if false; prune; get+delete state; assert not expired and `state.shop === input.shop`; `exchangeCode`; verify scopes; build `ShopifyTokenPayload { accessToken, scope, shop }`; encrypt; `saveCredential(status:'connected')`; return `{ credential }` (stripped).
- `getCredentialStatus(id, ...)`: plain read + strip (no refresh).
- `handleUninstall(shop)` / `handleShopRedact(shop)`: status/delete helpers used by the webhook route.
- `private exchangeCode(shop, code, fetchFn)`: POST form-urlencoded to per-shop token URL; throw `Token exchange failed: <status> <text>` (truncate body to 512 chars, per the Phase 4 review fix) on `!ok`.

`fetchFn: typeof fetch = fetch` is the last param on every network method (the test seam), mirroring Google.

`CompleteFlowInput` carries `{ code; state; shop; hmac; queryParams: Record<string,string> }` so the adapter can verify the HMAC over the full received query set.

## Routes — `createShopifyOAuthRouter`

Options: `{ config?: ShopifyOAuthConfig; adapter?: ShopifyOAuthAdapter; store?: GatewayShopifyStore; bearer: string }`.
- `router.use(express.json())`, then the **501-when-unconfigured** guard (if `!config || !adapter || !store` → all routes `501 { error:'not_configured' }`), mirroring Google.
- The webhook route is registered with its own `express.raw({ type: 'application/json' })` so it does NOT consume the JSON parser — register it before/around the json middleware appropriately.
- `requireBearer` middleware (`Authorization !== 'Bearer ' + bearer` → 401) on protected routes.

| Method | Path | Auth | Behavior |
| --- | --- | --- | --- |
| GET | `/credentials` | Bearer | `200 { credentials: [...stripped] }` |
| GET | `/credentials/:id` | Bearer | `404 not_found` or `200 { credential }` (stripped) |
| POST | `/install` | Bearer | validate `shop` (`400 invalid_input` if bad/missing); `200 { redirectUrl, state }` |
| GET | `/callback` | none | read `shop,code,state,hmac` + full query; `400 invalid_request` if core params missing; `adapter.completeFlow`; on `Invalid HMAC` → `400 invalid_hmac`; on invalid/expired state → `400 invalid_state`; other errors → `502 upstream_error`; success `200 { credential }` (stripped) |
| DELETE | `/credentials/:id` | Bearer | `404` or `200 { deleted:true, id }` |
| POST | `/webhooks` | none (HMAC) | raw body; `verifyWebhookHmac` → `401` on mismatch; else topic switch; `200` |

`stripEncryptedPayload(cred)` removes `encryptedPayload` before any response. The raw access token is NEVER returned by any route.

## Config — `parseShopifyOAuthConfig`

All-or-nothing over: `SHOPIFY_OAUTH_API_KEY`, `SHOPIFY_OAUTH_API_SECRET`, `SHOPIFY_OAUTH_REDIRECT_URI`, `SHOPIFY_OAUTH_ENCRYPTION_KEY`, `SHOPIFY_OAUTH_SCOPES` (comma list → `string[]`).
- none set → `undefined` (feature off).
- any set → require all five; throw `Missing required env var: SHOPIFY_OAUTH_... (required when SHOPIFY_OAUTH_API_KEY is set)`.
Add `shopifyOAuth?: ShopifyOAuthConfig` to `GatewayConfig` (import type from `./shopify-oauth/adapter.js`); `shopifyOAuth: parseShopifyOAuthConfig(env)` in `loadConfig`.

## index.ts wiring

```ts
const shopifyStore = config.shopifyOAuth ? new GatewayShopifyStore(config.gatewayStorePath) : undefined;
const shopifyAdapter = config.shopifyOAuth && shopifyStore
  ? new ShopifyOAuthAdapter(config.shopifyOAuth, shopifyStore) : undefined;
app.use("/admin/shopify-oauth", createShopifyOAuthRouter({
  config: config.shopifyOAuth,
  adapter: shopifyAdapter,
  store: config.shopifyOAuth ? shopifyStore : undefined,
  bearer: config.gatewayBearer,
}));
```
Router always mounted; self-degrades to 501 when unconfigured. Conditional store instantiation (Phase 4 review fix — don't create tables when the feature is off).

## Security Requirements (must all hold)

- Client secret (`SHOPIFY_OAUTH_API_SECRET`) stays server-side; it is the HMAC key and token-exchange credential.
- Access tokens encrypted at rest (AES-256-GCM, 32-byte key); never logged, never returned in any response/audit.
- Timing-safe compares for both HMAC schemes; length-guard `timingSafeEqual`.
- Shop regex anchored both ends; reject before building any URL/host.
- OAuth state single-use + TTL + `state.shop` match (CSRF).
- Scope re-check after exchange (user can tamper the authorize URL scope).
- Webhook verified before reading payload; `401` on mismatch; never act on unverified body.
- Upstream error bodies truncated (≤512 chars) before storing/throwing.

## Testing Strategy (vitest + supertest)

- `shared-token-crypto.test.ts` — roundtrip, random IV, wrong key throws, tamper throws, malformed throws, short-key throws; generic over a sample payload. (Google's existing crypto tests must still pass.)
- `shopify-oauth-hmac.test.ts` — **known-good vectors**: callback hex HMAC (compute a fixture with a test secret and assert verify true; tamper → false; missing hmac → false); webhook base64 HMAC (raw body fixture; valid → true, altered body/header → false); `normalizeShopDomain` accept/reject cases (good shop, lookalike `evil.com`, trailing/embedded tricks).
- `shopify-oauth-store.test.ts` — temp-dir sqlite lifecycle; states save/get/delete/prune; credentials save/get/getByShop/list/updateStatus/delete; **UNIQUE(shop) reinstall overwrite**; survives close+reopen.
- `shopify-oauth-adapter.test.ts` — `startFlow` URL params + shop validation reject; `completeFlow` happy path with `mockFetch` returning `{access_token,scope}` and a valid hmac in `queryParams`; rejects bad HMAC; rejects missing/expired/shop-mismatched state; scope-missing handling.
- `shopify-oauth-routes.test.ts` — Bearer 401s; `/install` 200 + 400 invalid shop; `/callback` success / `invalid_hmac` / `invalid_state`; `/credentials` list/get/delete (stripped, 404); **`/webhooks`**: valid `X-Shopify-Hmac-Sha256` raw body → 200 (and `app/uninstalled` flips status, `shop/redact` deletes), bad header → 401; **501-not-configured** suite iterating every route.
- `config.test.ts` — add a `Shopify OAuth config` describe: undefined when unset, populated when all five set, throws on partial; delete `SHOPIFY_OAUTH_*` in `beforeEach`.

## Verification Gate

`npm run typecheck` clean, `npm run build` clean, full `npm test` green (no regressions in the existing Google/MCP/admin suites).

## Sources

- https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/authorization-code-grant
- https://shopify.dev/docs/apps/build/webhooks/subscribe/https
- https://shopify.dev/docs/apps/build/privacy-law-compliance
- Dev API port source: `haverford-brands/00_repos/services/service-Haverford-Dev-API/lib/shopify-auth.ts`
- In-repo pattern: `src/google-oauth/*` (Phase 4)
