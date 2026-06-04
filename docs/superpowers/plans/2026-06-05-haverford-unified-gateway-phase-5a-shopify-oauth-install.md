# Phase 5a — Shopify OAuth Install — Implementation Plan

**Spec:** `docs/superpowers/specs/2026-06-05-haverford-unified-gateway-phase-5a-shopify-oauth-install-design.md`
**Issue:** [#23](https://github.com/leebaroneau/template-gateway/issues/23) · **Epic:** [#19](https://github.com/leebaroneau/template-gateway/issues/19)
**Branch:** `story/23-phase-5a-shopify-oauth`

Execute with TDD: write the failing test(s) first, then the implementation, then run `npm test` for the touched area. Commit per task. Mirror the Phase 4 `src/google-oauth/` module conventions exactly (ESM `.js` import suffixes, named-param better-sqlite3 binding, ISO timestamps, snake_case columns → camelCase row mappers). Do NOT introduce new npm dependencies — `node:crypto` + global `fetch` only.

Reference port source for HMAC/shop/token-exchange logic: `haverford-brands/00_repos/services/service-Haverford-Dev-API/lib/shopify-auth.ts` (copy the pure functions, strip `server-only`/`@/` aliases).

---

## Task 1 — Shared token-crypto

**Goal:** Extract the generic AES-256-GCM crypto so both OAuth modules share it; keep Google green.

- Create `src/shared/token-crypto.ts`:
  - `export function encryptCredential<T>(payload: T, base64urlKey: string): string`
  - `export function decryptCredential<T>(encrypted: string, base64urlKey: string): T`
  - Same internals as `src/google-oauth/crypto.ts`: 12-byte random IV, AES-256-GCM, 16-byte tag, output `iv:tag:ciphertext` (all base64url); `decodeKey()` enforces exactly 32 bytes (throws `/Encryption key must be 32 bytes/`); malformed input throws `/Invalid encrypted/`; `JSON.stringify`/`JSON.parse` body.
- Rewrite `src/google-oauth/crypto.ts` to thin typed re-exports:
  - `export const encryptCredential = (p: GoogleTokenPayload, k: string) => sharedEncrypt(p, k);`
  - `export const decryptCredential = (e: string, k: string): GoogleTokenPayload => sharedDecrypt<GoogleTokenPayload>(e, k);`
- Tests: new `test/shared-token-crypto.test.ts` (roundtrip with a sample object, random-IV differs, wrong key throws, tampered ciphertext throws, malformed throws `/Invalid encrypted/`, short key throws `/Encryption key must be 32 bytes/`).
- **Acceptance:** new test green; **existing `test/google-oauth-crypto.test.ts` passes unchanged**; typecheck clean.

## Task 2 — `src/shopify-oauth/types.ts`

- `ShopifyCredentialStatus = 'connected' | 'needs_reconnect' | 'error'`.
- `ShopifyTokenPayload { accessToken: string; scope: string; shop: string }` (no refresh/expiry).
- `ShopifyOAuthCredential { id; shop; scope; status; createdAt; updatedAt; errorDetail? }` (no `encryptedPayload` here — that's the store row extension).
- `ShopifyOAuthState { state; shop; scopes: string[]; createdAt; expiresAt }`.
- `StartFlowInput { shop: string; scopes?: string[] }`; `StartFlowResult { redirectUrl: string; state: string }`.
- `CompleteFlowInput { code: string; state: string; shop: string; hmac: string; queryParams: Record<string, string> }`; `CompleteFlowResult { credential: ShopifyOAuthCredential }`.
- **Acceptance:** typecheck clean (a compile-smoke test is fine).

## Task 3 — `src/shopify-oauth/hmac.ts` (+ tests)

Port from Dev API `lib/shopify-auth.ts`:
- `normalizeShopDomain(input: string): string | null` — lowercase/trim; accept bare `*.myshopify.com` (anchored `^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$`) or strip a `https://.../` wrapper to that form; return null on reject.
- `verifyCallbackHmac(query: Record<string, string | string[]>, apiSecret: string): boolean` — drop `hmac` + `signature`, sort keys, join `k=v&...` (decoded), HMAC-SHA256 **hex**, length-guarded `timingSafeEqual` vs `query.hmac`.
- `verifyWebhookHmac(rawBody: Buffer, hmacHeader: string | undefined, apiSecret: string): boolean` — HMAC-SHA256 over raw bytes → **base64**, length-guarded `timingSafeEqual` vs header.
- Tests `test/shopify-oauth-hmac.test.ts`: compute a callback fixture with a known test secret → verify true; tamper a param / drop hmac → false. Webhook: raw body fixture → true; altered body or wrong header → false. `normalizeShopDomain`: `good.myshopify.com` ok; `evil.com`, `x.myshopify.com.evil.com`, `myshopify.com`, `https://good.myshopify.com/` (→ `good.myshopify.com`) handled correctly.
- **Acceptance:** tests green; timing-safe compares used (no `===` on digests).

## Task 4 — `src/shopify-oauth/crypto.ts` (+ test)

- Typed re-export of shared token-crypto for `ShopifyTokenPayload` (mirror Task 1's Google wrapper).
- Test `test/shopify-oauth-crypto.test.ts`: roundtrip a `ShopifyTokenPayload`; tamper/wrong-key/short-key throws.
- **Acceptance:** green.

## Task 5 — `src/shopify-oauth/store.ts` (+ tests)

- `GatewayShopifyStore(dbPath)` mirroring `GatewayGoogleStore`: ctor `mkdirSync` + `new Database` + `pragma foreign_keys=ON` + `runMigrations()`; `close()`.
- Tables (one `exec` migration): `gateway_shopify_oauth_states` (state PK, shop NOT NULL, scopes_json, created_at, expires_at); `gateway_shopify_credentials` (id PK, **shop NOT NULL UNIQUE**, encrypted_payload, scope, status, created_at, updated_at, error_detail).
- IDs via shared `generatedId('shopify_cred_')`; `timestamp()` ISO.
- Methods: `saveOAuthState/getOAuthState/deleteOAuthState/pruneExpiredStates`; `saveCredential` (INSERT OR REPLACE on `shop`, returns id), `getCredential(id)`, `getCredentialByShop(shop)`, `listCredentials()` (ORDER BY created_at, id), `updateCredentialStatus(idOrShop, status, errorDetail?)`, `deleteCredential(id)`, `deleteCredentialByShop(shop)`. `get/list` return rows **including** `encryptedPayload`.
- Tests `test/shopify-oauth-store.test.ts`: temp-dir lifecycle; states; credentials incl. **reinstall overwrite via UNIQUE(shop)**; getByShop; status update by shop; delete; survives reopen.
- **Acceptance:** green.

## Task 6 — `src/shopify-oauth/adapter.ts` (+ tests)

- `ShopifyOAuthConfig { apiKey; apiSecret; redirectUri; encryptionKey; scopes: string[] }` (exported here).
- `ShopifyOAuthAdapter(config, store)`; const `STATE_TTL_MINUTES = 10`.
- `startFlow({ shop, scopes? })`: `normalizeShopDomain` (throw on reject); random 24-byte base64url state; save state (scopes = input ?? config.scopes); build `https://{shop}/admin/oauth/authorize` URL (client_id, scope csv, redirect_uri, state; **no** grant_options[]); return `{ redirectUrl, state }`.
- `async completeFlow(input, fetchFn = fetch)`: `verifyCallbackHmac` → throw `Invalid HMAC`; prune; get+delete state; assert present, not expired, `state.shop === input.shop`; `exchangeCode`; verify each required scope present in returned `scope`; build payload; `encryptCredential`; `saveCredential('connected')`; return stripped `{ credential }`.
- `async getCredentialStatus(id)`: read + strip.
- `handleUninstall(shop)` → `updateCredentialStatus(shop,'needs_reconnect')`; `handleShopRedact(shop)` → `deleteCredentialByShop`.
- `private async exchangeCode(shop, code, fetchFn)`: POST form-urlencoded to `https://{shop}/admin/oauth/access_token`; on `!ok` throw `Token exchange failed: <status> <body≤512>`.
- Tests `test/shopify-oauth-adapter.test.ts` with `mockFetch` helper: startFlow URL/params + reject bad shop; completeFlow happy path (valid hmac fixture + mocked token response); rejects bad hmac; rejects missing/expired/mismatched-shop state; scope-missing path.
- **Acceptance:** green.

## Task 7 — `src/shopify-oauth/routes.ts` (+ tests)

- `createShopifyOAuthRouter({ config?, adapter?, store?, bearer })`.
- 501-when-unconfigured guard (every route). Webhook route uses `express.raw({ type: 'application/json' })` capturing the raw Buffer — must not be eaten by `express.json()`.
- Routes per the spec table: `GET /credentials`, `GET /credentials/:id`, `POST /install`, `GET /callback` (no bearer), `DELETE /credentials/:id`, `POST /webhooks` (no bearer, HMAC). `stripEncryptedPayload` on every credential response. Token never returned.
- Webhook topic switch: `app/uninstalled` → status `needs_reconnect`; `shop/redact` → delete; `customers/*` → 200 ack; unknown → 200 ack.
- Tests `test/shopify-oauth-routes.test.ts` (supertest): Bearer 401s; `/install` 200 + 400 bad shop; `/callback` success/`invalid_hmac`/`invalid_state` (stub global fetch); `/credentials` list/get/delete stripped+404; `/webhooks` valid HMAC 200 (+status flip / delete side-effects), bad HMAC 401; 501-not-configured suite over all routes.
- **Acceptance:** green.

## Task 8 — config + index wiring (+ config tests, final verify)

- `parseShopifyOAuthConfig(env)` all-or-nothing over the 5 `SHOPIFY_OAUTH_*` vars (`SCOPES` → comma list); add `shopifyOAuth?` to `GatewayConfig`; wire into `loadConfig`.
- `src/index.ts`: conditional `GatewayShopifyStore` + `ShopifyOAuthAdapter`; mount `/admin/shopify-oauth`.
- `test/config.test.ts`: add `Shopify OAuth config` describe (undefined unset / populated all-set / throws partial); delete `SHOPIFY_OAUTH_*` in `beforeEach`.
- **Acceptance:** `npm run typecheck` clean, `npm run build` clean, full `npm test` green (no regressions). Smoke: unconfigured app → 501 on `/admin/shopify-oauth/credentials`; configured app → `/install` returns a valid authorize URL, `/credentials` 401 without Bearer.

---

## Review (Codex)

After all tasks: Codex performs a two-stage review of the full diff — (1) **spec-compliance** against the design doc (nothing missing, nothing extra/over-built), then (2) **code-quality + security** (HMAC schemes correct and timing-safe; shop regex anchored; token never logged/returned; raw-body webhook parsing; 501 parity; no new deps; tests meaningful). Fix findings, re-run the gate, then report back for PR.
