# Haverford Unified Gateway Backend Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a locally testable Dev API read-through backend for the Haverford Unified Gateway admin UI while preserving fixture-mode local testing.

**Architecture:** Keep the existing fixture admin backend as the default local mode. Add an async-capable backend interface, a Dev API `/api/internal/brands` client, a mapper from Dev API service records into the admin `GatewayState`, and a backend factory selected by `ADMIN_DATA_SOURCE=fixture|dev-api`. Phase 1 is read-through only for Dev API mode; admin mutations remain enabled only in fixture mode.

**Tech Stack:** Existing Node 20+, Express 4, TypeScript, Vitest, Supertest, native `fetch`, vanilla admin UI.

---

## Scope Boundary

This plan implements Phase 1 from `docs/superpowers/specs/2026-06-02-haverford-unified-gateway-backend-transition-design.md`.

In scope:

- Fixture mode remains the default and runs fully locally.
- Dev API mode fetches `/api/internal/brands` using internal client headers.
- Admin UI can display real/read-through Dev API brands, regions, and configured service connections.
- Dev API mode is read-only and returns clear errors for create/test/rotate/revoke actions.
- Unit tests use mocked Dev API responses; no live Dev API is required for CI/local verification.
- README and `.env.example` explain fixture-mode and live Dev API-mode local testing.

Out of scope:

- Persistent `/data/gateway.sqlite`.
- Auth Gate policy store.
- Native Google OAuth.
- Read-only MCP tool execution against Dev API.
- Shopify app install automation.
- Nango or Composio adapter changes.
- Migrating current Dev API secrets.

## File Structure

Create:

- `src/admin/backend-error.ts`  
  Small typed error for route status codes.

- `src/admin/dev-api-types.ts`  
  TypeScript shape for Dev API `/api/internal/brands`.

- `src/admin/dev-api-mapper.ts`  
  Pure mapper from Dev API response to admin `GatewayState`.

- `src/admin/dev-api-client.ts`  
  Fetch wrapper for `/api/internal/brands` with internal client headers.

- `src/admin/dev-api-backend.ts`  
  Read-only `GatewayConnectionBackend` implementation backed by the Dev API client.

- `src/admin/backend-factory.ts`  
  Chooses fixture or Dev API backend from loaded config.

- `test/admin-dev-api-mapper.test.ts`  
  Pure mapper tests with fixture Dev API response data.

- `test/admin-dev-api-backend.test.ts`  
  Fetch/header/read-only behavior tests.

- `test/admin-backend-factory.test.ts`  
  Config-to-backend factory tests.

Modify:

- `src/admin/types.ts`  
  Allow backend methods to return either values or promises.

- `src/admin/routes.ts`  
  Await backend methods and preserve existing fixture behavior.

- `src/config.ts`  
  Parse admin data source and optional Dev API settings.

- `src/index.ts`  
  Mount a backend from `buildAdminBackend(config)` while keeping test injection possible.

- `test/admin-routes.test.ts`  
  Add async backend route coverage and keep fixture route tests passing.

- `test/config.test.ts`  
  Add admin data source/env parsing coverage.

- `.env.example`  
  Add local admin backend mode settings.

- `README.md`  
  Document local fixture mode and optional live Dev API read-through mode.

---

### Task 1: Make Admin Backends Async-Compatible

**Files:**

- Modify: `src/admin/types.ts`
- Modify: `src/admin/routes.ts`
- Modify: `test/admin-routes.test.ts`

- [ ] **Step 1: Write the failing async backend route test**

Add this import to `test/admin-routes.test.ts`:

```ts
import type {
  ApiKey,
  Brand,
  Connection,
  CreateBrandInput,
  CreateConnectionInput,
  CreateRegionInput,
  GatewayConnectionBackend,
  Region
} from "../src/admin/types.js";
```

Add this helper below `buildAdminApp`:

```ts
function asyncBackendFromFixture(): GatewayConnectionBackend {
  const fixture = new FixtureGatewayBackend();
  return {
    snapshot: async () => fixture.snapshot(),
    createBrand: async (input: CreateBrandInput): Promise<Brand> => fixture.createBrand(input),
    createRegion: async (input: CreateRegionInput): Promise<Region> => fixture.createRegion(input),
    createConnection: async (input: CreateConnectionInput): Promise<Connection> => fixture.createConnection(input),
    testConnection: async (connectionId: string): Promise<Connection> => fixture.testConnection(connectionId),
    rotateApiKey: async (clientId: string, keyId: string): Promise<ApiKey> => fixture.rotateApiKey(clientId, keyId),
    revokeApiKey: async (clientId: string, keyId: string): Promise<ApiKey> => fixture.revokeApiKey(clientId, keyId)
  };
}
```

Add this test inside `describe("admin routes", () => { ... })`:

```ts
it("awaits async admin backends", async () => {
  const app = express();
  app.disable("x-powered-by");
  app.use("/admin", createAdminRouter(asyncBackendFromFixture()));

  const res = await request(app).get("/admin/api/state");

  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({
    brands: expect.arrayContaining([expect.objectContaining({ slug: "haverford" })]),
    connectors: expect.arrayContaining([expect.objectContaining({ slug: "shopify" })])
  });
});
```

- [ ] **Step 2: Run the targeted test and verify it fails**

Run:

```bash
npm test -- test/admin-routes.test.ts -t "awaits async admin backends"
```

Expected: TypeScript or runtime failure because `GatewayConnectionBackend` methods currently require synchronous return values and routes do not await them.

- [ ] **Step 3: Update the backend interface to support values or promises**

In `src/admin/types.ts`, add this type near the top:

```ts
export type MaybePromise<T> = T | Promise<T>;
```

Replace the `GatewayConnectionBackend` interface with:

```ts
export interface GatewayConnectionBackend {
  snapshot(): MaybePromise<GatewayState>;
  createBrand(input: CreateBrandInput): MaybePromise<Brand>;
  createRegion(input: CreateRegionInput): MaybePromise<Region>;
  createConnection(input: CreateConnectionInput): MaybePromise<Connection>;
  testConnection(connectionId: string): MaybePromise<Connection>;
  rotateApiKey(clientId: string, keyId: string): MaybePromise<ApiKey>;
  revokeApiKey(clientId: string, keyId: string): MaybePromise<ApiKey>;
}
```

- [ ] **Step 4: Await backend calls in admin routes**

In `src/admin/routes.ts`, change each route that calls backend methods to be `async` and `await` the backend result.

Use this exact route body pattern for `/admin/api/state`:

```ts
  router.get("/api/state", async (_req: Request, res: Response) => {
    try {
      noStore(res);
      res.json(await backend.snapshot());
    } catch (error) {
      sendError(res, error);
    }
  });
```

Use this exact pattern for create brand:

```ts
  router.post("/api/brands", async (req: Request, res: Response) => {
    try {
      const body = req.body as any;
      const brand = await backend.createBrand({ name: body?.name, slug: body?.slug });
      res.status(201).json({ brand, state: await backend.snapshot() });
    } catch (error) {
      sendError(res, error);
    }
  });
```

Apply the same `async` + `await backend.method(...)` + `await backend.snapshot()` pattern to:

- `POST /api/brands/:brandId/regions`
- `POST /api/regions/:regionId/connections`
- `POST /api/connections/:connectionId/test`
- `POST /api/api-clients/:clientId/keys/:keyId/rotate`
- `POST /api/api-clients/:clientId/keys/:keyId/revoke`

- [ ] **Step 5: Run the targeted test and verify it passes**

Run:

```bash
npm test -- test/admin-routes.test.ts -t "awaits async admin backends"
```

Expected: PASS.

- [ ] **Step 6: Run existing admin tests**

Run:

```bash
npm test -- test/admin-routes.test.ts test/admin-fixture-backend.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/admin/types.ts src/admin/routes.ts test/admin-routes.test.ts
git commit -m "feat: support async admin backends"
```

---

### Task 2: Add Dev API Brands Mapper

**Files:**

- Create: `src/admin/dev-api-types.ts`
- Create: `src/admin/dev-api-mapper.ts`
- Create: `test/admin-dev-api-mapper.test.ts`

- [ ] **Step 1: Write the failing mapper tests**

Create `test/admin-dev-api-mapper.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mapDevApiBrandsToGatewayState } from "../src/admin/dev-api-mapper.js";
import type { DevApiBrandsResponse } from "../src/admin/dev-api-types.js";

function devApiBrandsResponse(): DevApiBrandsResponse {
  return {
    brands: [
      {
        slug: "haverford",
        name: "Haverford",
        regions: [
          {
            region: "au",
            domain: "haverford.au",
            brand_alias: null,
            public: true,
            services: {
              shopify: {
                configured: true,
                project_slug: "haverford-au",
                shop_domain: "haverford-au.myshopify.com",
                credential_group: "default",
                display_name: "Haverford AU Shopify",
                mutation_allowed: false
              },
              ga4: {
                configured: true,
                property_id: "properties/123456789"
              },
              gsc: {
                configured: true,
                site_url: "https://www.haverford.au"
              },
              google_ads: {
                configured: true,
                customer_id: "2159319535"
              },
              merchant_center: {
                configured: true,
                merchant_center_id: "1234567"
              },
              clarity: {
                configured: true,
                site: "abc123",
                name: "Haverford AU",
                url: "https://clarity.microsoft.com/projects/view/abc123"
              },
              klaviyo: {
                configured: true,
                account_id: "HAV-AU"
              },
              meta_ads: {
                configured: false
              },
              facebook_page: {
                configured: true,
                facebook_page_id: "111222333"
              },
              instagram_account: {
                configured: true,
                instagram_account_id: "444555666"
              },
              dataforseo: {
                configured: true,
                credential_configured: true,
                source: "gsc_property"
              }
            }
          }
        ]
      },
      {
        slug: "catnets",
        name: "Catnets",
        regions: [
          {
            region: "us",
            domain: "catnets.example",
            brand_alias: "Catnets USA",
            public: true,
            services: {
              shopify: { configured: false },
              gsc: { configured: true, site_url: "https://catnets.example" }
            }
          }
        ]
      }
    ]
  };
}

describe("mapDevApiBrandsToGatewayState", () => {
  it("maps Dev API brands and configured services into gateway state", () => {
    const state = mapDevApiBrandsToGatewayState(devApiBrandsResponse());

    expect(state.brands).toEqual([
      { id: "brand_haverford", name: "Haverford", slug: "haverford", status: "active" },
      { id: "brand_catnets", name: "Catnets", slug: "catnets", status: "active" }
    ]);
    expect(state.regions).toEqual([
      {
        id: "region_haverford_au",
        brandId: "brand_haverford",
        code: "AU",
        name: "AU",
        status: "active",
        domain: "haverford.au"
      },
      {
        id: "region_catnets_us",
        brandId: "brand_catnets",
        code: "US",
        name: "US",
        status: "active",
        domain: "catnets.example"
      }
    ]);
    expect(state.connectors.map((connector) => connector.slug)).toEqual(
      expect.arrayContaining([
        "shopify",
        "google-analytics-4",
        "google-search-console",
        "google-ads",
        "merchant-center",
        "microsoft-clarity",
        "klaviyo",
        "facebook-page",
        "instagram-account",
        "dataforseo"
      ])
    );
    expect(state.connections.map((connection) => connection.id)).toEqual(
      expect.arrayContaining([
        "devapi_haverford_au_shopify",
        "devapi_haverford_au_google_analytics_4",
        "devapi_haverford_au_google_search_console",
        "devapi_haverford_au_google_ads",
        "devapi_haverford_au_merchant_center",
        "devapi_haverford_au_microsoft_clarity",
        "devapi_haverford_au_klaviyo",
        "devapi_haverford_au_facebook_page",
        "devapi_haverford_au_instagram_account",
        "devapi_haverford_au_dataforseo",
        "devapi_catnets_us_google_search_console"
      ])
    );
    expect(state.connections.find((connection) => connection.id === "devapi_haverford_au_meta_ads")).toBeUndefined();
    expect(state.connections.find((connection) => connection.id === "devapi_haverford_au_shopify")).toMatchObject({
      brandId: "brand_haverford",
      regionId: "region_haverford_au",
      connectorId: "connector_shopify",
      backendType: "internal",
      displayName: "Haverford AU Shopify",
      status: "connected",
      configSummary: {
        project_slug: "haverford-au",
        shop_domain: "haverford-au.myshopify.com",
        credential_group: "default",
        display_name: "Haverford AU Shopify",
        mutation_allowed: "false"
      }
    });
    expect(state.connections.find((connection) => connection.id === "devapi_haverford_au_google_ads")).toMatchObject({
      connectorId: "connector_google_ads",
      configSummary: { customer_id: "2159319535" }
    });
    expect(state.auditEvents[0]).toMatchObject({
      action: "connection.tested",
      targetType: "connection",
      targetId: "dev-api-read-through",
      actor: "dev-api-source"
    });
  });

  it("does not expose secret-like fields from Dev API service details", () => {
    const response = devApiBrandsResponse();
    response.brands[0].regions[0].services.shopify = {
      configured: true,
      shop_domain: "haverford-au.myshopify.com",
      access_token: "secret-token",
      client_secret: "secret-client",
      password: "secret-password",
      api_key: "secret-key"
    };

    const state = mapDevApiBrandsToGatewayState(response);
    const serialized = JSON.stringify(state);

    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("secret-client");
    expect(serialized).not.toContain("secret-password");
    expect(serialized).not.toContain("secret-key");
  });
});
```

- [ ] **Step 2: Run mapper tests and verify they fail**

Run:

```bash
npm test -- test/admin-dev-api-mapper.test.ts
```

Expected: FAIL because `dev-api-mapper.js` and `dev-api-types.js` do not exist.

- [ ] **Step 3: Add Dev API response types**

Create `src/admin/dev-api-types.ts`:

```ts
export interface DevApiServiceDetail {
  configured: boolean;
  [key: string]: boolean | number | string | null | undefined;
}

export interface DevApiRegionRecord {
  region: string;
  domain: string | null;
  brand_alias: string | null;
  public: boolean;
  services: Record<string, DevApiServiceDetail>;
}

export interface DevApiBrandRecord {
  slug: string;
  name: string;
  regions: DevApiRegionRecord[];
}

export interface DevApiBrandsResponse {
  brands: DevApiBrandRecord[];
}
```

- [ ] **Step 4: Add the pure mapper**

Create `src/admin/dev-api-mapper.ts`:

```ts
import { createInitialGatewayState } from "./fixtures.js";
import type { Connector, ConnectorCategory, GatewayBackendType, GatewayState } from "./types.js";
import type { DevApiBrandsResponse, DevApiServiceDetail } from "./dev-api-types.js";

interface ServiceConnectorDefinition {
  serviceKey: string;
  connector: Connector;
  backendType: GatewayBackendType;
  displayNameKey?: string;
  fallbackDisplayName: string;
}

const serviceDefinitions: ServiceConnectorDefinition[] = [
  {
    serviceKey: "shopify",
    connector: {
      id: "connector_shopify",
      slug: "shopify",
      name: "Shopify",
      category: "commerce",
      authMode: "oauth",
      backendOptions: ["internal", "native", "nango"],
      requiredFields: [{ key: "shop_domain", label: "Shop domain", example: "brand.myshopify.com" }],
      scopes: ["orders:read", "customers:read", "products:read"],
      description: "Commerce storefront orders, customers, and catalog data."
    },
    backendType: "internal",
    displayNameKey: "display_name",
    fallbackDisplayName: "Shopify"
  },
  {
    serviceKey: "ga4",
    connector: {
      id: "connector_google_analytics_4",
      slug: "google-analytics-4",
      name: "Google Analytics 4",
      category: "analytics",
      authMode: "oauth",
      backendOptions: ["internal", "native", "nango"],
      requiredFields: [{ key: "property_id", label: "GA4 property ID", example: "properties/123456789" }],
      scopes: ["analytics.readonly"],
      description: "Website and campaign performance reporting."
    },
    backendType: "internal",
    fallbackDisplayName: "Google Analytics 4"
  },
  {
    serviceKey: "gsc",
    connector: {
      id: "connector_google_search_console",
      slug: "google-search-console",
      name: "Google Search Console",
      category: "analytics",
      authMode: "oauth",
      backendOptions: ["internal", "native", "nango"],
      requiredFields: [{ key: "site_url", label: "Site URL", example: "https://brand.example" }],
      scopes: ["webmasters.readonly"],
      description: "Organic search performance and indexing visibility."
    },
    backendType: "internal",
    fallbackDisplayName: "Google Search Console"
  },
  {
    serviceKey: "google_ads",
    connector: {
      id: "connector_google_ads",
      slug: "google-ads",
      name: "Google Ads",
      category: "marketing",
      authMode: "oauth",
      backendOptions: ["internal", "native", "nango"],
      requiredFields: [{ key: "customer_id", label: "Customer ID", example: "1234567890" }],
      scopes: ["adwords"],
      description: "Google Ads account reporting."
    },
    backendType: "internal",
    fallbackDisplayName: "Google Ads"
  },
  {
    serviceKey: "merchant_center",
    connector: {
      id: "connector_merchant_center",
      slug: "merchant-center",
      name: "Merchant Center",
      category: "commerce",
      authMode: "oauth",
      backendOptions: ["internal", "native", "nango"],
      requiredFields: [{ key: "merchant_center_id", label: "Merchant Center ID", example: "1234567" }],
      scopes: ["content"],
      description: "Google Merchant Center product and feed visibility."
    },
    backendType: "internal",
    fallbackDisplayName: "Merchant Center"
  },
  {
    serviceKey: "clarity",
    connector: {
      id: "connector_microsoft_clarity",
      slug: "microsoft-clarity",
      name: "Microsoft Clarity",
      category: "analytics",
      authMode: "api_key",
      backendOptions: ["internal", "native"],
      requiredFields: [{ key: "site", label: "Site ID", example: "abc123" }],
      scopes: ["clarity.read"],
      description: "Microsoft Clarity analytics and session insight metadata."
    },
    backendType: "internal",
    displayNameKey: "name",
    fallbackDisplayName: "Microsoft Clarity"
  },
  {
    serviceKey: "klaviyo",
    connector: {
      id: "connector_klaviyo",
      slug: "klaviyo",
      name: "Klaviyo",
      category: "marketing",
      authMode: "api_key",
      backendOptions: ["internal", "native", "nango"],
      requiredFields: [{ key: "account_id", label: "Account ID", example: "ABC123" }],
      scopes: ["campaigns:read", "metrics:read", "profiles:read"],
      description: "Lifecycle email metrics and campaign exports."
    },
    backendType: "internal",
    fallbackDisplayName: "Klaviyo"
  },
  {
    serviceKey: "meta_ads",
    connector: {
      id: "connector_meta_ads",
      slug: "meta-ads",
      name: "Meta Ads",
      category: "marketing",
      authMode: "oauth",
      backendOptions: ["internal", "nango", "composio"],
      requiredFields: [{ key: "ad_account_id", label: "Ad account ID", example: "act_123456789" }],
      scopes: ["ads_read", "business_management"],
      description: "Paid social campaign reporting and activation."
    },
    backendType: "internal",
    fallbackDisplayName: "Meta Ads"
  },
  {
    serviceKey: "facebook_page",
    connector: {
      id: "connector_facebook_page",
      slug: "facebook-page",
      name: "Facebook Page",
      category: "marketing",
      authMode: "oauth",
      backendOptions: ["internal", "native"],
      requiredFields: [{ key: "facebook_page_id", label: "Facebook Page ID", example: "111222333" }],
      scopes: ["pages_read_engagement"],
      description: "Facebook Page metadata and reporting."
    },
    backendType: "internal",
    fallbackDisplayName: "Facebook Page"
  },
  {
    serviceKey: "instagram_account",
    connector: {
      id: "connector_instagram_account",
      slug: "instagram-account",
      name: "Instagram Account",
      category: "marketing",
      authMode: "oauth",
      backendOptions: ["internal", "native"],
      requiredFields: [{ key: "instagram_account_id", label: "Instagram account ID", example: "444555666" }],
      scopes: ["instagram_basic"],
      description: "Instagram business account metadata and reporting."
    },
    backendType: "internal",
    fallbackDisplayName: "Instagram Account"
  },
  {
    serviceKey: "dataforseo",
    connector: {
      id: "connector_dataforseo",
      slug: "dataforseo",
      name: "DataForSEO",
      category: "analytics",
      authMode: "api_key",
      backendOptions: ["internal", "native"],
      requiredFields: [{ key: "source", label: "Source", example: "gsc_property" }],
      scopes: ["dataforseo.read"],
      description: "Search and SEO enrichment via Haverford Dev API credentials."
    },
    backendType: "internal",
    fallbackDisplayName: "DataForSEO"
  }
];

const secretLikePattern = /(token|secret|password|api[_-]?key|authorization|bearer)/i;

function idPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function connectorCategory(value: ConnectorCategory): ConnectorCategory {
  return value;
}

function safeConfigSummary(detail: DevApiServiceDetail): Record<string, string> {
  const summary: Record<string, string> = {};
  for (const [key, value] of Object.entries(detail)) {
    if (key === "configured" || secretLikePattern.test(key) || value === null || value === undefined) {
      continue;
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      summary[key] = String(value);
    }
  }
  return summary;
}

function mergeConnectors(base: Connector[]): Connector[] {
  const byId = new Map(base.map((connector) => [connector.id, connector]));
  for (const definition of serviceDefinitions) {
    byId.set(definition.connector.id, {
      ...definition.connector,
      category: connectorCategory(definition.connector.category)
    });
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function displayNameFor(
  brandName: string,
  regionCode: string,
  definition: ServiceConnectorDefinition,
  detail: DevApiServiceDetail
): string {
  const configuredName =
    definition.displayNameKey && typeof detail[definition.displayNameKey] === "string"
      ? String(detail[definition.displayNameKey]).trim()
      : "";
  return configuredName || `${brandName} ${regionCode} ${definition.fallbackDisplayName}`;
}

export function mapDevApiBrandsToGatewayState(response: DevApiBrandsResponse): GatewayState {
  const base = createInitialGatewayState();
  const brands = response.brands.map((brand) => ({
    id: `brand_${idPart(brand.slug)}`,
    name: brand.name,
    slug: brand.slug,
    status: "active" as const
  }));
  const regions: GatewayState["regions"] = [];
  const connections: GatewayState["connections"] = [];
  const definitionsByService = new Map(serviceDefinitions.map((definition) => [definition.serviceKey, definition]));

  for (const brand of response.brands) {
    const brandId = `brand_${idPart(brand.slug)}`;
    for (const region of brand.regions) {
      const regionCode = region.region.toUpperCase();
      const regionId = `region_${idPart(brand.slug)}_${idPart(region.region)}`;
      regions.push({
        id: regionId,
        brandId,
        code: regionCode,
        name: regionCode,
        status: region.public === false ? "disabled" : "active",
        ...(region.domain ? { domain: region.domain } : {})
      });

      for (const [serviceKey, detail] of Object.entries(region.services)) {
        const definition = definitionsByService.get(serviceKey);
        if (!definition || !detail.configured) {
          continue;
        }
        connections.push({
          id: `devapi_${idPart(brand.slug)}_${idPart(region.region)}_${idPart(definition.connector.slug)}`,
          brandId,
          regionId,
          connectorId: definition.connector.id,
          backendType: definition.backendType,
          displayName: displayNameFor(brand.name, regionCode, definition, detail),
          status: "connected",
          configSummary: safeConfigSummary(detail)
        });
      }
    }
  }

  return {
    brands,
    regions,
    connectors: mergeConnectors(base.connectors),
    connections,
    apiClients: base.apiClients,
    auditEvents: [
      {
        id: "audit_dev_api_read_through",
        action: "connection.tested",
        targetType: "connection",
        targetId: "dev-api-read-through",
        detail: "Gateway admin state loaded from Haverford Dev API /api/internal/brands.",
        timestamp: new Date(0).toISOString(),
        actor: "dev-api-source",
        metadata: { source: "dev-api" }
      }
    ]
  };
}
```

- [ ] **Step 5: Run mapper tests and verify they pass**

Run:

```bash
npm test -- test/admin-dev-api-mapper.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/admin/dev-api-types.ts src/admin/dev-api-mapper.ts test/admin-dev-api-mapper.test.ts
git commit -m "feat: map dev api brands into admin state"
```

---

### Task 3: Add Dev API Read-Only Backend

**Files:**

- Create: `src/admin/backend-error.ts`
- Create: `src/admin/dev-api-client.ts`
- Create: `src/admin/dev-api-backend.ts`
- Create: `test/admin-dev-api-backend.test.ts`

- [ ] **Step 1: Write failing backend tests**

Create `test/admin-dev-api-backend.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { AdminBackendError } from "../src/admin/backend-error.js";
import { DevApiBrandsClient } from "../src/admin/dev-api-client.js";
import { DevApiGatewayBackend } from "../src/admin/dev-api-backend.js";
import type { DevApiBrandsResponse } from "../src/admin/dev-api-types.js";

function responseBody(): DevApiBrandsResponse {
  return {
    brands: [
      {
        slug: "haverford",
        name: "Haverford",
        regions: [
          {
            region: "au",
            domain: "haverford.au",
            brand_alias: null,
            public: true,
            services: {
              shopify: {
                configured: true,
                shop_domain: "haverford-au.myshopify.com",
                project_slug: "haverford-au"
              }
            }
          }
        ]
      }
    ]
  };
}

describe("DevApiBrandsClient", () => {
  it("fetches /api/internal/brands with internal client headers", async () => {
    const calls: Array<{ url: string; headers: HeadersInit | undefined }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), headers: init?.headers });
      return new Response(JSON.stringify(responseBody()), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    };
    const client = new DevApiBrandsClient({
      baseUrl: "https://api.haverford.au/",
      clientId: "gateway-admin",
      clientSecret: "secret-value",
      fetchImpl
    });

    const result = await client.fetchBrands();

    expect(result.brands[0].slug).toBe("haverford");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.haverford.au/api/internal/brands");
    expect(calls[0].headers).toEqual({
      accept: "application/json",
      "x-internal-client-id": "gateway-admin",
      "x-internal-client-secret": "secret-value"
    });
  });

  it("raises a 502 admin error when Dev API returns a non-OK response", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403,
        headers: { "content-type": "application/json" }
      });
    const client = new DevApiBrandsClient({
      baseUrl: "https://api.haverford.au",
      clientId: "gateway-admin",
      clientSecret: "secret-value",
      fetchImpl
    });

    await expect(client.fetchBrands()).rejects.toMatchObject({
      statusCode: 502,
      message: "Haverford Dev API /api/internal/brands failed with 403: {\"error\":\"forbidden\"}"
    });
  });
});

describe("DevApiGatewayBackend", () => {
  it("returns mapped state from Dev API", async () => {
    const backend = new DevApiGatewayBackend({
      client: {
        fetchBrands: async () => responseBody()
      }
    });

    const state = await backend.snapshot();

    expect(state.brands).toContainEqual({ id: "brand_haverford", name: "Haverford", slug: "haverford", status: "active" });
    expect(state.connections).toContainEqual(
      expect.objectContaining({
        id: "devapi_haverford_au_shopify",
        connectorId: "connector_shopify",
        backendType: "internal"
      })
    );
  });

  it("rejects write actions in Dev API read-through mode", async () => {
    const backend = new DevApiGatewayBackend({
      client: {
        fetchBrands: async () => responseBody()
      }
    });

    await expect(backend.createBrand({ name: "Blocked" })).rejects.toThrow(/read-only/);
    await expect(backend.createRegion({ brandId: "brand_haverford", code: "NZ", name: "New Zealand" })).rejects.toThrow(
      /read-only/
    );
    await expect(
      backend.createConnection({
        brandId: "brand_haverford",
        regionId: "region_haverford_au",
        connectorId: "connector_shopify",
        backendType: "internal",
        displayName: "Blocked Shopify"
      })
    ).rejects.toThrow(/read-only/);
    await expect(backend.testConnection("devapi_haverford_au_shopify")).rejects.toThrow(/read-only/);
    await expect(backend.rotateApiKey("client", "key")).rejects.toThrow(/read-only/);
    await expect(backend.revokeApiKey("client", "key")).rejects.toThrow(/read-only/);
  });

  it("exposes AdminBackendError status codes", () => {
    const error = new AdminBackendError(502, "bad upstream");
    expect(error.statusCode).toBe(502);
    expect(error.message).toBe("bad upstream");
  });
});
```

- [ ] **Step 2: Run backend tests and verify they fail**

Run:

```bash
npm test -- test/admin-dev-api-backend.test.ts
```

Expected: FAIL because the backend files do not exist.

- [ ] **Step 3: Add typed admin backend error**

Create `src/admin/backend-error.ts`:

```ts
export class AdminBackendError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "AdminBackendError";
    this.statusCode = statusCode;
  }
}

export function statusCodeForAdminError(error: unknown): number {
  if (error instanceof AdminBackendError) {
    return error.statusCode;
  }
  return 400;
}
```

- [ ] **Step 4: Add Dev API client**

Create `src/admin/dev-api-client.ts`:

```ts
import { AdminBackendError } from "./backend-error.js";
import type { DevApiBrandsResponse } from "./dev-api-types.js";

export interface DevApiBrandsClientOptions {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  fetchImpl?: typeof fetch;
}

export interface DevApiBrandsSource {
  fetchBrands(): Promise<DevApiBrandsResponse>;
}

export class DevApiBrandsClient implements DevApiBrandsSource {
  private readonly baseUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: DevApiBrandsClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  async fetchBrands(): Promise<DevApiBrandsResponse> {
    const response = await this.fetchImpl(`${this.baseUrl}/api/internal/brands`, {
      method: "GET",
      headers: {
        accept: "application/json",
        "x-internal-client-id": this.clientId,
        "x-internal-client-secret": this.clientSecret
      }
    });

    if (!response.ok) {
      const body = await response.text();
      throw new AdminBackendError(
        502,
        `Haverford Dev API /api/internal/brands failed with ${response.status}: ${body}`
      );
    }

    return (await response.json()) as DevApiBrandsResponse;
  }
}
```

- [ ] **Step 5: Add Dev API read-only backend**

Create `src/admin/dev-api-backend.ts`:

```ts
import { AdminBackendError } from "./backend-error.js";
import { mapDevApiBrandsToGatewayState } from "./dev-api-mapper.js";
import type {
  ApiKey,
  Brand,
  Connection,
  CreateBrandInput,
  CreateConnectionInput,
  CreateRegionInput,
  GatewayConnectionBackend,
  GatewayState,
  Region
} from "./types.js";
import type { DevApiBrandsSource } from "./dev-api-client.js";

export interface DevApiGatewayBackendOptions {
  client: DevApiBrandsSource;
}

export class DevApiGatewayBackend implements GatewayConnectionBackend {
  private readonly client: DevApiBrandsSource;

  constructor(options: DevApiGatewayBackendOptions) {
    this.client = options.client;
  }

  async snapshot(): Promise<GatewayState> {
    return mapDevApiBrandsToGatewayState(await this.client.fetchBrands());
  }

  async createBrand(_input: CreateBrandInput): Promise<Brand> {
    throw this.readOnlyError("create brands");
  }

  async createRegion(_input: CreateRegionInput): Promise<Region> {
    throw this.readOnlyError("create regions");
  }

  async createConnection(_input: CreateConnectionInput): Promise<Connection> {
    throw this.readOnlyError("create connections");
  }

  async testConnection(_connectionId: string): Promise<Connection> {
    throw this.readOnlyError("test connections");
  }

  async rotateApiKey(_clientId: string, _keyId: string): Promise<ApiKey> {
    throw this.readOnlyError("rotate API keys");
  }

  async revokeApiKey(_clientId: string, _keyId: string): Promise<ApiKey> {
    throw this.readOnlyError("revoke API keys");
  }

  private readOnlyError(action: string): AdminBackendError {
    return new AdminBackendError(409, `Dev API read-through mode is read-only in Phase 1; cannot ${action}.`);
  }
}
```

- [ ] **Step 6: Use admin error status codes in routes**

In `src/admin/routes.ts`, add:

```ts
import { statusCodeForAdminError } from "./backend-error.js";
```

Replace `sendError` with:

```ts
function sendError(res: Response, error: unknown): void {
  res.status(statusCodeForAdminError(error)).json({ error: errorMessage(error) });
}
```

- [ ] **Step 7: Run backend and route tests**

Run:

```bash
npm test -- test/admin-dev-api-backend.test.ts test/admin-routes.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/admin/backend-error.ts src/admin/dev-api-client.ts src/admin/dev-api-backend.ts src/admin/routes.ts test/admin-dev-api-backend.test.ts
git commit -m "feat: add dev api read-through admin backend"
```

---

### Task 4: Add Config And Backend Factory

**Files:**

- Modify: `src/config.ts`
- Create: `src/admin/backend-factory.ts`
- Modify: `test/config.test.ts`
- Create: `test/admin-backend-factory.test.ts`

- [ ] **Step 1: Write failing config tests**

In `test/config.test.ts`, add these env deletes in `beforeEach`:

```ts
    delete process.env.ADMIN_DATA_SOURCE;
    delete process.env.HAVERFORD_DEV_API_BASE_URL;
    delete process.env.HAVERFORD_DEV_API_CLIENT_ID;
    delete process.env.HAVERFORD_DEV_API_CLIENT_SECRET;
```

Add these tests:

```ts
  it("defaults the admin data source to fixture", () => {
    process.env.COMPOSIO_API_KEY = "ak_test";
    process.env.BRAND_SLUG = "genvest";
    process.env.GATEWAY_BEARER = "a_secret_thats_long_enough";

    expect(loadConfig().adminDataSource).toBe("fixture");
  });

  it("parses Dev API admin data source settings", () => {
    process.env.COMPOSIO_API_KEY = "ak_test";
    process.env.BRAND_SLUG = "genvest";
    process.env.GATEWAY_BEARER = "a_secret_thats_long_enough";
    process.env.ADMIN_DATA_SOURCE = "dev-api";
    process.env.HAVERFORD_DEV_API_BASE_URL = "https://api.haverford.au";
    process.env.HAVERFORD_DEV_API_CLIENT_ID = "gateway-admin";
    process.env.HAVERFORD_DEV_API_CLIENT_SECRET = "secret-value";

    expect(loadConfig()).toMatchObject({
      adminDataSource: "dev-api",
      haverfordDevApiBaseUrl: "https://api.haverford.au",
      haverfordDevApiClientId: "gateway-admin",
      haverfordDevApiClientSecret: "secret-value"
    });
  });

  it("rejects invalid admin data source values", () => {
    process.env.COMPOSIO_API_KEY = "ak_test";
    process.env.BRAND_SLUG = "genvest";
    process.env.GATEWAY_BEARER = "a_secret_thats_long_enough";
    process.env.ADMIN_DATA_SOURCE = "sqlite";

    expect(() => loadConfig()).toThrow(/ADMIN_DATA_SOURCE/);
  });
```

- [ ] **Step 2: Write failing backend factory tests**

Create `test/admin-backend-factory.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildAdminBackend } from "../src/admin/backend-factory.js";
import type { GatewayConfig } from "../src/config.js";

function baseConfig(): GatewayConfig {
  return {
    composioApiKey: "ak_test",
    brandSlug: "haverford",
    gatewayBearer: "a_secret_thats_long_enough",
    port: 3000,
    sessionTtlSeconds: 3600,
    adminDataSource: "fixture"
  };
}

describe("buildAdminBackend", () => {
  it("builds the fixture backend by default", async () => {
    const backend = buildAdminBackend(baseConfig());

    const state = await backend.snapshot();

    expect(state.brands).toContainEqual(expect.objectContaining({ slug: "haverford" }));
    expect(state.connections).toContainEqual(expect.objectContaining({ id: "connection_haverford_au_dev_api" }));
  });

  it("requires Dev API settings when admin data source is dev-api", () => {
    expect(() => buildAdminBackend({ ...baseConfig(), adminDataSource: "dev-api" })).toThrow(
      /HAVERFORD_DEV_API_BASE_URL/
    );
    expect(() =>
      buildAdminBackend({
        ...baseConfig(),
        adminDataSource: "dev-api",
        haverfordDevApiBaseUrl: "https://api.haverford.au"
      })
    ).toThrow(/HAVERFORD_DEV_API_CLIENT_ID/);
    expect(() =>
      buildAdminBackend({
        ...baseConfig(),
        adminDataSource: "dev-api",
        haverfordDevApiBaseUrl: "https://api.haverford.au",
        haverfordDevApiClientId: "gateway-admin"
      })
    ).toThrow(/HAVERFORD_DEV_API_CLIENT_SECRET/);
  });
});
```

- [ ] **Step 3: Run targeted tests and verify they fail**

Run:

```bash
npm test -- test/config.test.ts test/admin-backend-factory.test.ts
```

Expected: FAIL because config and factory support do not exist.

- [ ] **Step 4: Update config types and parsing**

In `src/config.ts`, add:

```ts
export type AdminDataSource = "fixture" | "dev-api";
```

Add these fields to `GatewayConfig`:

```ts
  adminDataSource: AdminDataSource;
  haverfordDevApiBaseUrl?: string;
  haverfordDevApiClientId?: string;
  haverfordDevApiClientSecret?: string;
```

Add this parser near the other parse helpers:

```ts
function parseAdminDataSource(raw?: string): AdminDataSource {
  if (!raw) return "fixture";
  const value = raw.trim().toLowerCase();
  if (value === "fixture" || value === "dev-api") {
    return value;
  }
  throw new Error(`ADMIN_DATA_SOURCE must be fixture or dev-api (got ${raw})`);
}
```

Add these properties to the returned object in `loadConfig`:

```ts
    adminDataSource: parseAdminDataSource(env.ADMIN_DATA_SOURCE),
    haverfordDevApiBaseUrl: optionalEnv("HAVERFORD_DEV_API_BASE_URL"),
    haverfordDevApiClientId: optionalEnv("HAVERFORD_DEV_API_CLIENT_ID"),
    haverfordDevApiClientSecret: optionalEnv("HAVERFORD_DEV_API_CLIENT_SECRET")
```

Update any `GatewayConfig` object literals in tests to include:

```ts
    adminDataSource: "fixture"
```

- [ ] **Step 5: Add backend factory**

Create `src/admin/backend-factory.ts`:

```ts
import { DevApiGatewayBackend } from "./dev-api-backend.js";
import { DevApiBrandsClient } from "./dev-api-client.js";
import { FixtureGatewayBackend } from "./fixture-backend.js";
import type { GatewayConnectionBackend } from "./types.js";
import type { GatewayConfig } from "../config.js";

function requireSetting(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} is required when ADMIN_DATA_SOURCE=dev-api`);
  }
  return value;
}

export function buildAdminBackend(config: GatewayConfig): GatewayConnectionBackend {
  if (config.adminDataSource === "fixture") {
    return new FixtureGatewayBackend();
  }

  const baseUrl = requireSetting(config.haverfordDevApiBaseUrl, "HAVERFORD_DEV_API_BASE_URL");
  const clientId = requireSetting(config.haverfordDevApiClientId, "HAVERFORD_DEV_API_CLIENT_ID");
  const clientSecret = requireSetting(config.haverfordDevApiClientSecret, "HAVERFORD_DEV_API_CLIENT_SECRET");

  return new DevApiGatewayBackend({
    client: new DevApiBrandsClient({
      baseUrl,
      clientId,
      clientSecret
    })
  });
}
```

- [ ] **Step 6: Run config and factory tests**

Run:

```bash
npm test -- test/config.test.ts test/admin-backend-factory.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/config.ts src/admin/backend-factory.ts test/config.test.ts test/admin-backend-factory.test.ts
git commit -m "feat: select admin backend from config"
```

---

### Task 5: Wire Backend Factory Into The App

**Files:**

- Modify: `src/index.ts`
- Modify: `test/admin-routes.test.ts`

- [ ] **Step 1: Write failing app injection test**

In `test/admin-routes.test.ts`, add this test:

```ts
it("lets createApp mount an injected admin backend for local smoke tests", async () => {
  const app = createApp(testConfig(), { adminBackend: asyncBackendFromFixture() });

  const res = await request(app).get("/admin/api/state");

  expect(res.status).toBe(200);
  expect(res.body.brands).toContainEqual(expect.objectContaining({ slug: "haverford" }));
});
```

- [ ] **Step 2: Run targeted test and verify it fails**

Run:

```bash
npm test -- test/admin-routes.test.ts -t "injected admin backend"
```

Expected: FAIL because `createApp` does not accept admin backend injection.

- [ ] **Step 3: Update app wiring**

In `src/index.ts`, add:

```ts
import { buildAdminBackend } from "./admin/backend-factory.js";
import type { GatewayConnectionBackend } from "./admin/types.js";
```

Replace:

```ts
export function createApp(config = loadConfig()) {
```

with:

```ts
interface CreateAppOptions {
  adminBackend?: GatewayConnectionBackend;
}

export function createApp(config = loadConfig(), options: CreateAppOptions = {}) {
```

Replace:

```ts
  app.use("/admin", createAdminRouter());
```

with:

```ts
  app.use("/admin", createAdminRouter(options.adminBackend ?? buildAdminBackend(config)));
```

- [ ] **Step 4: Run route tests**

Run:

```bash
npm test -- test/admin-routes.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts test/admin-routes.test.ts
git commit -m "feat: wire configurable admin backend"
```

---

### Task 6: Document Local Testing Modes

**Files:**

- Modify: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: Add local admin env settings to `.env.example`**

Append this block near the top of `.env.example`, below `API_BEARER_TOKENS=`:

```dotenv

# --- Haverford Unified Gateway admin backend ---
# fixture keeps the admin UI fully local. dev-api reads brands/regions/services
# from Haverford Dev API /api/internal/brands using internal client headers.
ADMIN_DATA_SOURCE=fixture
HAVERFORD_DEV_API_BASE_URL=
HAVERFORD_DEV_API_CLIENT_ID=
HAVERFORD_DEV_API_CLIENT_SECRET=
```

- [ ] **Step 2: Update README local admin section**

In `README.md`, replace the paragraph starting with `This milestone is fixture-data only.` through `The prototype does not call...` with:

````md
By default the admin UI runs in fixture mode, so it can be tested locally without a live Dev API, Composio session, OAuth provider, native connector, or persistent-volume store:

```bash
COMPOSIO_API_KEY=ak_local_dummy \
BRAND_SLUG=haverford \
GATEWAY_BEARER=a_secret_thats_long_enough \
ADMIN_DATA_SOURCE=fixture \
PORT=3000 \
npm run dev
```

Open:

```bash
open http://localhost:3000/admin
```

Fixture mode proves the operator workflow:

- add brands
- add regions under brands
- add connections under brand/region
- review connector backend options (`nango`, `composio`, `native`, `internal`)
- view API clients
- rotate and revoke mock keys
- view mock usage and audit history

To test read-through against a local or deployed Haverford Dev API, run with:

```bash
COMPOSIO_API_KEY=ak_local_dummy \
BRAND_SLUG=haverford \
GATEWAY_BEARER=a_secret_thats_long_enough \
ADMIN_DATA_SOURCE=dev-api \
HAVERFORD_DEV_API_BASE_URL=http://localhost:3001 \
HAVERFORD_DEV_API_CLIENT_ID=<internal-client-id> \
HAVERFORD_DEV_API_CLIENT_SECRET=<internal-client-secret> \
PORT=3000 \
npm run dev
```

Dev API mode is read-only in this phase. It displays brands, regions, and configured service connections from `/api/internal/brands`; create/test/rotate/revoke actions stay fixture-mode only until the persistent gateway store is implemented.
````

- [ ] **Step 3: Run documentation grep checks**

Run:

```bash
rg -n "ADMIN_DATA_SOURCE|HAVERFORD_DEV_API_BASE_URL|Dev API mode is read-only" README.md .env.example
```

Expected: matches in both files.

- [ ] **Step 4: Commit**

```bash
git add README.md .env.example
git commit -m "docs: document local admin backend modes"
```

---

### Task 7: Final Verification

**Files:**

- No new files.

- [ ] **Step 1: Run all tests**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 4: Smoke test fixture mode locally**

Run:

```bash
COMPOSIO_API_KEY=ak_local_dummy \
BRAND_SLUG=haverford \
GATEWAY_BEARER=a_secret_thats_long_enough \
ADMIN_DATA_SOURCE=fixture \
PORT=3002 \
npm run dev
```

In another terminal:

```bash
curl -s http://localhost:3002/admin/api/state | node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{const j=JSON.parse(s);console.log(`${j.brands.length} brands, ${j.connections.length} connections`);})'
```

Expected: prints at least:

```text
3 brands, 8 connections
```

- [ ] **Step 5: Smoke test Dev API mode with mocked route tests**

Run:

```bash
npm test -- test/admin-dev-api-backend.test.ts test/admin-dev-api-mapper.test.ts
```

Expected: PASS.

- [ ] **Step 6: Optional live Dev API smoke test**

Run this only when a local or deployed Dev API and internal client credentials are available:

```bash
COMPOSIO_API_KEY=ak_local_dummy \
BRAND_SLUG=haverford \
GATEWAY_BEARER=a_secret_thats_long_enough \
ADMIN_DATA_SOURCE=dev-api \
HAVERFORD_DEV_API_BASE_URL=http://localhost:3001 \
HAVERFORD_DEV_API_CLIENT_ID=<internal-client-id> \
HAVERFORD_DEV_API_CLIENT_SECRET=<internal-client-secret> \
PORT=3002 \
npm run dev
```

In another terminal:

```bash
curl -s http://localhost:3002/admin/api/state | node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{const j=JSON.parse(s);console.log(`${j.brands.length} brands, ${j.regions.length} regions, ${j.connections.length} connections`);})'
```

Expected with seeded Dev API data: non-zero brand, region, and connection counts.

- [ ] **Step 7: Check git status**

Run:

```bash
git status --short
```

Expected: clean working tree.
