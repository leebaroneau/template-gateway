# Phase 4 — Native Google OAuth Design

**Status:** implemented
**Issue:** [#21](https://github.com/leebaroneau/template-gateway/issues/21)
**Date:** 2026-06-05

## What was built

Phase 4 adds native Google OAuth credential storage and binding to the gateway.

### Modules

- `src/google-oauth/types.ts` — domain types: `GoogleProduct`, `GoogleOAuthCredential`, `GoogleConnectionBinding`, `GoogleOAuthState`
- `src/google-oauth/crypto.ts` — AES-256-GCM encrypt/decrypt for token payloads; key from `GOOGLE_OAUTH_ENCRYPTION_KEY` env var
- `src/google-oauth/store.ts` — `GatewayGoogleStore`: SQLite tables for credentials, bindings, and in-flight OAuth states on the same DB path as access/overlay stores
- `src/google-oauth/adapter.ts` — `GoogleOAuthAdapter`: `startFlow`, `completeFlow`, `refreshTokenIfNeeded`, `getCredentialStatus`
- `src/google-oauth/routes.ts` — Express router for `/admin/google-oauth/*`

### Routes

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/admin/google-oauth/credentials` | Bearer | List all Google credentials (no encrypted payload) |
| GET | `/admin/google-oauth/credentials/:id` | Bearer | Get one credential + bindings |
| POST | `/admin/google-oauth/start` | Bearer | Start OAuth flow; returns `redirectUrl` + `state` |
| GET | `/admin/google-oauth/callback` | state param | OAuth callback; exchanges code, stores credential, creates bindings |
| DELETE | `/admin/google-oauth/credentials/:id` | Bearer | Delete credential and all bindings |
| POST | `/admin/google-oauth/credentials/:id/refresh` | Bearer | Force token refresh |

### Supported Google Products

| Product | Scope |
|---|---|
| `ga4` | `https://www.googleapis.com/auth/analytics.readonly` |
| `gsc` | `https://www.googleapis.com/auth/webmasters.readonly` |
| `google_ads` | `https://www.googleapis.com/auth/adwords` |
| `merchant_center` | `https://www.googleapis.com/auth/content` |

### Env Vars

All optional. If `GOOGLE_OAUTH_CLIENT_ID` is set, all four must be set or startup throws.

| Var | Description |
|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` | Google OAuth app client ID |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Google OAuth app client secret |
| `GOOGLE_OAUTH_REDIRECT_URI` | Callback URL (must match Google Cloud Console) |
| `GOOGLE_OAUTH_ENCRYPTION_KEY` | Base64url-encoded 32-byte AES-256-GCM key |

Generate a key: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`

### Security properties

- Tokens encrypted with AES-256-GCM before SQLite storage; raw tokens never returned through any API or MCP response
- Callback validates `state` nonce (stored in DB, single-use, 10-minute TTL) to prevent CSRF
- Token refresh uses stored refresh token without exposing it through the API
- Routes return 501 when `GOOGLE_OAUTH_*` env vars are absent

### OAuth flow

1. Admin POSTs to `/admin/google-oauth/start` with `brandId`, `regionId`, `products[]`, `bindings[]`
2. Gateway saves a one-time state nonce (10-min TTL), returns Google authorization URL
3. Admin navigates to URL, grants consent
4. Google redirects to `/admin/google-oauth/callback?code=...&state=...`
5. Gateway validates + consumes state, exchanges code for tokens, stores encrypted credential, creates connection bindings
6. Token refresh runs automatically when expiry is within 5 minutes on any status check or explicit `/refresh` call
