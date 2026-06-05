# Haverford Unified Gateway — Phase 5b: App Catalog, Installs, API/MCP/Admin-UI — Design Spec

**Status:** approved for implementation
**Issue:** [#25](https://github.com/leebaroneau/template-gateway/issues/25)
**Epic:** [#19](https://github.com/leebaroneau/template-gateway/issues/19)
**Date:** 2026-06-05
**Branch:** `story/25-phase-5b-app-catalog-installs`

## Context

Phase 5a (#23) shipped real Shopify OAuth (offline token, AES-256-GCM at rest). Phase 5b builds the layer on top: an app/tool manifest concept, installs per brand/region/connection, read API + MCP surfaces, and a minimal admin-UI view.

Phase 5b does **not** call the Shopify Admin API or build any write automation — it models capability availability.

## Confirmed Decisions

- **Built-in catalog:** app manifests are code-defined (like `gatewayMcpTools`). `/data` stores installs + status only. No manifest CRUD API.
- **Surfaces:** HTTP API (`apps.read` / `apps.write` scopes) + MCP read tools + admin-UI apps view.
- **Auto-provision:** a dedicated `POST /api/v1/app-installs/provision` endpoint creates pending installs for all brand/region pairs that have a connected Shopify credential. Not wired into the OAuth flow directly.
- **No real Shopify Admin API reads, billing, or app-store listing.**

## Module Layout

```
src/apps/types.ts              # GatewayAppManifest, GatewayAppInstall, status types
src/apps/catalog.ts            # built-in manifest(s); HAVERFORD_STOREFRONT_APP constant
src/apps/store.ts              # GatewayAppInstallStore (better-sqlite3)
src/apps/routes.ts             # createAppRouter (API routes under /api/v1/apps + /app-installs)
src/access/types.ts            # + "apps.read" | "apps.write" to GatewayApiScope
src/mcp-v1/tools.ts            # + gateway_list_apps, gateway_list_app_installs
src/mcp-v1/routes.ts           # wire the two new tools
src/admin/page.ts              # + "Apps" nav button (data-view="apps")
src/admin/client-script.ts     # + renderAppsView() with catalog + install cards
src/index.ts                   # + GatewayAppInstallStore instantiation + mount /api/v1/apps
```

## App Manifest (built-in)

```typescript
export interface GatewayAppManifest {
  slug: string;
  name: string;
  description: string;
  requiredConnectors: string[];  // connector slugs (e.g. "shopify")
  tools: Array<{
    slug: string;
    name: string;
    mode: "read" | "write";
  }>;
}

export const HAVERFORD_STOREFRONT_APP: GatewayAppManifest = {
  slug: "haverford-storefront",
  name: "Haverford Storefront",
  description: "Storefront intelligence for a Haverford brand region powered by a connected Shopify store.",
  requiredConnectors: ["shopify"],
  tools: [
    { slug: "storefront_overview", name: "Storefront Overview", mode: "read" },
    { slug: "product_health", name: "Product Health", mode: "read" },
    { slug: "order_summary", name: "Order Summary", mode: "read" },
  ],
};

export const BUILT_IN_APPS: GatewayAppManifest[] = [HAVERFORD_STOREFRONT_APP];
```

## App Install

```typescript
export type GatewayAppInstallStatus = "pending" | "enabled" | "disabled" | "error";

export interface GatewayAppInstall {
  id: string;                        // "appinstall_<ts>_<hex>"
  appSlug: string;
  brandId: string;
  regionId: string;
  connectionId?: string;             // the Shopify credential id (from shopify-oauth)
  status: GatewayAppInstallStatus;
  createdAt: string;
  updatedAt: string;
  errorDetail?: string;
}
```

## Persistence — `GatewayAppInstallStore`

Same `gatewayStorePath` sqlite file; tables prefixed `gateway_app_*`. Mirror `GatewayGoogleStore` ctor/migrations conventions.

### `gateway_app_installs`
`id` PK, `app_slug`, `brand_id`, `region_id`, `connection_id` (nullable), `status`, `created_at`, `updated_at`, `error_detail` (nullable).
`UNIQUE(app_slug, brand_id, region_id)` — one install per app per brand/region.

Methods:
- `createInstall(input): GatewayAppInstall` — INSERT OR REPLACE
- `getInstall(id): GatewayAppInstall | undefined`
- `getInstallByKey(appSlug, brandId, regionId): GatewayAppInstall | undefined`
- `listInstalls(filter?: { appSlug?, brandId?, regionId?, status? }): GatewayAppInstall[]`
- `updateInstallStatus(id, status, errorDetail?): void`
- `deleteInstall(id): void`

## Access Scopes

Add `"apps.read"` and `"apps.write"` to `gatewayApiScopes` in `src/access/types.ts`.
`apps.read` is implied by `apps.write` (add to `scopeAllowed` like `api_clients`).

## HTTP API Routes

Mount at `/api/v1` — new sub-router for apps, mounted from `createGatewayApiRouter`.

| Method | Path | Scope | Response |
| --- | --- | --- | --- |
| GET | `/api/v1/apps` | `apps.read` | `{ apps: GatewayAppManifest[] }` |
| GET | `/api/v1/app-installs` | `apps.read` | `{ installs: GatewayAppInstall[] }` (filter: `appSlug`, `brandId`, `regionId`, `status`) |
| GET | `/api/v1/app-installs/:id` | `apps.read` | `{ install: GatewayAppInstall }` or 404 |
| POST | `/api/v1/app-installs` | `apps.write` | create: body `{ appSlug, brandId, regionId, connectionId? }` → 201 `{ install }` |
| PATCH | `/api/v1/app-installs/:id/status` | `apps.write` | body `{ status, errorDetail? }` → 200 `{ install }` or 404 |
| POST | `/api/v1/app-installs/provision` | `apps.write` | auto-provision pending installs for all connected Shopify credentials; body `{}` → 200 `{ provisioned: number, installs: GatewayAppInstall[] }` |

The provision endpoint reads `GatewayShopifyStore.listCredentials()` filtered to `status === 'connected'`, then for each credential's `shop` looks up matching brand/region (from `GatewayState.connections` where `connectorId === 'connector_shopify'` and `configSummary.shop_domain === shop`), and calls `createInstall(INSERT OR REPLACE)` for `haverford-storefront` app.

## MCP Tools

Add to `src/mcp-v1/tools.ts`:

```typescript
{
  name: "gateway_list_apps",
  description: "List available Haverford Gateway apps and their required connectors.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false }
},
{
  name: "gateway_list_app_installs",
  description: "List Haverford Gateway app installs, optionally filtered.",
  inputSchema: {
    type: "object",
    properties: {
      appSlug: { type: "string" },
      brandId: { type: "string" },
      regionId: { type: "string" },
      status: { type: "string", enum: ["pending","enabled","disabled","error"] }
    },
    additionalProperties: false
  }
}
```

Required scope: `apps.read` for both tools (same pattern as `connections.read`).
Implementation in `callGatewayMcpTool`: `gateway_list_apps` returns `BUILT_IN_APPS`; `gateway_list_app_installs` queries `GatewayAppInstallStore`.

The MCP router options need `appInstallStore?: GatewayAppInstallStore` added so the tool handler can query it.

## Admin-UI — "Apps" View

`src/admin/page.ts`: add `<button class="nav-link" type="button" data-view="apps">Apps</button>` after the Audit button.

`src/admin/client-script.ts`: add a `renderAppsView(state, installs)` function that renders:
- A heading "Apps"
- For each built-in app: a card showing `name`, `description`, `requiredConnectors`, and the list of tools.
- Below each app card: the list of installs for that app with `brandId`, `regionId`, `status` badge, and a "Connect Shopify" button (links to `POST /install` Shopify OAuth flow for the correct brand/region) when status is `pending` or `needs_reconnect`.

The client script fetches installs from `GET /api/v1/app-installs` (using the existing bearer-auth pattern). App manifests are embedded as a constant in the client script (copy of the catalog, since it's built-in — no separate API call needed; use the `GET /api/v1/apps` endpoint).

## `src/index.ts` wiring

```typescript
import { GatewayAppInstallStore } from "./apps/store.js";
// ...
const appInstallStore = new GatewayAppInstallStore(config.gatewayStorePath);
// Pass to API router:
app.use("/api/v1", createGatewayApiRouter({ backend: adminBackend, accessStore, appInstallStore, shopifyStore }));
// Pass to MCP router:
app.use("/mcp/v1", createGatewayMcpV1Router({ ..., appInstallStore }));
```

`GatewayAppInstallStore` is always instantiated (no feature flag — app installs are a core data type).

## Testing Strategy

- `test/apps-store.test.ts` — temp-dir lifecycle; createInstall; getByKey; listInstalls with filters; UNIQUE(app_slug,brand_id,region_id) upsert; updateStatus; delete.
- `test/apps-api-routes.test.ts` — supertest: GET /apps list; GET /app-installs list + filter; GET /app-installs/:id; POST (create); PATCH status; POST provision (with mocked shopifyStore listCredentials + gateway state connections).
- `test/mcp-v1-tools.test.ts` additions — `gateway_list_apps` returns BUILT_IN_APPS; `gateway_list_app_installs` queries store.
- `test/config.test.ts` — verify `apps.read` and `apps.write` are in `gatewayApiScopes`.

## Verification Gate

`npm run typecheck` clean, `npm run build` clean, full `npm test` green (no regressions).
