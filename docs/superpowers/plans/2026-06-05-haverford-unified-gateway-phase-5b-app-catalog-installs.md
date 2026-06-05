# Phase 5b — App Catalog, Installs, API/MCP/Admin-UI — Implementation Plan

**Spec:** `docs/superpowers/specs/2026-06-05-haverford-unified-gateway-phase-5b-app-catalog-installs-design.md`
**Issue:** [#25](https://github.com/leebaroneau/template-gateway/issues/25) · **Epic:** [#19](https://github.com/leebaroneau/template-gateway/issues/19)
**Branch:** `story/25-phase-5b-app-catalog-installs`

Execute with TDD (failing test first → implement → run tests → commit per task). Mirror existing conventions: ESM `.js` import suffixes, better-sqlite3 named params, ISO timestamps, snake_case columns → camelCase mappers. No new npm deps.

**IMPORTANT — git sandbox:** Use `codex exec -s danger-full-access` for all tasks. The `workspace-write` sandbox blocks `.git/index.lock` writes; `danger-full-access` does not.

---

## Task 1 — `src/apps/types.ts` + `src/apps/catalog.ts`

Read `src/google-oauth/types.ts` for style. No runtime tests needed beyond typecheck.

Create `src/apps/types.ts`:
```typescript
export type GatewayAppInstallStatus = "pending" | "enabled" | "disabled" | "error";

export interface GatewayAppManifest {
  slug: string;
  name: string;
  description: string;
  requiredConnectors: string[];
  tools: Array<{ slug: string; name: string; mode: "read" | "write" }>;
}

export interface GatewayAppInstall {
  id: string;
  appSlug: string;
  brandId: string;
  regionId: string;
  connectionId?: string;
  status: GatewayAppInstallStatus;
  createdAt: string;
  updatedAt: string;
  errorDetail?: string;
}

export interface CreateAppInstallInput {
  appSlug: string;
  brandId: string;
  regionId: string;
  connectionId?: string;
  status?: GatewayAppInstallStatus;
}
```

Create `src/apps/catalog.ts`:
```typescript
import type { GatewayAppManifest } from "./types.js";

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

Run `npm run typecheck`. Commit: `feat(apps): Task 1 — app types + built-in catalog`.

## Task 2 — `src/apps/store.ts` + `test/apps-store.test.ts`

Mirror `src/google-oauth/store.ts` exactly (ctor, `foreign_keys=ON`, `runMigrations`, `close`, `generatedId`, `timestamp`).

Table `gateway_app_installs`:
```sql
CREATE TABLE IF NOT EXISTS gateway_app_installs (
  id TEXT PRIMARY KEY NOT NULL,
  app_slug TEXT NOT NULL,
  brand_id TEXT NOT NULL,
  region_id TEXT NOT NULL,
  connection_id TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  error_detail TEXT,
  UNIQUE(app_slug, brand_id, region_id)
);
```

ID prefix: `appinstall_`.

Methods: `createInstall(input): GatewayAppInstall` (INSERT OR REPLACE), `getInstall(id)`, `getInstallByKey(appSlug, brandId, regionId)`, `listInstalls(filter?)` (ORDER BY created_at, id), `updateInstallStatus(id, status, errorDetail?)`, `deleteInstall(id)`.

Test coverage: create/get/getByKey/list/filter-by-status/upsert-on-same-key/updateStatus/delete/close+reopen.

Run `npm test -- test/apps-store.test.ts`. Commit: `feat(apps): Task 2 — GatewayAppInstallStore + tests`.

## Task 3 — `src/access/types.ts` — add `apps.read` + `apps.write`

Add `"apps.read"` and `"apps.write"` to `gatewayApiScopes`. Add `apps.read` implied-by-`apps.write` case in `scopeAllowed`. Update the `test/config.test.ts` test that checks the scope list (or add a new assertion).

Run `npm run typecheck && npm test -- test/config.test.ts`. Commit: `feat(apps): Task 3 — apps.read + apps.write scopes`.

## Task 4 — HTTP API routes for apps + tests

Create `src/apps/api-routes.ts` — a sub-router factory:

```typescript
export function createAppApiRouter(options: {
  appInstallStore: GatewayAppInstallStore;
  shopifyStore?: GatewayShopifyStore;
  backend: GatewayConnectionBackend;
  accessStore: GatewayAccessStore;
}): express.Router
```

Routes (mirror `src/api/routes.ts` auth/audit/usage patterns with `apps.read`/`apps.write` scopes):

- `GET /apps` → `apps.read` → `{ apps: BUILT_IN_APPS }`
- `GET /app-installs` → `apps.read` → `{ installs }` (filter query params: `appSlug`, `brandId`, `regionId`, `status`)
- `GET /app-installs/:id` → `apps.read` → `{ install }` or 404
- `POST /app-installs` → `apps.write` → validate body `{ appSlug, brandId, regionId, connectionId? }`, reject unknown appSlug → 201 `{ install }`
- `PATCH /app-installs/:id/status` → `apps.write` → validate `{ status, errorDetail? }` → 200 `{ install }` or 404
- `POST /app-installs/provision` → `apps.write` → read shopifyStore.listCredentials() filtered to status=connected; for each find matching connection in GatewayState by `connectorId === 'connector_shopify'` + `configSummary.shop_domain === credential.shop`; call `createInstall({appSlug:'haverford-storefront', brandId, regionId, connectionId: credential.id, status:'pending'})`; return `{ provisioned, installs }`

Mount in `src/api/routes.ts`: add `appInstallStore` and `shopifyStore` to `CreateGatewayApiRouterOptions`; `router.use(createAppApiRouter(...))`.

Test `test/apps-api-routes.test.ts` (supertest): all routes including provision with a mock shopifyStore + gateway state.

Run `npm test -- test/apps-api-routes.test.ts`. Commit: `feat(apps): Task 4 — app API routes + tests`.

## Task 5 — MCP tools + tests

In `src/mcp-v1/tools.ts`: add `gateway_list_apps` and `gateway_list_app_installs` tool definitions. Add `apps.read` scope for both in `toolScopes`. Add handler cases in `callGatewayMcpTool` — but note: `callGatewayMcpTool` currently takes `GatewayState`; it needs `GatewayAppInstallStore` too. Add it as an optional 4th param:

```typescript
export async function callGatewayMcpTool(
  name: string,
  args: unknown,
  state: GatewayState,
  appInstallStore?: GatewayAppInstallStore
): Promise<GatewayMcpToolResult>
```

`gateway_list_apps`: returns `toolSuccess({ apps: BUILT_IN_APPS }, countText("app", BUILT_IN_APPS.length))`.
`gateway_list_app_installs`: queries `appInstallStore?.listInstalls(parsedArgs)` with optional `appSlug`/`brandId`/`regionId`/`status` filters.

Update `src/mcp-v1/routes.ts` to accept `appInstallStore` in options and pass it to `callGatewayMcpTool`.

Update `test/mcp-v1-routes.test.ts` to pass an `appInstallStore` (temp-dir store) and assert `gateway_list_apps` returns the manifest, `gateway_list_app_installs` returns installs.

Run `npm test -- test/mcp-v1-routes.test.ts`. Commit: `feat(apps): Task 5 — MCP gateway_list_apps + gateway_list_app_installs`.

## Task 6 — Admin-UI apps view

`src/admin/page.ts`: add `<button class="nav-link" type="button" data-view="apps">Apps</button>` after the Audit button.

`src/admin/client-script.ts`: add `renderAppsView()` function. Read the existing view render functions (e.g. `renderOverviewView`, `renderBrandsView`) to match the pattern. The function should:
1. Render a heading and table/list for installs fetched from `GET /api/v1/app-installs`.
2. For each built-in app, show a section with manifest details + install cards per brand/region.
3. Include a "Connect Shopify" button per install when status is `pending` that POSTs to `/admin/shopify-oauth/install`.
4. Wire into the nav click handler (the `data-view="apps"` case in the switch).

No new test file needed for UI (no supertest for the rendered HTML). Run `npm run typecheck` and `npm run build` to verify no compile errors.

Commit: `feat(apps): Task 6 — admin-UI apps view`.

## Task 7 — `src/index.ts` wiring + final gate

- Import `GatewayAppInstallStore` from `./apps/store.js`.
- Instantiate: `const appInstallStore = new GatewayAppInstallStore(config.gatewayStorePath);` (always — no feature flag).
- Pass to `createGatewayApiRouter`: add `appInstallStore` and `shopifyStore` to the options.
- Pass to `createGatewayMcpV1Router`: add `appInstallStore` to the options.
- Run gate: `npm run typecheck`, `npm run build`, full `npm test` (no regressions, all new tests green).
- Verify `git diff package.json` is empty.
- Commit: `feat(apps): Task 7 — index wiring; full gate green`.

---

## Codex self-review

After all 7 tasks: review the full diff against `origin/main` for (1) spec compliance — nothing missing, nothing over-built; (2) code quality — types correct, no `any`, store methods consistent with pattern; (3) MCP tool args validated same as existing tools; (4) provision endpoint correctly matches shop domain. Fix P1s, re-run gate, then report.
