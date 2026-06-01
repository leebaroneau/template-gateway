# Haverford Unified Gateway UI Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local, fixture-data admin UI prototype inside `template-gateway` that validates the Haverford `Brand > Region > Connection` workflow and API Access dashboard before backend integration.

**Architecture:** Add an Express-mounted admin surface under `/admin` backed by an in-memory fixture adapter. Keep a backend-neutral `GatewayConnectionBackend` interface so the fixture adapter can be replaced by persistent-volume storage, Nango, Composio, native, or internal adapters in a later backend phase.

**Tech Stack:** Existing Node 20+, Express 4, TypeScript, Vitest, Supertest, vanilla browser JavaScript served by Express. No React, Refine, React Admin, Nango, Composio, OAuth, or persistent-volume writes in this milestone.

---

## Scope Boundary

This plan implements only the first UI milestone from `docs/superpowers/specs/2026-06-01-haverford-unified-gateway-design.md`.

In scope:

- `/admin` operational UI.
- Fixture-backed `Brand > Region > Connection` model.
- Mock connection setup flow.
- API Access view with mock clients, keys/tokens, scopes, usage, rotation, revocation, and audit.
- Local tests for the fixture adapter and admin routes.

Out of scope:

- Real Nango integration.
- Real Composio changes.
- Real native connector execution.
- Real OAuth.
- Real API key generation.
- Persistent-volume storage.
- Production deployment changes.
- Actor/profile OAuth bindings.

## File Structure

Create these files:

- `src/admin/types.ts`  
  Shared admin domain types and backend interface.

- `src/admin/fixtures.ts`  
  Deterministic seed data for brands, regions, connectors, connections, API clients, usage, and audit events.

- `src/admin/fixture-backend.ts`  
  In-memory implementation of the backend interface. Owns mutations used by the prototype.

- `src/admin/routes.ts`  
  Express router for the admin page, static browser assets, and fixture JSON API.

- `src/admin/page.ts`  
  HTML shell for the admin prototype.

- `src/admin/styles.ts`  
  CSS string for the operational admin UI.

- `src/admin/client-script.ts`  
  Browser JavaScript string. Fetches fixture state and renders the prototype.

- `test/admin-fixture-backend.test.ts`  
  Unit tests for adding brands, regions, connections, testing connections, rotating keys, revoking keys, and audit writes.

- `test/admin-routes.test.ts`  
  Supertest coverage for the `/admin` route and fixture API endpoints.

Modify:

- `src/index.ts`  
  Mount the admin router before the error handler.

- `README.md`  
  Add local prototype instructions.

Do not modify existing MCP proxy behavior.

---

### Task 1: Define Admin Domain Types

**Files:**

- Create: `src/admin/types.ts`
- Test: `test/admin-fixture-backend.test.ts`

- [ ] **Step 1: Write the failing type-level behavior test**

Create `test/admin-fixture-backend.test.ts` with an initial test that imports the fixture backend that does not exist yet:

```ts
import { describe, expect, it } from "vitest";
import { FixtureGatewayBackend } from "../src/admin/fixture-backend.js";

describe("FixtureGatewayBackend", () => {
  it("starts with multiple brands, regions, connections, connectors, API clients, and audit events", () => {
    const backend = new FixtureGatewayBackend();
    const state = backend.snapshot();

    expect(state.brands.length).toBeGreaterThanOrEqual(3);
    expect(state.regions.length).toBeGreaterThanOrEqual(5);
    expect(state.connectors.length).toBeGreaterThanOrEqual(8);
    expect(state.connections.length).toBeGreaterThanOrEqual(8);
    expect(state.apiClients.length).toBeGreaterThanOrEqual(4);
    expect(state.auditEvents.length).toBeGreaterThanOrEqual(6);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npm test -- test/admin-fixture-backend.test.ts
```

Expected result: failure because `../src/admin/fixture-backend.js` cannot be resolved.

- [ ] **Step 3: Create `src/admin/types.ts`**

Create `src/admin/types.ts`:

```ts
export type GatewayBackendType = "nango" | "composio" | "native" | "internal";

export type EntityStatus = "active" | "disabled";
export type ConnectionStatus =
  | "needs_config"
  | "pending"
  | "connected"
  | "needs_reconnect"
  | "error";

export type AuthMode = "oauth" | "api_key" | "service_account" | "none";

export type ConnectorCategory =
  | "commerce"
  | "analytics"
  | "marketing"
  | "crm"
  | "productivity"
  | "internal";

export interface Brand {
  id: string;
  slug: string;
  name: string;
  status: EntityStatus;
}

export interface Region {
  id: string;
  brandId: string;
  code: string;
  name: string;
  domain?: string;
  status: EntityStatus;
}

export interface ConnectorField {
  key: string;
  label: string;
  secret?: boolean;
  example?: string;
}

export interface Connector {
  id: string;
  slug: string;
  name: string;
  category: ConnectorCategory;
  backendOptions: GatewayBackendType[];
  authMode: AuthMode;
  requiredFields: ConnectorField[];
  scopes: string[];
  description: string;
}

export interface Connection {
  id: string;
  brandId: string;
  regionId: string;
  connectorId: string;
  backendType: GatewayBackendType;
  displayName: string;
  status: ConnectionStatus;
  configSummary: Record<string, string>;
  lastTestedAt?: string;
  lastUsedAt?: string;
  lastError?: string;
}

export interface ApiKey {
  id: string;
  label: string;
  status: "active" | "revoked";
  preview: string;
  fingerprint: string;
  createdAt: string;
  rotatedAt?: string;
  revokedAt?: string;
}

export interface ApiClient {
  id: string;
  name: string;
  type: "service" | "agent" | "worker";
  status: "active" | "revoked";
  scopes: string[];
  owner: string;
  lastUsedAt?: string;
  requestCount24h: number;
  errorRate24h: number;
  keys: ApiKey[];
}

export interface AuditEvent {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  targetType: "brand" | "region" | "connection" | "api_client" | "api_key";
  targetId: string;
  detail: string;
}

export interface GatewayState {
  brands: Brand[];
  regions: Region[];
  connectors: Connector[];
  connections: Connection[];
  apiClients: ApiClient[];
  auditEvents: AuditEvent[];
}

export interface CreateBrandInput {
  slug: string;
  name: string;
}

export interface CreateRegionInput {
  brandId: string;
  code: string;
  name: string;
  domain?: string;
}

export interface CreateConnectionInput {
  brandId: string;
  regionId: string;
  connectorId: string;
  backendType: GatewayBackendType;
  displayName: string;
  configSummary?: Record<string, string>;
}

export interface GatewayConnectionBackend {
  snapshot(): GatewayState;
  createBrand(input: CreateBrandInput): Brand;
  createRegion(input: CreateRegionInput): Region;
  createConnection(input: CreateConnectionInput): Connection;
  testConnection(connectionId: string): Connection;
  rotateApiKey(clientId: string, keyId: string): ApiKey;
  revokeApiKey(clientId: string, keyId: string): ApiKey;
}
```

- [ ] **Step 4: Commit the types only after Task 2 passes**

Do not commit yet. Task 2 will add the fixture implementation needed by the failing test.

---

### Task 2: Add Fixture State And Backend Mutations

**Files:**

- Create: `src/admin/fixtures.ts`
- Create: `src/admin/fixture-backend.ts`
- Modify: `test/admin-fixture-backend.test.ts`

- [ ] **Step 1: Create deterministic fixtures**

Create `src/admin/fixtures.ts`:

```ts
import type { GatewayState } from "./types.js";

export function createInitialGatewayState(): GatewayState {
  return {
    brands: [
      { id: "brand-haverford", slug: "haverford", name: "Haverford", status: "active" },
      { id: "brand-catnets", slug: "catnets", name: "Catnets", status: "active" },
      { id: "brand-koenig", slug: "koenig", name: "Koenig Machinery", status: "active" }
    ],
    regions: [
      { id: "region-haverford-au", brandId: "brand-haverford", code: "au", name: "Australia", domain: "haverford.com.au", status: "active" },
      { id: "region-haverford-nz", brandId: "brand-haverford", code: "nz", name: "New Zealand", domain: "haverford.co.nz", status: "active" },
      { id: "region-catnets-au", brandId: "brand-catnets", code: "au", name: "Australia", domain: "catnets.com.au", status: "active" },
      { id: "region-catnets-us", brandId: "brand-catnets", code: "us", name: "United States", domain: "catnetting.com", status: "active" },
      { id: "region-koenig-au", brandId: "brand-koenig", code: "au", name: "Australia", domain: "koenigmachinery.com.au", status: "active" }
    ],
    connectors: [
      {
        id: "connector-shopify",
        slug: "shopify",
        name: "Shopify",
        category: "commerce",
        backendOptions: ["nango", "native"],
        authMode: "oauth",
        requiredFields: [{ key: "shop_domain", label: "Shop domain", example: "store.myshopify.com" }],
        scopes: ["read_products", "read_orders", "write_products"],
        description: "Storefront and Admin API access."
      },
      {
        id: "connector-ga4",
        slug: "ga4",
        name: "Google Analytics 4",
        category: "analytics",
        backendOptions: ["nango", "native"],
        authMode: "oauth",
        requiredFields: [{ key: "property_id", label: "Property ID", example: "123456789" }],
        scopes: ["analytics.readonly"],
        description: "GA4 reporting and property metadata."
      },
      {
        id: "connector-gsc",
        slug: "gsc",
        name: "Google Search Console",
        category: "analytics",
        backendOptions: ["nango", "native"],
        authMode: "oauth",
        requiredFields: [{ key: "site_url", label: "Site URL", example: "https://example.com/" }],
        scopes: ["webmasters.readonly"],
        description: "Search Console sites, sitemap, and query data."
      },
      {
        id: "connector-meta-ads",
        slug: "meta-ads",
        name: "Meta Ads",
        category: "marketing",
        backendOptions: ["nango", "native"],
        authMode: "oauth",
        requiredFields: [{ key: "ad_account_id", label: "Ad account ID", example: "act_123" }],
        scopes: ["ads_read", "business_management"],
        description: "Meta ad accounts, campaigns, and reporting."
      },
      {
        id: "connector-klaviyo",
        slug: "klaviyo",
        name: "Klaviyo",
        category: "marketing",
        backendOptions: ["nango", "native"],
        authMode: "oauth",
        requiredFields: [{ key: "account_id", label: "Account ID", example: "R12345" }],
        scopes: ["accounts:read", "campaigns:read", "flows:read"],
        description: "Email/SMS account and campaign data."
      },
      {
        id: "connector-outlook",
        slug: "outlook",
        name: "Outlook",
        category: "productivity",
        backendOptions: ["composio", "nango"],
        authMode: "oauth",
        requiredFields: [{ key: "tenant", label: "Tenant", example: "common" }],
        scopes: ["Mail.Read", "Calendars.Read"],
        description: "Agent-facing Microsoft mail and calendar access."
      },
      {
        id: "connector-pipedrive",
        slug: "pipedrive",
        name: "Pipedrive",
        category: "crm",
        backendOptions: ["nango", "composio", "native"],
        authMode: "oauth",
        requiredFields: [{ key: "company_domain", label: "Company domain", example: "example" }],
        scopes: ["deals:read", "contacts:read"],
        description: "CRM deals, people, and activity access."
      },
      {
        id: "connector-haverford-dev-api",
        slug: "haverford-dev-api",
        name: "Haverford Dev API",
        category: "internal",
        backendOptions: ["internal"],
        authMode: "api_key",
        requiredFields: [{ key: "client_id", label: "Client ID" }, { key: "secret_ref", label: "Secret reference", secret: true }],
        scopes: ["brands.read", "shopify.read", "gsc.read"],
        description: "Internal Haverford portfolio data and automation API."
      }
    ],
    connections: [
      { id: "conn-hav-au-shopify", brandId: "brand-haverford", regionId: "region-haverford-au", connectorId: "connector-shopify", backendType: "nango", displayName: "Haverford AU Shopify", status: "connected", configSummary: { shop_domain: "haverford.myshopify.com" }, lastTestedAt: "2026-06-01T00:00:00.000Z", lastUsedAt: "2026-06-01T01:00:00.000Z" },
      { id: "conn-hav-au-ga4", brandId: "brand-haverford", regionId: "region-haverford-au", connectorId: "connector-ga4", backendType: "nango", displayName: "Haverford AU GA4", status: "connected", configSummary: { property_id: "123456789" } },
      { id: "conn-hav-nz-gsc", brandId: "brand-haverford", regionId: "region-haverford-nz", connectorId: "connector-gsc", backendType: "nango", displayName: "Haverford NZ GSC", status: "pending", configSummary: { site_url: "https://haverford.co.nz/" } },
      { id: "conn-cat-au-klaviyo", brandId: "brand-catnets", regionId: "region-catnets-au", connectorId: "connector-klaviyo", backendType: "nango", displayName: "Catnets AU Klaviyo", status: "needs_config", configSummary: { account_id: "not set" } },
      { id: "conn-cat-us-meta", brandId: "brand-catnets", regionId: "region-catnets-us", connectorId: "connector-meta-ads", backendType: "native", displayName: "Catnetting Meta Ads", status: "needs_reconnect", configSummary: { ad_account_id: "act_000" }, lastError: "Token expired" },
      { id: "conn-koenig-shopify", brandId: "brand-koenig", regionId: "region-koenig-au", connectorId: "connector-shopify", backendType: "native", displayName: "Koenig Shopify", status: "connected", configSummary: { shop_domain: "koenig-machinery.myshopify.com" } },
      { id: "conn-koenig-pipedrive", brandId: "brand-koenig", regionId: "region-koenig-au", connectorId: "connector-pipedrive", backendType: "nango", displayName: "Koenig Pipedrive", status: "pending", configSummary: { company_domain: "koenig" } },
      { id: "conn-hav-api", brandId: "brand-haverford", regionId: "region-haverford-au", connectorId: "connector-haverford-dev-api", backendType: "internal", displayName: "Haverford Dev API", status: "connected", configSummary: { client_id: "gateway-admin", secret_ref: "data-volume" } }
    ],
    apiClients: [
      {
        id: "client-marketing-ops",
        name: "Marketing Ops",
        type: "service",
        status: "active",
        scopes: ["brands.read", "connections.read", "audit.read"],
        owner: "ops@haverford.au",
        lastUsedAt: "2026-06-01T02:00:00.000Z",
        requestCount24h: 1240,
        errorRate24h: 0.01,
        keys: [{ id: "key-marketing-primary", label: "Primary", status: "active", preview: "hfdk_...91ab", fingerprint: "91ab27f0cafe", createdAt: "2026-05-01T00:00:00.000Z" }]
      },
      {
        id: "client-shopify-sales",
        name: "Shopify Sales",
        type: "service",
        status: "active",
        scopes: ["brands.read", "connections.read", "connections.write"],
        owner: "sales@haverford.au",
        lastUsedAt: "2026-06-01T01:45:00.000Z",
        requestCount24h: 830,
        errorRate24h: 0.02,
        keys: [{ id: "key-sales-primary", label: "Primary", status: "active", preview: "hfdk_...82bc", fingerprint: "82bc22ac1999", createdAt: "2026-05-02T00:00:00.000Z" }]
      },
      {
        id: "client-agent-gateway",
        name: "Agent Gateway",
        type: "agent",
        status: "active",
        scopes: ["brands.read", "connections.read", "connectors.read"],
        owner: "agents@haverford.au",
        lastUsedAt: "2026-06-01T01:20:00.000Z",
        requestCount24h: 2150,
        errorRate24h: 0.005,
        keys: [{ id: "key-agent-primary", label: "Primary", status: "active", preview: "hfdk_...44dd", fingerprint: "44dd7711ee20", createdAt: "2026-05-03T00:00:00.000Z" }]
      },
      {
        id: "client-reporting-worker",
        name: "Reporting Worker",
        type: "worker",
        status: "active",
        scopes: ["brands.read", "audit.read"],
        owner: "reporting@haverford.au",
        lastUsedAt: "2026-05-31T23:10:00.000Z",
        requestCount24h: 410,
        errorRate24h: 0,
        keys: [{ id: "key-reporting-primary", label: "Primary", status: "active", preview: "hfdk_...75ef", fingerprint: "75ef33bd2221", createdAt: "2026-05-04T00:00:00.000Z" }]
      }
    ],
    auditEvents: [
      { id: "audit-001", timestamp: "2026-06-01T00:00:00.000Z", actor: "fixture", action: "brand.created", targetType: "brand", targetId: "brand-haverford", detail: "Created Haverford brand" },
      { id: "audit-002", timestamp: "2026-06-01T00:01:00.000Z", actor: "fixture", action: "region.created", targetType: "region", targetId: "region-haverford-au", detail: "Added AU region" },
      { id: "audit-003", timestamp: "2026-06-01T00:02:00.000Z", actor: "fixture", action: "connection.saved", targetType: "connection", targetId: "conn-hav-au-shopify", detail: "Saved Shopify connection" },
      { id: "audit-004", timestamp: "2026-06-01T00:03:00.000Z", actor: "fixture", action: "connection.tested", targetType: "connection", targetId: "conn-hav-au-shopify", detail: "Connection test passed" },
      { id: "audit-005", timestamp: "2026-06-01T00:04:00.000Z", actor: "fixture", action: "api_key.rotated", targetType: "api_key", targetId: "key-marketing-primary", detail: "Rotated Marketing Ops key" },
      { id: "audit-006", timestamp: "2026-06-01T00:05:00.000Z", actor: "fixture", action: "api_key.revoked", targetType: "api_key", targetId: "key-reporting-old", detail: "Revoked old Reporting Worker key" }
    ]
  };
}
```

- [ ] **Step 2: Create the fixture backend**

Create `src/admin/fixture-backend.ts`:

```ts
import { createInitialGatewayState } from "./fixtures.js";
import type {
  ApiKey,
  AuditEvent,
  Brand,
  Connection,
  CreateBrandInput,
  CreateConnectionInput,
  CreateRegionInput,
  GatewayConnectionBackend,
  GatewayState,
  Region
} from "./types.js";

function cloneState(state: GatewayState): GatewayState {
  return structuredClone(state);
}

function normalizeSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function assertNonEmpty(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} is required`);
  return trimmed;
}

export class FixtureGatewayBackend implements GatewayConnectionBackend {
  private state: GatewayState;
  private sequence = 100;

  constructor(initialState: GatewayState = createInitialGatewayState()) {
    this.state = cloneState(initialState);
  }

  snapshot(): GatewayState {
    return cloneState(this.state);
  }

  createBrand(input: CreateBrandInput): Brand {
    const slug = normalizeSlug(input.slug);
    const name = assertNonEmpty(input.name, "Brand name");
    if (!slug) throw new Error("Brand slug is required");
    if (this.state.brands.some((brand) => brand.slug === slug)) {
      throw new Error(`Brand slug already exists: ${slug}`);
    }
    const brand: Brand = { id: `brand-${slug}`, slug, name, status: "active" };
    this.state.brands.push(brand);
    this.audit("brand.created", "brand", brand.id, `Created ${brand.name}`);
    return structuredClone(brand);
  }

  createRegion(input: CreateRegionInput): Region {
    const brand = this.state.brands.find((candidate) => candidate.id === input.brandId);
    if (!brand) throw new Error(`Unknown brand: ${input.brandId}`);
    const code = normalizeSlug(input.code);
    const name = assertNonEmpty(input.name, "Region name");
    if (!code) throw new Error("Region code is required");
    if (
      this.state.regions.some(
        (region) => region.brandId === input.brandId && region.code === code
      )
    ) {
      throw new Error(`Region already exists for ${brand.name}: ${code}`);
    }
    const region: Region = {
      id: `region-${brand.slug}-${code}`,
      brandId: brand.id,
      code,
      name,
      domain: input.domain?.trim() || undefined,
      status: "active"
    };
    this.state.regions.push(region);
    this.audit("region.created", "region", region.id, `Added ${region.code.toUpperCase()} to ${brand.name}`);
    return structuredClone(region);
  }

  createConnection(input: CreateConnectionInput): Connection {
    const brand = this.state.brands.find((candidate) => candidate.id === input.brandId);
    if (!brand) throw new Error(`Unknown brand: ${input.brandId}`);
    const region = this.state.regions.find((candidate) => candidate.id === input.regionId);
    if (!region) throw new Error(`Unknown region: ${input.regionId}`);
    if (region.brandId !== brand.id) throw new Error("Region does not belong to brand");
    const connector = this.state.connectors.find((candidate) => candidate.id === input.connectorId);
    if (!connector) throw new Error(`Unknown connector: ${input.connectorId}`);
    if (!connector.backendOptions.includes(input.backendType)) {
      throw new Error(`${connector.name} does not support backend ${input.backendType}`);
    }
    const displayName = assertNonEmpty(input.displayName, "Connection display name");
    const connection: Connection = {
      id: `conn-${++this.sequence}`,
      brandId: brand.id,
      regionId: region.id,
      connectorId: connector.id,
      backendType: input.backendType,
      displayName,
      status: "pending",
      configSummary: input.configSummary ?? {}
    };
    this.state.connections.push(connection);
    this.audit("connection.saved", "connection", connection.id, `Saved ${connector.name} for ${brand.name} ${region.code.toUpperCase()}`);
    return structuredClone(connection);
  }

  testConnection(connectionId: string): Connection {
    const connection = this.findConnection(connectionId);
    connection.status = "connected";
    connection.lastTestedAt = new Date().toISOString();
    connection.lastError = undefined;
    this.audit("connection.tested", "connection", connection.id, `Connection test passed for ${connection.displayName}`);
    return structuredClone(connection);
  }

  rotateApiKey(clientId: string, keyId: string): ApiKey {
    const key = this.findApiKey(clientId, keyId);
    key.status = "active";
    key.rotatedAt = new Date().toISOString();
    key.preview = `hfdk_...${String(++this.sequence).slice(-4).padStart(4, "0")}`;
    key.fingerprint = `mock${this.sequence}fingerprint`.slice(0, 12);
    this.audit("api_key.rotated", "api_key", key.id, `Rotated ${key.label}`);
    return structuredClone(key);
  }

  revokeApiKey(clientId: string, keyId: string): ApiKey {
    const key = this.findApiKey(clientId, keyId);
    key.status = "revoked";
    key.revokedAt = new Date().toISOString();
    this.audit("api_key.revoked", "api_key", key.id, `Revoked ${key.label}`);
    return structuredClone(key);
  }

  private findConnection(connectionId: string): Connection {
    const connection = this.state.connections.find((candidate) => candidate.id === connectionId);
    if (!connection) throw new Error(`Unknown connection: ${connectionId}`);
    return connection;
  }

  private findApiKey(clientId: string, keyId: string): ApiKey {
    const client = this.state.apiClients.find((candidate) => candidate.id === clientId);
    if (!client) throw new Error(`Unknown API client: ${clientId}`);
    const key = client.keys.find((candidate) => candidate.id === keyId);
    if (!key) throw new Error(`Unknown API key: ${keyId}`);
    return key;
  }

  private audit(
    action: AuditEvent["action"],
    targetType: AuditEvent["targetType"],
    targetId: string,
    detail: string
  ): void {
    this.state.auditEvents.unshift({
      id: `audit-${++this.sequence}`,
      timestamp: new Date().toISOString(),
      actor: "local-admin",
      action,
      targetType,
      targetId,
      detail
    });
  }
}
```

- [ ] **Step 3: Expand backend tests**

Replace `test/admin-fixture-backend.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { FixtureGatewayBackend } from "../src/admin/fixture-backend.js";

describe("FixtureGatewayBackend", () => {
  it("starts with multiple brands, regions, connections, connectors, API clients, and audit events", () => {
    const backend = new FixtureGatewayBackend();
    const state = backend.snapshot();

    expect(state.brands.length).toBeGreaterThanOrEqual(3);
    expect(state.regions.length).toBeGreaterThanOrEqual(5);
    expect(state.connectors.length).toBeGreaterThanOrEqual(8);
    expect(state.connections.length).toBeGreaterThanOrEqual(8);
    expect(state.apiClients.length).toBeGreaterThanOrEqual(4);
    expect(state.auditEvents.length).toBeGreaterThanOrEqual(6);
  });

  it("adds a brand and records audit", () => {
    const backend = new FixtureGatewayBackend();
    const brand = backend.createBrand({ slug: "bms-australia", name: "BMS Australia" });
    const state = backend.snapshot();

    expect(brand.slug).toBe("bms-australia");
    expect(state.brands.some((candidate) => candidate.id === brand.id)).toBe(true);
    expect(state.auditEvents[0]).toMatchObject({
      action: "brand.created",
      targetType: "brand",
      targetId: brand.id
    });
  });

  it("adds a region under an existing brand", () => {
    const backend = new FixtureGatewayBackend();
    const brand = backend.snapshot().brands.find((candidate) => candidate.slug === "haverford")!;
    const region = backend.createRegion({
      brandId: brand.id,
      code: "sg",
      name: "Singapore",
      domain: "haverford.sg"
    });

    expect(region).toMatchObject({
      brandId: brand.id,
      code: "sg",
      name: "Singapore",
      domain: "haverford.sg"
    });
  });

  it("adds a connection with a supported backend", () => {
    const backend = new FixtureGatewayBackend();
    const state = backend.snapshot();
    const brand = state.brands.find((candidate) => candidate.slug === "haverford")!;
    const region = state.regions.find((candidate) => candidate.brandId === brand.id)!;
    const connector = state.connectors.find((candidate) => candidate.slug === "pipedrive")!;

    const connection = backend.createConnection({
      brandId: brand.id,
      regionId: region.id,
      connectorId: connector.id,
      backendType: "nango",
      displayName: "Haverford Pipedrive",
      configSummary: { company_domain: "haverford" }
    });

    expect(connection.status).toBe("pending");
    expect(connection.backendType).toBe("nango");
  });

  it("marks a connection connected when tested", () => {
    const backend = new FixtureGatewayBackend();
    const connection = backend.testConnection("conn-hav-nz-gsc");

    expect(connection.status).toBe("connected");
    expect(connection.lastTestedAt).toBeTruthy();
  });

  it("rotates and revokes API keys with audit events", () => {
    const backend = new FixtureGatewayBackend();
    const rotated = backend.rotateApiKey("client-marketing-ops", "key-marketing-primary");
    const revoked = backend.revokeApiKey("client-marketing-ops", "key-marketing-primary");
    const state = backend.snapshot();

    expect(rotated.rotatedAt).toBeTruthy();
    expect(revoked.status).toBe("revoked");
    expect(state.auditEvents[0].action).toBe("api_key.revoked");
    expect(state.auditEvents[1].action).toBe("api_key.rotated");
  });
});
```

- [ ] **Step 4: Run tests**

Run:

```bash
npm test -- test/admin-fixture-backend.test.ts
```

Expected result: pass.

- [ ] **Step 5: Commit**

```bash
git add src/admin/types.ts src/admin/fixtures.ts src/admin/fixture-backend.ts test/admin-fixture-backend.test.ts
git commit -m "feat: add unified gateway fixture backend"
```

---

### Task 3: Add Express Admin Routes And API

**Files:**

- Create: `src/admin/page.ts`
- Create: `src/admin/styles.ts`
- Create: `src/admin/client-script.ts`
- Create: `src/admin/routes.ts`
- Modify: `src/index.ts`
- Test: `test/admin-routes.test.ts`

- [ ] **Step 1: Write failing route tests**

Create `test/admin-routes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/index.js";

const config = {
  composioApiKey: "ak_test",
  brandSlug: "haverford",
  gatewayBearer: "a_secret_thats_long_enough",
  port: 3000,
  sessionTtlSeconds: 3600
};

describe("admin prototype routes", () => {
  it("serves the admin shell", async () => {
    const res = await request(createApp(config)).get("/admin");

    expect(res.status).toBe(200);
    expect(res.text).toContain("Haverford Unified Gateway");
    expect(res.text).toContain("/admin/app.js");
  });

  it("serves fixture state", async () => {
    const res = await request(createApp(config)).get("/admin/api/state");

    expect(res.status).toBe(200);
    expect(res.body.brands.length).toBeGreaterThanOrEqual(3);
    expect(res.body.connectors.length).toBeGreaterThanOrEqual(8);
  });

  it("creates a brand through the API", async () => {
    const app = createApp(config);
    const res = await request(app)
      .post("/admin/api/brands")
      .send({ slug: "bms-australia", name: "BMS Australia" });

    expect(res.status).toBe(201);
    expect(res.body.brand).toMatchObject({ slug: "bms-australia", name: "BMS Australia" });
    expect(res.body.state.brands.some((brand: { slug: string }) => brand.slug === "bms-australia")).toBe(true);
  });

  it("creates a region and connection through the API", async () => {
    const app = createApp(config);
    const state = (await request(app).get("/admin/api/state")).body;
    const brand = state.brands.find((candidate: { slug: string }) => candidate.slug === "haverford");
    const connector = state.connectors.find((candidate: { slug: string }) => candidate.slug === "pipedrive");

    const regionRes = await request(app)
      .post(`/admin/api/brands/${brand.id}/regions`)
      .send({ code: "sg", name: "Singapore", domain: "haverford.sg" });

    expect(regionRes.status).toBe(201);

    const connectionRes = await request(app)
      .post(`/admin/api/regions/${regionRes.body.region.id}/connections`)
      .send({
        brandId: brand.id,
        connectorId: connector.id,
        backendType: "nango",
        displayName: "Haverford Singapore Pipedrive",
        configSummary: { company_domain: "haverford" }
      });

    expect(connectionRes.status).toBe(201);
    expect(connectionRes.body.connection).toMatchObject({
      backendType: "nango",
      status: "pending"
    });
  });
});
```

- [ ] **Step 2: Run the route tests and verify failure**

Run:

```bash
npm test -- test/admin-routes.test.ts
```

Expected result: failure because `/admin` routes are not mounted.

- [ ] **Step 3: Add minimal admin assets**

Create `src/admin/page.ts`:

```ts
export function renderAdminPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Haverford Unified Gateway</title>
    <link rel="stylesheet" href="/admin/style.css" />
  </head>
  <body>
    <div id="app">
      <div class="app-shell">
        <aside class="side-nav">
          <div class="brand-mark">Haverford Gateway</div>
          <button data-view="overview" class="nav-button active">Overview</button>
          <button data-view="brands" class="nav-button">Brands</button>
          <button data-view="connectors" class="nav-button">Connectors</button>
          <button data-view="api-access" class="nav-button">API Access</button>
          <button data-view="audit" class="nav-button">Audit</button>
        </aside>
        <main class="main-panel">
          <header class="page-header">
            <div>
              <p class="eyebrow">Fixture prototype</p>
              <h1>Haverford Unified Gateway</h1>
              <p class="description">Local UI milestone. No real Nango, Composio, OAuth, native connectors, or persistent-volume writes.</p>
            </div>
          </header>
          <section id="content" class="content-panel">Loading...</section>
        </main>
      </div>
    </div>
    <script src="/admin/app.js"></script>
  </body>
</html>`;
}
```

Create `src/admin/styles.ts`:

```ts
export const adminStyles = `
:root {
  color-scheme: light;
  --bg: #f7f8fa;
  --panel: #ffffff;
  --line: #d9dee7;
  --text: #172033;
  --muted: #687386;
  --accent: #2563eb;
  --danger: #b42318;
  --success: #047857;
  --warning: #b45309;
  --radius: 8px;
}
* { box-sizing: border-box; }
body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: var(--bg); color: var(--text); }
button, input, select { font: inherit; }
.app-shell { display: grid; grid-template-columns: 240px minmax(0, 1fr); min-height: 100vh; }
.side-nav { border-right: 1px solid var(--line); background: #fff; padding: 18px 14px; }
.brand-mark { font-weight: 700; margin-bottom: 18px; }
.nav-button { display: block; width: 100%; border: 0; border-radius: 6px; background: transparent; color: var(--muted); text-align: left; padding: 9px 10px; cursor: pointer; }
.nav-button.active, .nav-button:hover { background: #eef4ff; color: var(--accent); }
.main-panel { min-width: 0; padding: 24px; }
.page-header { margin-bottom: 18px; }
.eyebrow { margin: 0 0 4px; color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
h1 { margin: 0; font-size: 26px; }
h2 { margin: 0 0 12px; font-size: 19px; }
h3 { margin: 0 0 6px; font-size: 15px; }
.description { margin: 8px 0 0; color: var(--muted); }
.content-panel { display: grid; gap: 16px; }
.metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.metric, .card { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 14px; }
.metric-value { display: block; font-size: 24px; font-weight: 700; }
.metric-label { color: var(--muted); font-size: 12px; }
.grid { display: grid; gap: 12px; }
.two-col { grid-template-columns: minmax(260px, 360px) minmax(0, 1fr); }
.toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: end; }
.field { display: grid; gap: 4px; }
.field span { color: var(--muted); font-size: 12px; font-weight: 600; }
.field input, .field select { border: 1px solid var(--line); border-radius: 6px; padding: 8px; background: #fff; min-width: 160px; }
.button { border: 1px solid var(--accent); border-radius: 6px; background: var(--accent); color: white; padding: 8px 10px; cursor: pointer; }
.button.secondary { background: white; color: var(--accent); }
.button.danger { border-color: var(--danger); background: white; color: var(--danger); }
.table { width: 100%; border-collapse: collapse; font-size: 14px; }
.table th, .table td { border-bottom: 1px solid var(--line); padding: 8px; text-align: left; vertical-align: top; }
.table th { color: var(--muted); font-size: 12px; text-transform: uppercase; }
.badge { display: inline-flex; border-radius: 999px; padding: 3px 8px; font-size: 12px; background: #eef2f7; color: #334155; }
.badge.connected, .badge.active { background: #ecfdf3; color: var(--success); }
.badge.error, .badge.revoked { background: #fef3f2; color: var(--danger); }
.badge.pending, .badge.needs_config, .badge.needs_reconnect { background: #fffbeb; color: var(--warning); }
.tree-item { border: 1px solid var(--line); border-radius: 6px; padding: 10px; margin-bottom: 8px; background: #fff; cursor: pointer; }
.tree-item.selected { border-color: var(--accent); box-shadow: 0 0 0 2px #dbeafe; }
.muted { color: var(--muted); }
.audit-list { display: grid; gap: 8px; }
.audit-event { border-left: 3px solid var(--accent); padding: 8px 10px; background: #fff; border-radius: 4px; }
@media (max-width: 900px) {
  .app-shell { grid-template-columns: 1fr; }
  .side-nav { display: flex; gap: 8px; overflow-x: auto; border-right: 0; border-bottom: 1px solid var(--line); }
  .brand-mark { min-width: max-content; margin: 0 10px 0 0; align-self: center; }
  .nav-button { width: auto; min-width: max-content; }
  .metrics, .two-col { grid-template-columns: 1fr; }
}
`;
```

Create `src/admin/client-script.ts` with a simple browser script. Keep it dependency-free and use event delegation:

```ts
export const adminClientScript = `
let state = null;
let currentView = "overview";
let selectedBrandId = null;
let setupSelections = {};

const content = document.getElementById("content");

async function api(path, options) {
  const res = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...options,
    body: options && options.body ? JSON.stringify(options.body) : undefined
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function loadState() {
  state = await api("/admin/api/state");
  selectedBrandId = selectedBrandId || state.brands[0]?.id || null;
  render();
}

function byId(list, id) {
  return list.find((item) => item.id === id);
}

function badge(status) {
  return '<span class="badge ' + status + '">' + status + '</span>';
}

function render() {
  document.querySelectorAll(".nav-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === currentView);
  });
  if (currentView === "overview") renderOverview();
  if (currentView === "brands") renderBrands();
  if (currentView === "connectors") renderConnectors();
  if (currentView === "api-access") renderApiAccess();
  if (currentView === "audit") renderAudit();
}

function renderOverview() {
  const connected = state.connections.filter((connection) => connection.status === "connected").length;
  const issues = state.connections.filter((connection) => connection.status === "error" || connection.status === "needs_reconnect").length;
  content.innerHTML = '<section class="metrics">' +
    metric(state.brands.length, "Brands") +
    metric(state.regions.length, "Regions") +
    metric(connected + "/" + state.connections.length, "Connected") +
    metric(issues, "Issues") +
    '</section>' +
    '<section class="card"><h2>Recent audit</h2>' + auditList(state.auditEvents.slice(0, 5)) + '</section>';
}

function metric(value, label) {
  return '<div class="metric"><span class="metric-value">' + value + '</span><span class="metric-label">' + label + '</span></div>';
}

function renderBrands() {
  const selectedBrand = byId(state.brands, selectedBrandId) || state.brands[0];
  const regions = state.regions.filter((region) => region.brandId === selectedBrand.id);
  content.innerHTML =
    '<section class="grid two-col">' +
      '<div class="card"><h2>Brands</h2>' +
        '<form class="toolbar" data-action="create-brand">' +
          '<label class="field"><span>Slug</span><input name="slug" required /></label>' +
          '<label class="field"><span>Name</span><input name="name" required /></label>' +
          '<button class="button" type="submit">Add brand</button>' +
        '</form>' +
        state.brands.map((brand) => '<div class="tree-item ' + (brand.id === selectedBrand.id ? "selected" : "") + '" data-brand-id="' + brand.id + '"><strong>' + brand.name + '</strong><br><span class="muted">' + brand.slug + '</span></div>').join("") +
      '</div>' +
      '<div class="grid">' +
        '<div class="card"><h2>' + selectedBrand.name + '</h2>' +
          '<form class="toolbar" data-action="create-region">' +
            '<label class="field"><span>Code</span><input name="code" required /></label>' +
            '<label class="field"><span>Name</span><input name="name" required /></label>' +
            '<label class="field"><span>Domain</span><input name="domain" /></label>' +
            '<button class="button" type="submit">Add region</button>' +
          '</form>' +
        '</div>' +
        regions.map(renderRegionCard).join("") +
      '</div>' +
    '</section>';
}

function renderRegionCard(region) {
  const connections = state.connections.filter((connection) => connection.regionId === region.id);
  const selectedConnectorId = setupSelections[region.id]?.connectorId || state.connectors[0].id;
  const selectedConnector = byId(state.connectors, selectedConnectorId) || state.connectors[0];
  const connectorOptions = state.connectors.map((connector) => '<option value="' + connector.id + '"' + (connector.id === selectedConnector.id ? " selected" : "") + '>' + connector.name + '</option>').join("");
  const backendOptions = selectedConnector.backendOptions.map((backend) => '<option value="' + backend + '">' + backend + '</option>').join("");
  const requiredFields = selectedConnector.requiredFields.map((field) => '<label class="field"><span>' + field.label + '</span><input name="config_' + field.key + '" ' + (field.secret ? 'type="password"' : 'type="text"') + ' /></label>').join("");
  return '<section class="card"><h2>' + region.code.toUpperCase() + ' · ' + region.name + '</h2>' +
    '<p class="muted">' + (region.domain || "No domain") + '</p>' +
    '<h3>Setup flow</h3>' +
    '<form class="toolbar" data-action="create-connection" data-region-id="' + region.id + '">' +
      '<label class="field"><span>Connector</span><select name="connectorId" data-action="select-setup-connector" data-region-id="' + region.id + '">' + connectorOptions + '</select></label>' +
      '<label class="field"><span>Backend</span><select name="backendType">' + backendOptions + '</select></label>' +
      '<label class="field"><span>Display name</span><input name="displayName" required /></label>' +
      requiredFields +
      '<div class="field"><span>Scope summary</span><span class="muted">' + selectedConnector.scopes.join(", ") + '</span></div>' +
      '<button class="button" type="submit">Save mock connection</button>' +
    '</form>' +
    '<table class="table"><thead><tr><th>Connection</th><th>Connector</th><th>Backend</th><th>Status</th><th>Action</th></tr></thead><tbody>' +
      connections.map((connection) => {
        const connector = byId(state.connectors, connection.connectorId);
        return '<tr><td>' + connection.displayName + '</td><td>' + connector.name + '</td><td>' + connection.backendType + '</td><td>' + badge(connection.status) + '</td><td><button class="button secondary" data-action="test-connection" data-connection-id="' + connection.id + '">Test</button></td></tr>';
      }).join("") +
    '</tbody></table></section>';
}

function renderConnectors() {
  content.innerHTML = '<section class="card"><h2>Connectors</h2><table class="table"><thead><tr><th>Name</th><th>Category</th><th>Auth</th><th>Backends</th><th>Scopes</th></tr></thead><tbody>' +
    state.connectors.map((connector) => '<tr><td><strong>' + connector.name + '</strong><br><span class="muted">' + connector.description + '</span></td><td>' + connector.category + '</td><td>' + connector.authMode + '</td><td>' + connector.backendOptions.join(", ") + '</td><td>' + connector.scopes.join(", ") + '</td></tr>').join("") +
    '</tbody></table></section>';
}

function renderApiAccess() {
  content.innerHTML = '<section class="metrics">' +
    metric(state.apiClients.filter((client) => client.status === "active").length, "Active clients") +
    metric(state.apiClients.flatMap((client) => client.keys).filter((key) => key.status === "active").length, "Active keys") +
    metric(state.apiClients.reduce((sum, client) => sum + client.requestCount24h, 0), "Requests 24h") +
    metric(state.apiClients.filter((client) => client.errorRate24h > 0.01).length, "Clients with errors") +
    '</section><section class="card"><h2>API clients</h2><table class="table"><thead><tr><th>Client</th><th>Scopes</th><th>Usage</th><th>Keys</th></tr></thead><tbody>' +
    state.apiClients.map((client) => '<tr><td><strong>' + client.name + '</strong><br><span class="muted">' + client.owner + '</span></td><td>' + client.scopes.join(", ") + '</td><td>' + client.requestCount24h + ' requests<br><span class="muted">' + Math.round(client.errorRate24h * 1000) / 10 + '% errors</span></td><td>' + client.keys.map((key) => key.label + ' ' + badge(key.status) + ' <button class="button secondary" data-action="rotate-key" data-client-id="' + client.id + '" data-key-id="' + key.id + '">Rotate</button> <button class="button danger" data-action="revoke-key" data-client-id="' + client.id + '" data-key-id="' + key.id + '">Revoke</button>').join("<br>") + '</td></tr>').join("") +
    '</tbody></table></section>';
}

function renderAudit() {
  content.innerHTML = '<section class="card"><h2>Audit history</h2>' + auditList(state.auditEvents) + '</section>';
}

function auditList(events) {
  return '<div class="audit-list">' + events.map((event) => '<div class="audit-event"><strong>' + event.action + '</strong> <span class="muted">' + event.timestamp + '</span><br>' + event.detail + '</div>').join("") + '</div>';
}

document.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const nav = target.closest(".nav-button");
  if (nav) {
    currentView = nav.dataset.view;
    render();
    return;
  }
  const brand = target.closest("[data-brand-id]");
  if (brand) {
    selectedBrandId = brand.dataset.brandId;
    render();
    return;
  }
  const action = target.dataset.action;
  if (action === "test-connection") {
    await api("/admin/api/connections/" + target.dataset.connectionId + "/test", { method: "POST" });
    await loadState();
  }
  if (action === "rotate-key") {
    await api("/admin/api/api-clients/" + target.dataset.clientId + "/keys/" + target.dataset.keyId + "/rotate", { method: "POST" });
    await loadState();
  }
  if (action === "revoke-key") {
    await api("/admin/api/api-clients/" + target.dataset.clientId + "/keys/" + target.dataset.keyId + "/revoke", { method: "POST" });
    await loadState();
  }
});

document.addEventListener("submit", async (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  const action = form.dataset.action;
  if (!action) return;
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());
  if (action === "create-brand") {
    await api("/admin/api/brands", { method: "POST", body: data });
  }
  if (action === "create-region") {
    await api("/admin/api/brands/" + selectedBrandId + "/regions", { method: "POST", body: data });
  }
  if (action === "create-connection") {
    await api("/admin/api/regions/" + form.dataset.regionId + "/connections", {
      method: "POST",
      body: { ...data, brandId: selectedBrandId, configSummary: configSummaryFromForm(data) }
    });
  }
  form.reset();
  await loadState();
});

document.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLSelectElement)) return;
  if (target.dataset.action !== "select-setup-connector") return;
  setupSelections[target.dataset.regionId] = { connectorId: target.value };
  render();
});

function configSummaryFromForm(data) {
  const configSummary = {};
  Object.entries(data).forEach(([key, value]) => {
    if (key.startsWith("config_")) {
      const summaryKey = key.replace("config_", "");
      configSummary[summaryKey] = String(value || "fixture value");
    }
  });
  return Object.keys(configSummary).length ? configSummary : { mode: "fixture" };
}

loadState().catch((err) => {
  content.innerHTML = '<section class="card"><h2>Failed to load prototype</h2><p class="muted">' + err.message + '</p></section>';
});
`;
```

- [ ] **Step 4: Add admin routes**

Create `src/admin/routes.ts`:

```ts
import express from "express";
import { FixtureGatewayBackend } from "./fixture-backend.js";
import { adminClientScript } from "./client-script.js";
import { renderAdminPage } from "./page.js";
import { adminStyles } from "./styles.js";

export function createAdminRouter(backend = new FixtureGatewayBackend()) {
  const router = express.Router();
  router.use(express.json({ limit: "256kb" }));

  router.get("/", (_req, res) => {
    res.type("html").send(renderAdminPage());
  });

  router.get("/style.css", (_req, res) => {
    res.type("css").send(adminStyles);
  });

  router.get("/app.js", (_req, res) => {
    res.type("application/javascript").send(adminClientScript);
  });

  router.get("/api/state", (_req, res) => {
    res.json(backend.snapshot());
  });

  router.post("/api/brands", (req, res, next) => {
    try {
      const brand = backend.createBrand({
        slug: String(req.body?.slug ?? ""),
        name: String(req.body?.name ?? "")
      });
      res.status(201).json({ brand, state: backend.snapshot() });
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/brands/:brandId/regions", (req, res, next) => {
    try {
      const region = backend.createRegion({
        brandId: req.params.brandId,
        code: String(req.body?.code ?? ""),
        name: String(req.body?.name ?? ""),
        domain: typeof req.body?.domain === "string" ? req.body.domain : undefined
      });
      res.status(201).json({ region, state: backend.snapshot() });
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/regions/:regionId/connections", (req, res, next) => {
    try {
      const connection = backend.createConnection({
        brandId: String(req.body?.brandId ?? ""),
        regionId: req.params.regionId,
        connectorId: String(req.body?.connectorId ?? ""),
        backendType: req.body?.backendType,
        displayName: String(req.body?.displayName ?? ""),
        configSummary:
          req.body?.configSummary && typeof req.body.configSummary === "object"
            ? req.body.configSummary
            : {}
      });
      res.status(201).json({ connection, state: backend.snapshot() });
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/connections/:connectionId/test", (req, res, next) => {
    try {
      const connection = backend.testConnection(req.params.connectionId);
      res.json({ connection, state: backend.snapshot() });
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/api-clients/:clientId/keys/:keyId/rotate", (req, res, next) => {
    try {
      const key = backend.rotateApiKey(req.params.clientId, req.params.keyId);
      res.json({ key, state: backend.snapshot() });
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/api-clients/:clientId/keys/:keyId/revoke", (req, res, next) => {
    try {
      const key = backend.revokeApiKey(req.params.clientId, req.params.keyId);
      res.json({ key, state: backend.snapshot() });
    } catch (error) {
      next(error);
    }
  });

  router.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(400).json({ error: err.message });
  });

  return router;
}
```

- [ ] **Step 5: Mount the admin router**

Modify `src/index.ts` to import and mount the router:

```ts
import { createAdminRouter } from "./admin/routes.js";
```

Then add this after the `/health` route and before the MCP router:

```ts
  app.use("/admin", createAdminRouter());
```

- [ ] **Step 6: Run route tests**

Run:

```bash
npm test -- test/admin-routes.test.ts
```

Expected result: pass.

- [ ] **Step 7: Run existing tests**

Run:

```bash
npm test
```

Expected result: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/admin/page.ts src/admin/styles.ts src/admin/client-script.ts src/admin/routes.ts src/index.ts test/admin-routes.test.ts
git commit -m "feat: add unified gateway admin prototype routes"
```

---

### Task 4: Add Setup Flow Cues And Lifecycle Coverage

**Files:**

- Modify: `test/admin-routes.test.ts`
- Modify: `src/admin/client-script.ts`

- [ ] **Step 1: Add tests for setup-flow markers and lifecycle routes**

Append to `test/admin-routes.test.ts`:

```ts
  it("serves setup-flow markers in the browser script", async () => {
    const res = await request(createApp(config)).get("/admin/app.js");

    expect(res.status).toBe(200);
    expect(res.text).toContain("Setup flow");
    expect(res.text).toContain("Scope summary");
    expect(res.text).toContain('data-action="select-setup-connector"');
    expect(res.text).toContain("Save mock connection");
  });

  it("tests a connection and rotates and revokes a mock key", async () => {
    const app = createApp(config);

    const testRes = await request(app).post("/admin/api/connections/conn-hav-nz-gsc/test").send({});
    expect(testRes.status).toBe(200);
    expect(testRes.body.connection.status).toBe("connected");

    const rotateRes = await request(app)
      .post("/admin/api/api-clients/client-marketing-ops/keys/key-marketing-primary/rotate")
      .send({});
    expect(rotateRes.status).toBe(200);
    expect(rotateRes.body.key.rotatedAt).toBeTruthy();

    const revokeRes = await request(app)
      .post("/admin/api/api-clients/client-marketing-ops/keys/key-marketing-primary/revoke")
      .send({});
    expect(revokeRes.status).toBe(200);
    expect(revokeRes.body.key.status).toBe("revoked");
  });
```

- [ ] **Step 2: Run the lifecycle test**

Run:

```bash
npm test -- test/admin-routes.test.ts
```

Expected result: pass because Task 3 added the routes.

- [ ] **Step 3: Verify the UI has setup and lifecycle action controls**

Open `src/admin/client-script.ts` and verify these button selectors exist in rendered markup:

```js
data-action="select-setup-connector"
data-action="test-connection"
data-action="rotate-key"
data-action="revoke-key"
```

Also verify these visible labels exist in the setup area:

```js
Setup flow
Scope summary
Save mock connection
```

If any selector or label is missing, add it exactly as in Task 3.

- [ ] **Step 4: Commit**

```bash
git add test/admin-routes.test.ts src/admin/client-script.ts
git commit -m "test: cover unified gateway setup and lifecycle actions"
```

---

### Task 5: Document And Locally Verify The Prototype

**Files:**

- Modify: `README.md`

- [ ] **Step 1: Add local prototype docs**

Add this section to `README.md` after the existing quick start shell block and before the paragraph that starts `To use the gateway from a Hermes profile`:

````md
## Local admin UI prototype

The Haverford Unified Gateway admin prototype is available at:

```bash
npm run dev
open http://localhost:3000/admin
```

This milestone is fixture-data only. It proves the operator workflow before backend integration:

- add brands
- add regions under brands
- add connections under brand/region
- review connector backend options (`nango`, `composio`, `native`, `internal`)
- view API clients
- rotate and revoke mock keys
- view mock usage and audit history

The prototype does not call Nango, Composio, OAuth providers, native connectors, or persistent-volume storage.

For deployment/backend phases, the source of truth must be persistent app data on the mounted volume, not deployment environment variables. Coolify env vars should stay limited to bootstrap/runtime inputs such as app secrets, Auth-Gate URL, initial admin/bootstrap token, and global provider credentials where required.
````

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected result: pass.

- [ ] **Step 3: Run build**

Run:

```bash
npm run build
```

Expected result: pass and `dist/admin/*` TypeScript outputs are generated.

- [ ] **Step 4: Run all tests**

Run:

```bash
npm test
```

Expected result: all tests pass.

- [ ] **Step 5: Run the local server**

Run:

```bash
COMPOSIO_API_KEY=ak_test BRAND_SLUG=haverford GATEWAY_BEARER=a_secret_thats_long_enough npm run dev
```

Expected result:

```text
[gateway] brand=haverford listening on :3000 (TTL 3600s)
```

- [ ] **Step 6: Manually verify the UI**

Open:

```bash
open http://localhost:3000/admin
```

Verify:

- Overview renders metrics.
- Brands view shows multiple brands.
- Adding a brand updates the UI.
- Adding a region under a brand updates the UI.
- Adding a connection under a region updates the UI.
- Testing a connection changes it to `connected`.
- API Access renders clients and keys.
- Rotating a key updates fingerprint/preview.
- Revoking a key changes it to `revoked`.
- Audit view shows newly-created events.

- [ ] **Step 7: Commit**

```bash
git add README.md
git commit -m "docs: document unified gateway admin prototype"
```

---

### Task 6: Final Pre-PR Verification

**Files:**

- No file changes expected.

- [ ] **Step 1: Confirm branch and issue context**

Run:

```bash
git branch --show-current
```

Expected result:

```text
epic/19-haverford-unified-gateway
```

- [ ] **Step 2: Confirm clean worktree**

Run:

```bash
git status --short
```

Expected result: no output.

- [ ] **Step 3: Run complete verification**

Run:

```bash
npm run typecheck
npm run build
npm test
```

Expected result: all commands pass.

- [ ] **Step 4: Summarize verification**

Record these in the final handoff:

- Typecheck result.
- Build result.
- Test result.
- Local manual UI result.
- Any limitations, especially that Nango/Composio/native/persistent-volume backends are intentionally not wired.

- [ ] **Step 5: Commit only if new verification docs were added**

If no files changed, do not create a commit.

---

## Spec Coverage Check

This plan covers:

- Multiple brands: Task 2 fixtures and Task 3/5 UI/API.
- Multiple regions per brand: Task 2 fixtures and Task 3/5 UI/API.
- Multiple connections per brand/region: Task 2 fixtures and Task 3/5 UI/API.
- Clear hierarchy: Task 3 brand/region UI.
- Connection setup flow: Task 3 setup panel with connector selection, supported backend choices, required fields, scope summary, mock save, and test action.
- Operational admin tool feel: Task 3 CSS and layout.
- API clients, keys/tokens, scopes, usage, rotation, revocation, audit: Task 2 fixtures, Task 3 UI, Task 4 routes/tests.
- No backend wiring: Scope boundary and README docs.
- Persistent-volume source-of-truth caveat for backend phase: Task 5 README docs and design spec.

## Execution Notes

- Implement in the clean worktree on `epic/19-haverford-unified-gateway` or create a task branch from it if preferred.
- Keep the current dirty checkout at `00_repos/template-gateway` untouched.
- Do not add React, Vite, Refine, React Admin, Nango, ACI, Obot, or new runtime dependencies for this milestone.
- Do not open a PR until verification passes.
