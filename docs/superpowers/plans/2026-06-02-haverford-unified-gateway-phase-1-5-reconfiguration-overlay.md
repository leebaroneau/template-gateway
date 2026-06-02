# Haverford Unified Gateway Phase 1.5 Reconfiguration Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persistent gateway-owned reconfiguration overlays and gateway-owned brand/region/connection creates while Dev API remains the read-through source.

**Architecture:** Add an `OverlayGatewayBackend` that wraps `FixtureGatewayBackend` or `DevApiGatewayBackend`, then merges source state with `/data/gateway.sqlite` records and overrides. Existing admin routes remain the UI boundary, with additive update/reset methods and additive `entityMeta` provenance in `GatewayState`.

**Tech Stack:** TypeScript, Express, Vitest, Supertest, `better-sqlite3`, existing admin UI string renderer.

---

## Scope Check

This plan implements only Phase 1.5 from the approved design spec:

- Persistent overlay store.
- Gateway-owned brand/region/connection creates.
- Update/reset routes.
- UI source badges and edit drawer.
- Local fixture-overlay and dev-api-overlay testing.

It does not implement real OAuth, Nango, Composio account mutation, native connector execution, MCP read gateway behavior, app dashboards, or API access persistence.

## File Structure

- `package.json`, `package-lock.json`: add `better-sqlite3` and `@types/better-sqlite3`.
- `src/config.ts`: add `fixture-overlay`, `dev-api-overlay`, and `GATEWAY_STORE_PATH`.
- `.env.example`, `README.md`: document overlay modes and local verification commands.
- `src/admin/types.ts`: add source metadata, update inputs, reset input, and backend methods.
- `src/admin/input-validation.ts`: extract reusable text, slug, region, and config-summary validation from fixture backend.
- `src/admin/fixture-backend.ts`: import shared validation and implement in-memory update/reset methods required by the expanded backend interface.
- `src/admin/overlay-store.ts`: own SQLite schema, migrations, row mapping, CRUD for gateway records, overrides, and audit.
- `src/admin/overlay-backend.ts`: own source/overlay merge logic, validation against visible state, create/update/reset behavior, mock connection tests, and audit writes.
- `src/admin/backend-factory.ts`: select overlay backend when `ADMIN_DATA_SOURCE` is an overlay mode.
- `src/admin/routes.ts`: add `PATCH` routes and reset route.
- `src/admin/client-script.ts`: add edit drawer state, source badges, update/reset calls, and JSON config summary editing.
- `src/admin/styles.ts`: add source badge, drawer, textarea, and compact action styles.
- `test/admin-input-validation.test.ts`: focused config sanitizer tests.
- `test/admin-overlay-store.test.ts`: persistent SQLite store tests.
- `test/admin-overlay-backend.test.ts`: source merge, gateway creates, imported overrides, reset, and persistence tests.
- `test/admin-routes.test.ts`: route coverage for patch/reset and UI asset assertions.
- `test/admin-backend-factory.test.ts`, `test/config.test.ts`: config/factory coverage.

---

### Task 1: Add Overlay Config And Dependency

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/config.ts`
- Modify: `test/config.test.ts`
- Modify: `.env.example`

- [ ] **Step 1: Install SQLite package**

Run:

```bash
npm install better-sqlite3
npm install -D @types/better-sqlite3
```

Expected: `package.json` contains `better-sqlite3` in `dependencies` and `@types/better-sqlite3` in `devDependencies`; `package-lock.json` is updated.

- [ ] **Step 2: Write failing config tests**

Add these tests to `test/config.test.ts`:

```ts
  it("parses overlay admin data source settings with a store path", () => {
    const cfg = loadConfig({
      COMPOSIO_API_KEY: "ak_test",
      BRAND_SLUG: "haverford",
      GATEWAY_BEARER: "a_secret_thats_long_enough",
      ADMIN_DATA_SOURCE: "dev-api-overlay",
      GATEWAY_STORE_PATH: " ./data/test-gateway.sqlite ",
      HAVERFORD_DEV_API_BASE_URL: "https://dev-api.haverford.au",
      HAVERFORD_DEV_API_CLIENT_ID: "gateway-admin",
      HAVERFORD_DEV_API_CLIENT_SECRET: "secret"
    });

    expect(cfg.adminDataSource).toBe("dev-api-overlay");
    expect(cfg.gatewayStorePath).toBe("./data/test-gateway.sqlite");
  });

  it("uses a local gateway store path default for overlay modes", () => {
    const cfg = loadConfig({
      COMPOSIO_API_KEY: "ak_test",
      BRAND_SLUG: "haverford",
      GATEWAY_BEARER: "a_secret_thats_long_enough",
      ADMIN_DATA_SOURCE: "fixture-overlay"
    });

    expect(cfg.adminDataSource).toBe("fixture-overlay");
    expect(cfg.gatewayStorePath).toBe("./data/gateway.sqlite");
  });
```

In the `beforeEach` block, add:

```ts
    delete process.env.GATEWAY_STORE_PATH;
```

- [ ] **Step 3: Run config tests and verify failure**

Run:

```bash
npm test -- test/config.test.ts
```

Expected: FAIL with `ADMIN_DATA_SOURCE must be fixture or dev-api` and/or missing `gatewayStorePath`.

- [ ] **Step 4: Implement config parsing**

Modify `src/config.ts`:

```ts
export type AdminDataSource = "fixture" | "dev-api" | "fixture-overlay" | "dev-api-overlay";

export interface GatewayConfig {
  composioApiKey: string;
  composioProjectId?: string;
  brandSlug: string;
  gatewayBearer: string;
  toolkitAllowlist?: string[];
  authConfigs?: Record<string, string>;
  port: number;
  sessionTtlSeconds: number;
  adminDataSource: AdminDataSource;
  gatewayStorePath: string;
  haverfordDevApiBaseUrl?: string;
  haverfordDevApiClientId?: string;
  haverfordDevApiClientSecret?: string;
}

function parseAdminDataSource(raw?: string): AdminDataSource {
  if (!raw) return "fixture";
  const value = raw.trim().toLowerCase();
  if (value === "fixture" || value === "dev-api" || value === "fixture-overlay" || value === "dev-api-overlay") {
    return value;
  }
  throw new Error(`ADMIN_DATA_SOURCE must be fixture, dev-api, fixture-overlay, or dev-api-overlay (got ${raw})`);
}

function parseGatewayStorePath(env: NodeJS.ProcessEnv, dataSource: AdminDataSource): string {
  const configured = optionalEnv(env, "GATEWAY_STORE_PATH");
  if (configured) {
    return configured;
  }
  if (dataSource === "fixture-overlay" || dataSource === "dev-api-overlay") {
    return "./data/gateway.sqlite";
  }
  return "./data/gateway.sqlite";
}
```

Update `loadConfig` so `adminDataSource` is parsed once:

```ts
export function loadConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const adminDataSource = parseAdminDataSource(env.ADMIN_DATA_SOURCE);
  return {
    composioApiKey: requireEnv(env, "COMPOSIO_API_KEY"),
    composioProjectId: optionalEnv(env, "COMPOSIO_PROJECT_ID"),
    brandSlug: requireEnv(env, "BRAND_SLUG"),
    gatewayBearer: requireEnv(env, "GATEWAY_BEARER"),
    toolkitAllowlist: parseToolkitAllowlist(env.TOOLKIT_ALLOWLIST),
    authConfigs: parseAuthConfigs(env.AUTH_CONFIGS),
    port: parsePort(env.PORT),
    sessionTtlSeconds: parseSessionTtl(env.SESSION_TTL_SECONDS),
    adminDataSource,
    gatewayStorePath: parseGatewayStorePath(env, adminDataSource),
    haverfordDevApiBaseUrl: optionalEnv(env, "HAVERFORD_DEV_API_BASE_URL"),
    haverfordDevApiClientId: optionalEnv(env, "HAVERFORD_DEV_API_CLIENT_ID"),
    haverfordDevApiClientSecret: optionalEnv(env, "HAVERFORD_DEV_API_CLIENT_SECRET")
  };
}
```

Update test helpers that construct `GatewayConfig` directly so they include:

```ts
gatewayStorePath: "./data/gateway.sqlite"
```

- [ ] **Step 5: Document env vars**

In `.env.example`, add near `ADMIN_DATA_SOURCE`:

```bash
# Overlay modes persist gateway-owned edits and creates to SQLite.
# Local testing: ./data/gateway.sqlite
# Coolify deployment with persistent volume: /data/gateway.sqlite
GATEWAY_STORE_PATH=./data/gateway.sqlite
```

Ensure the admin data source comment includes:

```bash
# ADMIN_DATA_SOURCE options: fixture, dev-api, fixture-overlay, dev-api-overlay
```

- [ ] **Step 6: Run config tests**

Run:

```bash
npm test -- test/config.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add package.json package-lock.json src/config.ts test/config.test.ts .env.example
git commit -m "feat: configure admin overlay data sources"
```

---

### Task 2: Extract Shared Admin Input Validation

**Files:**
- Create: `src/admin/input-validation.ts`
- Create: `test/admin-input-validation.test.ts`
- Modify: `src/admin/fixture-backend.ts`

- [ ] **Step 1: Write failing validation tests**

Create `test/admin-input-validation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  normalizeRegionCode,
  normalizeSlug,
  sanitizeConnectionConfig,
  sanitizePartialConfigSummary
} from "../src/admin/input-validation.js";
import type { Connector } from "../src/admin/types.js";

const shopifyConnector: Connector = {
  id: "connector_shopify",
  slug: "shopify",
  name: "Shopify",
  category: "commerce",
  authMode: "oauth",
  backendOptions: ["nango", "native"],
  requiredFields: [
    { key: "shop_domain", label: "Shop domain" },
    { key: "access_token", label: "Access token", secret: true }
  ],
  scopes: ["orders:read"],
  description: "Shopify test connector."
};

describe("admin input validation", () => {
  it("normalizes slugs and region codes", () => {
    expect(normalizeSlug("Koenig Machinery", "Brand name")).toBe("koenig-machinery");
    expect(normalizeRegionCode(" au ")).toBe("AU");
  });

  it("sanitizes required connector config without echoing raw secrets", () => {
    const sanitized = sanitizeConnectionConfig(shopifyConnector, {
      shop_domain: "koenig.myshopify.com",
      access_token: "shpat_raw_secret",
      access_token_ref: "vault://shopify/koenig"
    });

    expect(sanitized).toEqual({
      shop_domain: "koenig.myshopify.com",
      access_token_ref: "fixture-redacted:access_token"
    });
    expect(JSON.stringify(sanitized)).not.toContain("shpat_raw_secret");
    expect(JSON.stringify(sanitized)).not.toContain("vault://shopify/koenig");
  });

  it("rejects unsafe partial config summary keys", () => {
    expect(() =>
      sanitizePartialConfigSummary({
        property_id: "properties/123",
        refresh_token: "raw-refresh-token"
      })
    ).toThrow(/Unsafe config field: refresh_token/);
  });

  it("keeps safe partial config summary keys as trimmed strings", () => {
    expect(
      sanitizePartialConfigSummary({
        property_id: " properties/123 ",
        credential_ref: " gateway:google/default ",
        empty: " "
      })
    ).toEqual({
      property_id: "properties/123",
      credential_ref: "gateway:google/default"
    });
  });
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
npm test -- test/admin-input-validation.test.ts
```

Expected: FAIL because `src/admin/input-validation.ts` does not exist.

- [ ] **Step 3: Create validation module**

Create `src/admin/input-validation.ts`:

```ts
import type { Connector } from "./types.js";

const forbiddenRawSecretKeys = new Set([
  "accesstoken",
  "clientsecret",
  "refreshtoken",
  "authorization",
  "bearer",
  "password",
  "privateapikey",
  "serviceaccounttoken"
]);

export function requireText(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} is required`);
  }
  return trimmed;
}

export function optionalText(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function normalizeSlug(raw: unknown, label: string): string {
  return requireText(raw, label)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizeRegionCode(raw: unknown): string {
  return requireText(raw, "Region code")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function safeReferenceKeysFor(fieldKey: string): string[] {
  return [`${fieldKey}_ref`, "credential_ref"].filter(
    (key, index, keys) => key !== fieldKey && keys.indexOf(key) === index
  );
}

function normalizeConfigKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

export function isForbiddenRawSecretKey(key: string): boolean {
  return forbiddenRawSecretKeys.has(normalizeConfigKey(key));
}

function allowedConfigKeysFor(connector: Connector): Set<string> {
  const allowed = new Set<string>();
  for (const field of connector.requiredFields) {
    if (!field.secret) {
      allowed.add(field.key);
    }
  }
  return allowed;
}

function firstNonEmptyConfigValue(
  connector: Connector,
  configSummary: Record<string, unknown>,
  keys: string[]
): { key: string; value: string } | undefined {
  for (const key of keys) {
    const value = configSummary[key];
    if (typeof value !== "string") {
      if (Object.prototype.hasOwnProperty.call(configSummary, key)) {
        throw new Error(`Connector ${connector.slug} requires config field ${key} to be a string`);
      }
      continue;
    }
    const trimmed = value.trim();
    if (trimmed) {
      return { key, value: trimmed };
    }
  }
  return undefined;
}

function requiredConfigValue(connector: Connector, configSummary: Record<string, unknown>, key: string): string {
  const value = configSummary[key];
  if (typeof value !== "string") {
    if (Object.prototype.hasOwnProperty.call(configSummary, key)) {
      throw new Error(`Connector ${connector.slug} requires config field ${key} to be a string`);
    }
    throw new Error(`Connector ${connector.slug} requires config field: ${key}`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Connector ${connector.slug} requires config field: ${key}`);
  }
  return trimmed;
}

function optionalConfigValue(
  connector: Connector,
  configSummary: Record<string, unknown>,
  key: string
): string | undefined {
  const value = configSummary[key];
  if (typeof value !== "string") {
    if (Object.prototype.hasOwnProperty.call(configSummary, key)) {
      throw new Error(`Connector ${connector.slug} requires config field ${key} to be a string`);
    }
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function sanitizeConnectionConfig(
  connector: Connector,
  configSummary: Record<string, unknown> | undefined
): Record<string, string> {
  const input = configSummary ?? {};
  const sanitized: Record<string, string> = {};
  const allowedConfigKeys = allowedConfigKeysFor(connector);

  for (const [key, value] of Object.entries(input)) {
    if (typeof value !== "string") {
      continue;
    }
    const trimmed = value.trim();
    if (!trimmed || !allowedConfigKeys.has(key) || isForbiddenRawSecretKey(key)) {
      continue;
    }
    sanitized[key] = trimmed;
  }

  for (const field of connector.requiredFields) {
    if (field.secret) {
      const safeReference = firstNonEmptyConfigValue(connector, input, safeReferenceKeysFor(field.key));
      if (safeReference) {
        sanitized[`${field.key}_ref`] = `fixture-redacted:${field.key}`;
        continue;
      }
      const rawSecret = optionalConfigValue(connector, input, field.key);
      if (rawSecret) {
        sanitized[`${field.key}_ref`] = `fixture-redacted:${field.key}`;
        continue;
      }
      throw new Error(`Connector ${connector.slug} requires secret config reference: ${field.key}`);
    }

    const value = requiredConfigValue(connector, input, field.key);
    if (isForbiddenRawSecretKey(field.key)) {
      throw new Error(`Connector ${connector.slug} requires unsafe config field: ${field.key}`);
    }
    sanitized[field.key] = value;
  }

  return sanitized;
}

export function sanitizePartialConfigSummary(configSummary: Record<string, unknown> | undefined): Record<string, string> {
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(configSummary ?? {})) {
    if (isForbiddenRawSecretKey(key)) {
      throw new Error(`Unsafe config field: ${key}`);
    }
    if (typeof value !== "string") {
      throw new Error(`Config field ${key} must be a string`);
    }
    const trimmed = value.trim();
    if (trimmed) {
      sanitized[key] = trimmed;
    }
  }
  return sanitized;
}
```

- [ ] **Step 4: Update fixture backend imports**

In `src/admin/fixture-backend.ts`, import:

```ts
import {
  normalizeRegionCode,
  normalizeSlug,
  optionalText,
  requireText,
  sanitizeConnectionConfig
} from "./input-validation.js";
```

Delete the private copies of these functions from `fixture-backend.ts`:

- `requireText`
- `optionalText`
- `normalizeSlug`
- `normalizeRegionCode`
- `forbiddenRawSecretKeys`
- `safeReferenceKeysFor`
- `normalizeConfigKey`
- `isForbiddenRawSecretKey`
- `allowedConfigKeysFor`
- `firstNonEmptyConfigValue`
- `requiredConfigValue`
- `optionalConfigValue`
- `sanitizeConnectionConfig`

- [ ] **Step 5: Run targeted tests**

Run:

```bash
npm test -- test/admin-input-validation.test.ts test/admin-routes.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/admin/input-validation.ts src/admin/fixture-backend.ts test/admin-input-validation.test.ts
git commit -m "refactor: share admin input validation"
```

---

### Task 3: Expand Admin Backend Types And In-Memory Updates

**Files:**
- Modify: `src/admin/types.ts`
- Modify: `src/admin/fixture-backend.ts`
- Modify: `src/admin/dev-api-backend.ts`
- Modify: `test/admin-routes.test.ts`
- Modify: `test/admin-dev-api-backend.test.ts`

- [ ] **Step 1: Add failing route-oriented backend type coverage**

Update the `asyncBackendFromFixture` helper in `test/admin-routes.test.ts` after the existing `createConnection` method:

```ts
    updateBrand: async (brandId, input) => fixture.updateBrand(brandId, input),
    updateRegion: async (regionId, input) => fixture.updateRegion(regionId, input),
    updateConnection: async (connectionId, input) => fixture.updateConnection(connectionId, input),
    resetEntity: async (input) => fixture.resetEntity(input),
```

Update every hand-written `GatewayConnectionBackend` test object with these methods:

```ts
      updateBrand: async () => {
        throw new Error("unused");
      },
      updateRegion: async () => {
        throw new Error("unused");
      },
      updateConnection: async () => {
        throw new Error("unused");
      },
      resetEntity: async () => {
        throw new Error("unused");
      },
```

Add this test to `test/admin-routes.test.ts`:

```ts
  it("updates fixture brands, regions, and connections in memory", async () => {
    const { backend } = buildAdminApp();
    const brand = backend.updateBrand("brand_haverford", { name: "Haverford Updated", status: "disabled" });
    const region = backend.updateRegion("region_haverford_au", { name: "Australia Updated", domain: "updated.example" });
    const connection = backend.updateConnection("connection_haverford_au_outlook", {
      displayName: "Updated Outlook",
      status: "needs_config",
      configSummary: { mailbox: "updated@example.com" }
    });

    expect(brand).toMatchObject({ name: "Haverford Updated", status: "disabled" });
    expect(region).toMatchObject({ name: "Australia Updated", domain: "updated.example" });
    expect(connection).toMatchObject({
      displayName: "Updated Outlook",
      status: "needs_config",
      configSummary: { mailbox: "updated@example.com" }
    });
  });
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npm test -- test/admin-routes.test.ts test/admin-dev-api-backend.test.ts
```

Expected: FAIL because the backend interface and concrete classes do not expose update/reset methods.

- [ ] **Step 3: Expand admin types**

Modify `src/admin/types.ts`:

```ts
export type GatewayEntitySource = "dev_api" | "gateway" | "fixture";
export type GatewayEntityType = "brand" | "region" | "connection";
export type AuditAction =
  | "brand.created"
  | "brand.updated"
  | "region.created"
  | "region.updated"
  | "connection.saved"
  | "connection.updated"
  | "connection.tested"
  | "entity.reset"
  | "api_key.rotated"
  | "api_key.revoked";
```

Add below `AuditEvent`:

```ts
export interface GatewayEntityMeta {
  entityType: GatewayEntityType;
  entityId: string;
  source: GatewayEntitySource;
  hasOverride: boolean;
  overrideFields: string[];
  sourceLabel: string;
  updatedAt?: string;
  updatedBy?: string;
}
```

Add `entityMeta` to `GatewayState`:

```ts
  entityMeta?: GatewayEntityMeta[];
```

Add update/reset inputs after create inputs:

```ts
export interface UpdateBrandInput {
  name?: string;
  slug?: string;
  status?: EntityStatus;
}

export interface UpdateRegionInput {
  code?: string;
  name?: string;
  domain?: string;
  status?: EntityStatus;
}

export interface UpdateConnectionInput {
  backendType?: GatewayBackendType;
  displayName?: string;
  status?: ConnectionStatus;
  configSummary?: Record<string, unknown>;
  lastError?: string | null;
}

export interface ResetEntityInput {
  entityType: GatewayEntityType;
  entityId: string;
}
```

Add methods to `GatewayConnectionBackend`:

```ts
  updateBrand(brandId: string, input: UpdateBrandInput): MaybePromise<Brand>;
  updateRegion(regionId: string, input: UpdateRegionInput): MaybePromise<Region>;
  updateConnection(connectionId: string, input: UpdateConnectionInput): MaybePromise<Connection>;
  resetEntity(input: ResetEntityInput): MaybePromise<GatewayState>;
```

- [ ] **Step 4: Implement fixture update/reset methods**

In `src/admin/fixture-backend.ts`, import new types:

```ts
  ResetEntityInput,
  UpdateBrandInput,
  UpdateConnectionInput,
  UpdateRegionInput,
```

Add status guards near the helper functions:

```ts
const entityStatuses: EntityStatus[] = ["active", "disabled"];
const connectionStatuses: ConnectionStatus[] = ["needs_config", "pending", "connected", "needs_reconnect", "error"];

function optionalEntityStatus(value: unknown): EntityStatus | undefined {
  if (value === undefined) return undefined;
  if (entityStatuses.includes(value as EntityStatus)) return value as EntityStatus;
  throw new Error(`Invalid entity status: ${String(value)}`);
}

function optionalConnectionStatus(value: unknown): ConnectionStatus | undefined {
  if (value === undefined) return undefined;
  if (connectionStatuses.includes(value as ConnectionStatus)) return value as ConnectionStatus;
  throw new Error(`Invalid connection status: ${String(value)}`);
}
```

Add methods to `FixtureGatewayBackend` after `createConnection`:

```ts
  updateBrand(brandId: string, input: UpdateBrandInput): Brand {
    const brand = this.findBrand(brandId);
    const name = optionalText(input.name, "Brand name");
    const status = optionalEntityStatus(input.status);
    if (input.slug !== undefined) {
      const slug = normalizeSlug(input.slug, "Brand slug");
      if (!slug) {
        throw new Error("Brand slug is required");
      }
      if (this.state.brands.some((candidate) => candidate.id !== brand.id && candidate.slug === slug)) {
        throw new Error(`Duplicate brand slug: ${slug}`);
      }
      brand.slug = slug;
    }
    if (name) brand.name = name;
    if (status) brand.status = status;
    this.writeAudit({
      action: "brand.updated",
      targetType: "brand",
      targetId: brand.id,
      detail: `${brand.name} brand updated.`,
      metadata: { slug: brand.slug }
    });
    return cloneValue(brand);
  }

  updateRegion(regionId: string, input: UpdateRegionInput): Region {
    const region = this.findRegion(regionId);
    const code = input.code === undefined ? undefined : normalizeRegionCode(input.code);
    const name = optionalText(input.name, "Region name");
    const domain = optionalText(input.domain, "Region domain");
    const status = optionalEntityStatus(input.status);
    if (code) {
      if (this.state.regions.some((candidate) => candidate.id !== region.id && candidate.brandId === region.brandId && candidate.code === code)) {
        throw new Error(`Duplicate region code for ${region.brandId}: ${code}`);
      }
      region.code = code;
    }
    if (name) region.name = name;
    if (input.domain !== undefined) {
      if (domain) region.domain = domain;
      else delete region.domain;
    }
    if (status) region.status = status;
    this.writeAudit({
      action: "region.updated",
      targetType: "region",
      targetId: region.id,
      detail: `${region.code} region updated.`,
      metadata: { brandId: region.brandId }
    });
    return cloneValue(region);
  }

  updateConnection(connectionId: string, input: UpdateConnectionInput): Connection {
    const connection = this.findConnection(connectionId);
    const displayName = optionalText(input.displayName, "Connection display name");
    const status = optionalConnectionStatus(input.status);
    if (input.backendType !== undefined) {
      const connector = this.findConnector(connection.connectorId);
      if (!connector.backendOptions.includes(input.backendType)) {
        throw new Error(`Connector ${connector.slug} does not support backend ${input.backendType}`);
      }
      connection.backendType = input.backendType;
    }
    if (displayName) connection.displayName = displayName;
    if (status) connection.status = status;
    if (input.configSummary !== undefined) {
      connection.configSummary = sanitizePartialConfigSummary(input.configSummary);
    }
    if (input.lastError === null) delete connection.lastError;
    else if (input.lastError !== undefined) connection.lastError = requireText(input.lastError, "Connection error note");
    this.writeAudit({
      action: "connection.updated",
      targetType: "connection",
      targetId: connection.id,
      detail: `${connection.displayName} connection updated.`,
      metadata: { connectorId: connection.connectorId }
    });
    return cloneValue(connection);
  }

  resetEntity(_input: ResetEntityInput): GatewayState {
    throw new Error("Fixture backend has no source override to reset.");
  }
```

Import `sanitizePartialConfigSummary` from `input-validation.ts`.

- [ ] **Step 5: Keep Dev API plain mode read-only**

In `src/admin/dev-api-backend.ts`, import update/reset types and add methods:

```ts
  updateBrand(_brandId: string, _input: UpdateBrandInput): Promise<Brand> {
    return Promise.reject(readOnlyError("update brand"));
  }

  updateRegion(_regionId: string, _input: UpdateRegionInput): Promise<Region> {
    return Promise.reject(readOnlyError("update region"));
  }

  updateConnection(_connectionId: string, _input: UpdateConnectionInput): Promise<Connection> {
    return Promise.reject(readOnlyError("update connection"));
  }

  resetEntity(_input: ResetEntityInput): Promise<GatewayState> {
    return Promise.reject(readOnlyError("reset entity"));
  }
```

Add `GatewayState`, `ResetEntityInput`, `UpdateBrandInput`, `UpdateConnectionInput`, and `UpdateRegionInput` to the type import.

- [ ] **Step 6: Run tests**

Run:

```bash
npm test -- test/admin-routes.test.ts test/admin-dev-api-backend.test.ts test/admin-input-validation.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add src/admin/types.ts src/admin/fixture-backend.ts src/admin/dev-api-backend.ts test/admin-routes.test.ts test/admin-dev-api-backend.test.ts
git commit -m "feat: add admin reconfiguration interface"
```

---

### Task 4: Add Persistent Overlay Store

**Files:**
- Create: `src/admin/overlay-store.ts`
- Create: `test/admin-overlay-store.test.ts`

- [ ] **Step 1: Write failing store tests**

Create `test/admin-overlay-store.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GatewayOverlayStore } from "../src/admin/overlay-store.js";

let tempDir: string;
let dbPath: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-overlay-"));
  dbPath = path.join(tempDir, "gateway.sqlite");
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("GatewayOverlayStore", () => {
  it("creates SQLite tables and persists gateway-owned records", () => {
    const store = new GatewayOverlayStore(dbPath);
    store.createBrand({
      brand: { id: "gateway_brand_route_test", name: "Route Test", slug: "route-test", status: "active" },
      actor: "test"
    });
    store.createRegion({
      region: {
        id: "gateway_region_route_test_au",
        brandId: "gateway_brand_route_test",
        code: "AU",
        name: "Australia",
        status: "active",
        domain: "route-test.example"
      },
      actor: "test"
    });
    store.createConnection({
      connection: {
        id: "gateway_connection_route_test_au_shopify",
        brandId: "gateway_brand_route_test",
        regionId: "gateway_region_route_test_au",
        connectorId: "connector_shopify",
        backendType: "native",
        displayName: "Route Test Shopify",
        status: "pending",
        configSummary: { shop_domain: "route-test.myshopify.com" }
      },
      actor: "test"
    });
    store.close();

    const reopened = new GatewayOverlayStore(dbPath);
    expect(reopened.listBrands().map((record) => record.value)).toContainEqual(
      expect.objectContaining({ id: "gateway_brand_route_test", slug: "route-test" })
    );
    expect(reopened.listRegions().map((record) => record.value)).toContainEqual(
      expect.objectContaining({ id: "gateway_region_route_test_au", domain: "route-test.example" })
    );
    expect(reopened.listConnections().map((record) => record.value)).toContainEqual(
      expect.objectContaining({
        id: "gateway_connection_route_test_au_shopify",
        configSummary: { shop_domain: "route-test.myshopify.com" }
      })
    );
    reopened.close();
  });

  it("upserts and deletes source entity overrides", () => {
    const store = new GatewayOverlayStore(dbPath);
    store.upsertOverride({
      entityType: "brand",
      entityId: "brand_haverford",
      source: "dev_api",
      patch: { name: "Haverford Override", status: "disabled" },
      actor: "test"
    });

    expect(store.listOverrides()).toContainEqual(
      expect.objectContaining({
        entityType: "brand",
        entityId: "brand_haverford",
        patch: { name: "Haverford Override", status: "disabled" },
        updatedBy: "test"
      })
    );

    store.deleteOverride("brand", "brand_haverford");
    expect(store.listOverrides()).toEqual([]);
    store.close();
  });

  it("stores audit events newest first", () => {
    const store = new GatewayOverlayStore(dbPath);
    store.writeAudit({
      action: "brand.updated",
      targetType: "brand",
      targetId: "brand_haverford",
      detail: "Haverford brand updated.",
      actor: "test",
      metadata: { field: "name" }
    });

    const events = store.listAuditEvents();
    expect(events[0]).toMatchObject({
      action: "brand.updated",
      targetType: "brand",
      targetId: "brand_haverford",
      actor: "test",
      metadata: { field: "name" }
    });
    expect(events[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    store.close();
  });
});
```

- [ ] **Step 2: Run store tests and verify failure**

Run:

```bash
npm test -- test/admin-overlay-store.test.ts
```

Expected: FAIL because `src/admin/overlay-store.ts` does not exist.

- [ ] **Step 3: Implement overlay store**

Create `src/admin/overlay-store.ts` with these exports:

```ts
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type {
  AuditAction,
  AuditEvent,
  Brand,
  Connection,
  GatewayEntitySource,
  GatewayEntityType,
  Region
} from "./types.js";

export interface StoredEntity<T> {
  value: T;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

export interface EntityOverride {
  entityType: GatewayEntityType;
  entityId: string;
  source: GatewayEntitySource;
  patch: Record<string, unknown>;
  sourceFingerprint?: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

export interface CreateBrandRecordInput {
  brand: Brand;
  actor: string;
}

export interface CreateRegionRecordInput {
  region: Region;
  actor: string;
}

export interface CreateConnectionRecordInput {
  connection: Connection;
  actor: string;
}

export interface UpsertOverrideInput {
  entityType: GatewayEntityType;
  entityId: string;
  source: GatewayEntitySource;
  patch: Record<string, unknown>;
  actor: string;
  sourceFingerprint?: string;
}

export interface WriteAuditInput {
  action: AuditAction;
  targetType: AuditEvent["targetType"];
  targetId: string;
  detail: string;
  actor: string;
  metadata?: Record<string, string>;
}
```

Implement `GatewayOverlayStore` with:

```ts
export class GatewayOverlayStore {
  private readonly db: Database.Database;

  constructor(private readonly dbPath: string) {
    fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  listBrands(): Array<StoredEntity<Brand>> {
    const rows = this.db.prepare("SELECT * FROM gateway_brands ORDER BY name ASC").all() as any[];
    return rows.map((row) => ({
      value: { id: row.id, name: row.name, slug: row.slug, status: row.status },
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      updatedBy: row.updated_by
    }));
  }

  listRegions(): Array<StoredEntity<Region>> {
    const rows = this.db.prepare("SELECT * FROM gateway_regions ORDER BY brand_id ASC, code ASC").all() as any[];
    return rows.map((row) => {
      const region: Region = {
        id: row.id,
        brandId: row.brand_id,
        code: row.code,
        name: row.name,
        status: row.status
      };
      if (row.domain) region.domain = row.domain;
      return { value: region, createdAt: row.created_at, updatedAt: row.updated_at, updatedBy: row.updated_by };
    });
  }

  listConnections(): Array<StoredEntity<Connection>> {
    const rows = this.db.prepare("SELECT * FROM gateway_connections ORDER BY display_name ASC").all() as any[];
    return rows.map((row) => {
      const connection: Connection = {
        id: row.id,
        brandId: row.brand_id,
        regionId: row.region_id,
        connectorId: row.connector_id,
        backendType: row.backend_type,
        displayName: row.display_name,
        status: row.status,
        configSummary: JSON.parse(row.config_summary_json)
      };
      if (row.last_tested_at) connection.lastTestedAt = row.last_tested_at;
      if (row.last_used_at) connection.lastUsedAt = row.last_used_at;
      if (row.last_error) connection.lastError = row.last_error;
      return { value: connection, createdAt: row.created_at, updatedAt: row.updated_at, updatedBy: row.updated_by };
    });
  }

  createBrand(input: CreateBrandRecordInput): StoredEntity<Brand> {
    const timestamp = nowIso();
    this.db
      .prepare(
        `INSERT INTO gateway_brands (id, name, slug, status, created_at, updated_at, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(input.brand.id, input.brand.name, input.brand.slug, input.brand.status, timestamp, timestamp, input.actor);
    return { value: input.brand, createdAt: timestamp, updatedAt: timestamp, updatedBy: input.actor };
  }

  updateBrand(brand: Brand, actor: string): StoredEntity<Brand> {
    const timestamp = nowIso();
    this.db
      .prepare("UPDATE gateway_brands SET name = ?, slug = ?, status = ?, updated_at = ?, updated_by = ? WHERE id = ?")
      .run(brand.name, brand.slug, brand.status, timestamp, actor, brand.id);
    return { value: brand, createdAt: timestamp, updatedAt: timestamp, updatedBy: actor };
  }
```

Add equivalent `createRegion`, `updateRegion`, `createConnection`, and `updateConnection` methods using the table columns from the spec and JSON serialization for `configSummary`.

Add override and audit methods:

```ts
  listOverrides(): EntityOverride[] {
    const rows = this.db.prepare("SELECT * FROM gateway_entity_overrides ORDER BY updated_at DESC").all() as any[];
    return rows.map((row) => ({
      entityType: row.entity_type,
      entityId: row.entity_id,
      source: row.source,
      patch: JSON.parse(row.patch_json),
      sourceFingerprint: row.source_fingerprint ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      updatedBy: row.updated_by
    }));
  }

  upsertOverride(input: UpsertOverrideInput): EntityOverride {
    const timestamp = nowIso();
    const existing = this.db
      .prepare("SELECT created_at FROM gateway_entity_overrides WHERE entity_type = ? AND entity_id = ?")
      .get(input.entityType, input.entityId) as { created_at: string } | undefined;
    const createdAt = existing?.created_at ?? timestamp;
    this.db
      .prepare(
        `INSERT INTO gateway_entity_overrides
           (entity_type, entity_id, source, patch_json, source_fingerprint, created_at, updated_at, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(entity_type, entity_id) DO UPDATE SET
           source = excluded.source,
           patch_json = excluded.patch_json,
           source_fingerprint = excluded.source_fingerprint,
           updated_at = excluded.updated_at,
           updated_by = excluded.updated_by`
      )
      .run(
        input.entityType,
        input.entityId,
        input.source,
        JSON.stringify(input.patch),
        input.sourceFingerprint ?? null,
        createdAt,
        timestamp,
        input.actor
      );
    return {
      entityType: input.entityType,
      entityId: input.entityId,
      source: input.source,
      patch: input.patch,
      sourceFingerprint: input.sourceFingerprint,
      createdAt,
      updatedAt: timestamp,
      updatedBy: input.actor
    };
  }

  deleteOverride(entityType: GatewayEntityType, entityId: string): void {
    this.db.prepare("DELETE FROM gateway_entity_overrides WHERE entity_type = ? AND entity_id = ?").run(entityType, entityId);
  }

  writeAudit(input: WriteAuditInput): AuditEvent {
    const timestamp = nowIso();
    const event: AuditEvent = {
      id: `gateway_audit_${timestamp.replace(/[^0-9]/g, "")}_${Math.random().toString(36).slice(2, 8)}`,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      detail: input.detail,
      actor: input.actor,
      timestamp
    };
    if (input.metadata) event.metadata = input.metadata;
    this.db
      .prepare(
        `INSERT INTO gateway_audit_events
           (id, action, target_type, target_id, detail, actor, metadata_json, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        event.id,
        event.action,
        event.targetType,
        event.targetId,
        event.detail,
        event.actor,
        event.metadata ? JSON.stringify(event.metadata) : null,
        event.timestamp
      );
    return event;
  }

  listAuditEvents(): AuditEvent[] {
    const rows = this.db.prepare("SELECT * FROM gateway_audit_events ORDER BY timestamp DESC").all() as any[];
    return rows.map((row) => {
      const event: AuditEvent = {
        id: row.id,
        action: row.action,
        targetType: row.target_type,
        targetId: row.target_id,
        detail: row.detail,
        actor: row.actor,
        timestamp: row.timestamp
      };
      if (row.metadata_json) event.metadata = JSON.parse(row.metadata_json);
      return event;
    });
  }
```

Add private migration:

```ts
  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS gateway_schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS gateway_brands (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        updated_by TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS gateway_regions (
        id TEXT PRIMARY KEY,
        brand_id TEXT NOT NULL,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL,
        domain TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        updated_by TEXT NOT NULL,
        UNIQUE(brand_id, code)
      );
      CREATE TABLE IF NOT EXISTS gateway_connections (
        id TEXT PRIMARY KEY,
        brand_id TEXT NOT NULL,
        region_id TEXT NOT NULL,
        connector_id TEXT NOT NULL,
        backend_type TEXT NOT NULL,
        display_name TEXT NOT NULL,
        status TEXT NOT NULL,
        config_summary_json TEXT NOT NULL,
        last_tested_at TEXT,
        last_used_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        updated_by TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS gateway_entity_overrides (
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        source TEXT NOT NULL,
        patch_json TEXT NOT NULL,
        source_fingerprint TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        updated_by TEXT NOT NULL,
        PRIMARY KEY(entity_type, entity_id)
      );
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
    `);
  }
```

Add helper:

```ts
function nowIso(): string {
  return new Date().toISOString();
}
```

- [ ] **Step 4: Run store tests**

Run:

```bash
npm test -- test/admin-overlay-store.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/admin/overlay-store.ts test/admin-overlay-store.test.ts
git commit -m "feat: add gateway overlay sqlite store"
```

---

### Task 5: Implement Overlay Backend Merge And Persistence

**Files:**
- Create: `src/admin/overlay-backend.ts`
- Create: `test/admin-overlay-backend.test.ts`
- Modify: `src/admin/overlay-store.ts`

- [ ] **Step 1: Write failing overlay backend tests**

Create `test/admin-overlay-backend.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FixtureGatewayBackend } from "../src/admin/fixture-backend.js";
import { OverlayGatewayBackend } from "../src/admin/overlay-backend.js";
import { GatewayOverlayStore } from "../src/admin/overlay-store.js";

let tempDir: string;
let dbPath: string;

function backend() {
  return new OverlayGatewayBackend({
    source: new FixtureGatewayBackend(),
    store: new GatewayOverlayStore(dbPath),
    sourceLabel: "Fixture",
    sourceType: "fixture",
    actor: "test"
  });
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-overlay-backend-"));
  dbPath = path.join(tempDir, "gateway.sqlite");
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("OverlayGatewayBackend", () => {
  it("adds entity metadata for source records", async () => {
    const gateway = backend();
    const state = await gateway.snapshot();

    expect(state.entityMeta).toContainEqual(
      expect.objectContaining({
        entityType: "brand",
        entityId: "brand_haverford",
        source: "fixture",
        sourceLabel: "Fixture",
        hasOverride: false,
        overrideFields: []
      })
    );
    gateway.close();
  });

  it("persists gateway-owned creates across backend recreation", async () => {
    const gateway = backend();
    const brand = await gateway.createBrand({ name: "Overlay Brand", slug: "overlay-brand" });
    const region = await gateway.createRegion({
      brandId: brand.id,
      code: "EU",
      name: "Europe",
      domain: "overlay.example"
    });
    const connector = (await gateway.snapshot()).connectors.find((candidate) => candidate.slug === "outlook")!;
    const connection = await gateway.createConnection({
      brandId: brand.id,
      regionId: region.id,
      connectorId: connector.id,
      backendType: "composio",
      displayName: "Overlay Outlook",
      configSummary: { mailbox: "ops@overlay.example", tenant: "Overlay tenant" }
    });
    gateway.close();

    const reopened = backend();
    const state = await reopened.snapshot();
    expect(state.brands).toContainEqual(expect.objectContaining({ id: brand.id, slug: "overlay-brand" }));
    expect(state.regions).toContainEqual(expect.objectContaining({ id: region.id, domain: "overlay.example" }));
    expect(state.connections).toContainEqual(expect.objectContaining({ id: connection.id, displayName: "Overlay Outlook" }));
    expect(state.entityMeta).toContainEqual(
      expect.objectContaining({ entityType: "connection", entityId: connection.id, source: "gateway", hasOverride: false })
    );
    reopened.close();
  });

  it("persists imported source overrides and resets them", async () => {
    const gateway = backend();
    await gateway.updateBrand("brand_haverford", { name: "Haverford Override", status: "disabled" });
    await gateway.updateRegion("region_haverford_au", { name: "Australia Override", domain: "override.example" });
    await gateway.updateConnection("connection_haverford_au_outlook", {
      displayName: "Outlook Override",
      status: "needs_config",
      configSummary: { mailbox: "override@example.com" }
    });
    gateway.close();

    const reopened = backend();
    const state = await reopened.snapshot();
    expect(state.brands.find((brand) => brand.id === "brand_haverford")).toMatchObject({
      name: "Haverford Override",
      status: "disabled"
    });
    expect(state.regions.find((region) => region.id === "region_haverford_au")).toMatchObject({
      name: "Australia Override",
      domain: "override.example"
    });
    expect(state.connections.find((connection) => connection.id === "connection_haverford_au_outlook")).toMatchObject({
      displayName: "Outlook Override",
      status: "needs_config",
      configSummary: { mailbox: "override@example.com" }
    });
    expect(state.entityMeta).toContainEqual(
      expect.objectContaining({
        entityType: "brand",
        entityId: "brand_haverford",
        hasOverride: true,
        overrideFields: ["name", "status"]
      })
    );

    await reopened.resetEntity({ entityType: "brand", entityId: "brand_haverford" });
    const resetState = await reopened.snapshot();
    expect(resetState.brands.find((brand) => brand.id === "brand_haverford")).toMatchObject({
      name: "Haverford",
      status: "active"
    });
    reopened.close();
  });

  it("rejects duplicates and source identity edits", async () => {
    const gateway = backend();

    await expect(gateway.createBrand({ name: "Duplicate", slug: "haverford" })).rejects.toThrow(/Duplicate brand slug/);
    await expect(gateway.updateBrand("brand_haverford", { slug: "new-source-slug" })).rejects.toThrow(/Cannot edit source brand slug/);
    await expect(gateway.updateRegion("region_haverford_au", { code: "NZ" })).rejects.toThrow(/Cannot edit source region code/);
    gateway.close();
  });
});
```

- [ ] **Step 2: Run overlay backend tests and verify failure**

Run:

```bash
npm test -- test/admin-overlay-backend.test.ts
```

Expected: FAIL because `OverlayGatewayBackend` does not exist.

- [ ] **Step 3: Add close support to store consumers**

Ensure `GatewayOverlayStore` has:

```ts
  close(): void {
    this.db.close();
  }
```

- [ ] **Step 4: Implement overlay backend**

Create `src/admin/overlay-backend.ts` with:

```ts
import { AdminBackendError } from "./backend-error.js";
import {
  normalizeRegionCode,
  normalizeSlug,
  optionalText,
  requireText,
  sanitizeConnectionConfig,
  sanitizePartialConfigSummary
} from "./input-validation.js";
import type { EntityOverride, GatewayOverlayStore } from "./overlay-store.js";
import type {
  ApiKey,
  Brand,
  Connection,
  CreateBrandInput,
  CreateConnectionInput,
  CreateRegionInput,
  EntityStatus,
  GatewayConnectionBackend,
  GatewayEntityMeta,
  GatewayEntitySource,
  GatewayEntityType,
  GatewayState,
  Region,
  ResetEntityInput,
  UpdateBrandInput,
  UpdateConnectionInput,
  UpdateRegionInput
} from "./types.js";

export interface OverlayGatewayBackendOptions {
  source: GatewayConnectionBackend;
  store: GatewayOverlayStore;
  sourceLabel: string;
  sourceType: GatewayEntitySource;
  actor?: string;
}

const entityStatuses: EntityStatus[] = ["active", "disabled"];
const connectionStatuses = ["needs_config", "pending", "connected", "needs_reconnect", "error"] as const;

export class OverlayGatewayBackend implements GatewayConnectionBackend {
  private readonly actor: string;

  constructor(private readonly options: OverlayGatewayBackendOptions) {
    this.actor = options.actor ?? "gateway-admin";
  }

  close(): void {
    this.options.store.close();
  }
```

Implement `snapshot`:

```ts
  async snapshot(): Promise<GatewayState> {
    const sourceState = await this.options.source.snapshot();
    const state: GatewayState = cloneValue(sourceState);
    const overrides = this.options.store.listOverrides();
    const overrideMap = new Map(overrides.map((override) => [`${override.entityType}:${override.entityId}`, override]));
    const meta: GatewayEntityMeta[] = [];

    state.brands = state.brands.map((brand) => {
      const override = overrideMap.get(`brand:${brand.id}`);
      meta.push(this.sourceMeta("brand", brand.id, override));
      return override ? { ...brand, ...override.patch } as Brand : brand;
    });
    state.regions = state.regions.map((region) => {
      const override = overrideMap.get(`region:${region.id}`);
      meta.push(this.sourceMeta("region", region.id, override));
      return override ? { ...region, ...override.patch } as Region : region;
    });
    state.connections = state.connections.map((connection) => {
      const override = overrideMap.get(`connection:${connection.id}`);
      meta.push(this.sourceMeta("connection", connection.id, override));
      return override ? { ...connection, ...override.patch } as Connection : connection;
    });

    for (const stored of this.options.store.listBrands()) {
      state.brands.push(stored.value);
      meta.push(this.gatewayMeta("brand", stored.value.id, stored.updatedAt, stored.updatedBy));
    }
    const visibleBrandIds = new Set(state.brands.map((brand) => brand.id));
    for (const stored of this.options.store.listRegions()) {
      if (!visibleBrandIds.has(stored.value.brandId)) continue;
      state.regions.push(stored.value);
      meta.push(this.gatewayMeta("region", stored.value.id, stored.updatedAt, stored.updatedBy));
    }
    const visibleRegionIds = new Set(state.regions.map((region) => region.id));
    const visibleConnectorIds = new Set(state.connectors.map((connector) => connector.id));
    for (const stored of this.options.store.listConnections()) {
      if (!visibleBrandIds.has(stored.value.brandId)) continue;
      if (!visibleRegionIds.has(stored.value.regionId)) continue;
      if (!visibleConnectorIds.has(stored.value.connectorId)) continue;
      state.connections.push(stored.value);
      meta.push(this.gatewayMeta("connection", stored.value.id, stored.updatedAt, stored.updatedBy));
    }

    state.auditEvents = [...this.options.store.listAuditEvents(), ...state.auditEvents];
    state.entityMeta = meta;
    return state;
  }
```

Add helpers:

```ts
  private sourceMeta(entityType: GatewayEntityType, entityId: string, override?: EntityOverride): GatewayEntityMeta {
    return {
      entityType,
      entityId,
      source: this.options.sourceType,
      hasOverride: Boolean(override),
      overrideFields: override ? Object.keys(override.patch).sort() : [],
      sourceLabel: override ? `${this.options.sourceLabel} + Gateway override` : this.options.sourceLabel,
      updatedAt: override?.updatedAt,
      updatedBy: override?.updatedBy
    };
  }

  private gatewayMeta(entityType: GatewayEntityType, entityId: string, updatedAt: string, updatedBy: string): GatewayEntityMeta {
    return {
      entityType,
      entityId,
      source: "gateway",
      hasOverride: false,
      overrideFields: [],
      sourceLabel: "Gateway",
      updatedAt,
      updatedBy
    };
  }
```

Implement create/update/reset using these rules:

```ts
  async createBrand(input: CreateBrandInput): Promise<Brand> {
    const state = await this.snapshot();
    const name = requireText(input.name, "Brand name");
    const slug = normalizeSlug(input.slug === undefined ? input.name : input.slug, input.slug === undefined ? "Brand name" : "Brand slug");
    if (!slug) throw new AdminBackendError(400, "Brand slug is required");
    if (state.brands.some((brand) => brand.slug === slug)) {
      throw new AdminBackendError(409, `Duplicate brand slug: ${slug}`);
    }
    const brand: Brand = { id: uniqueId(`gateway_brand_${slug.replace(/-/g, "_")}`, state.brands), name, slug, status: "active" };
    this.options.store.createBrand({ brand, actor: this.actor });
    this.options.store.writeAudit({
      action: "brand.created",
      targetType: "brand",
      targetId: brand.id,
      detail: `${brand.name} brand created in gateway overlay.`,
      actor: this.actor,
      metadata: { slug: brand.slug }
    });
    return cloneValue(brand);
  }
```

Use the same pattern for `createRegion` and `createConnection`, validating:

- Brand exists in current `snapshot()`.
- Region belongs to selected brand.
- Connector exists.
- Connector supports requested `backendType`.
- Connection config uses `sanitizeConnectionConfig(connector, input.configSummary)`.

For source-owned updates, reject identity fields:

```ts
  async updateBrand(brandId: string, input: UpdateBrandInput): Promise<Brand> {
    const state = await this.snapshot();
    const existing = findBrand(state, brandId);
    const isGateway = this.options.store.listBrands().some((stored) => stored.value.id === brandId);
    if (!isGateway && input.slug !== undefined) {
      throw new AdminBackendError(409, "Cannot edit source brand slug in the gateway overlay.");
    }
    const patch: Record<string, unknown> = {};
    const name = optionalText(input.name, "Brand name");
    if (name) patch.name = name;
    if (input.status !== undefined) patch.status = parseEntityStatus(input.status);
    const updated = { ...existing, ...patch };
    if (isGateway) {
      this.options.store.updateBrand(updated, this.actor);
    } else {
      this.options.store.upsertOverride({ entityType: "brand", entityId: brandId, source: this.options.sourceType, patch, actor: this.actor });
    }
    this.options.store.writeAudit({
      action: "brand.updated",
      targetType: "brand",
      targetId: brandId,
      detail: `${updated.name} brand updated in gateway overlay.`,
      actor: this.actor,
      metadata: fieldsMetadata(patch)
    });
    return cloneValue(updated);
  }
```

Use analogous implementations for `updateRegion` and `updateConnection`. `updateConnection` should use `sanitizePartialConfigSummary(input.configSummary)` and merge it as a replacement for `configSummary` when supplied.

Implement `resetEntity`:

```ts
  async resetEntity(input: ResetEntityInput): Promise<GatewayState> {
    const state = await this.snapshot();
    const exists = input.entityType === "brand"
      ? state.brands.some((brand) => brand.id === input.entityId)
      : input.entityType === "region"
        ? state.regions.some((region) => region.id === input.entityId)
        : state.connections.some((connection) => connection.id === input.entityId);
    if (!exists) {
      throw new AdminBackendError(404, `Unknown ${input.entityType}: ${input.entityId}`);
    }
    this.options.store.deleteOverride(input.entityType, input.entityId);
    this.options.store.writeAudit({
      action: "entity.reset",
      targetType: input.entityType,
      targetId: input.entityId,
      detail: `${input.entityType} ${input.entityId} reset to source value.`,
      actor: this.actor
    });
    return this.snapshot();
  }
```

Implement mock `testConnection`:

```ts
  async testConnection(connectionId: string): Promise<Connection> {
    const state = await this.snapshot();
    const existing = findConnection(state, connectionId);
    const updated: Connection = {
      ...existing,
      status: "connected",
      lastTestedAt: new Date().toISOString()
    };
    delete updated.lastError;
    await this.updateConnection(connectionId, {
      status: updated.status,
      configSummary: updated.configSummary,
      lastError: null
    });
    this.options.store.writeAudit({
      action: "connection.tested",
      targetType: "connection",
      targetId: connectionId,
      detail: `${updated.displayName} connection mock-tested in gateway overlay.`,
      actor: this.actor,
      metadata: { status: "connected" }
    });
    return updated;
  }
```

Delegate API key lifecycle methods:

```ts
  rotateApiKey(clientId: string, keyId: string): Promise<ApiKey> {
    return Promise.resolve(this.options.source.rotateApiKey(clientId, keyId));
  }

  revokeApiKey(clientId: string, keyId: string): Promise<ApiKey> {
    return Promise.resolve(this.options.source.revokeApiKey(clientId, keyId));
  }
```

Add file-level helper functions:

```ts
function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function uniqueId<T extends { id: string }>(base: string, existing: T[]): string {
  const existingIds = new Set(existing.map((item) => item.id));
  if (!existingIds.has(base)) return base;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base}_${index}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  throw new AdminBackendError(409, `Could not allocate unique id for ${base}`);
}

function fieldsMetadata(patch: Record<string, unknown>): Record<string, string> {
  return { fields: Object.keys(patch).sort().join(",") };
}
```

Add `findBrand`, `findRegion`, `findConnector`, `findConnection`, `parseEntityStatus`, and `parseConnectionStatus` helpers that throw `AdminBackendError(404, ...)` or `AdminBackendError(400, ...)` with exact messages used in tests.

- [ ] **Step 5: Run overlay backend tests**

Run:

```bash
npm test -- test/admin-overlay-backend.test.ts test/admin-overlay-store.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/admin/overlay-backend.ts src/admin/overlay-store.ts test/admin-overlay-backend.test.ts
git commit -m "feat: merge gateway overlays with source state"
```

---

### Task 6: Wire Overlay Backend Through Factory And Routes

**Files:**
- Modify: `src/admin/backend-factory.ts`
- Modify: `src/admin/routes.ts`
- Modify: `test/admin-backend-factory.test.ts`
- Modify: `test/admin-routes.test.ts`

- [ ] **Step 1: Write failing factory and route tests**

Add to `test/admin-backend-factory.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
```

Add this test:

```ts
  it("builds fixture overlay backend with persistent gateway store", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-factory-"));
    const gatewayStorePath = path.join(tempDir, "gateway.sqlite");
    try {
      const backend = buildAdminBackend({ ...baseConfig(), adminDataSource: "fixture-overlay", gatewayStorePath });
      const brand = await backend.createBrand({ name: "Factory Overlay", slug: "factory-overlay" });
      expect(brand.slug).toBe("factory-overlay");
      const state = await backend.snapshot();
      expect(state.entityMeta).toContainEqual(
        expect.objectContaining({ entityType: "brand", entityId: brand.id, source: "gateway" })
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
```

Add route test to `test/admin-routes.test.ts`:

```ts
  it("updates and resets admin entities through JSON routes", async () => {
    const { app } = buildAdminApp();

    const brandRes = await request(app)
      .patch("/admin/api/brands/brand_haverford")
      .send({ name: "Route Updated Haverford", status: "disabled" });
    expect(brandRes.status).toBe(200);
    expect(brandRes.body.brand).toMatchObject({ id: "brand_haverford", name: "Route Updated Haverford", status: "disabled" });

    const regionRes = await request(app)
      .patch("/admin/api/regions/region_haverford_au")
      .send({ name: "Route Updated Australia", domain: "route-updated.example" });
    expect(regionRes.status).toBe(200);
    expect(regionRes.body.region).toMatchObject({ id: "region_haverford_au", name: "Route Updated Australia", domain: "route-updated.example" });

    const connectionRes = await request(app)
      .patch("/admin/api/connections/connection_haverford_au_outlook")
      .send({ displayName: "Route Updated Outlook", status: "needs_config", configSummary: { mailbox: "route@example.com" } });
    expect(connectionRes.status).toBe(200);
    expect(connectionRes.body.connection).toMatchObject({
      id: "connection_haverford_au_outlook",
      displayName: "Route Updated Outlook",
      status: "needs_config",
      configSummary: { mailbox: "route@example.com" }
    });

    const resetRes = await request(app)
      .post("/admin/api/entities/brand/brand_haverford/reset")
      .send({});
    expect(resetRes.status).toBe(400);
    expect(resetRes.body.error).toMatch(/no source override/i);
  });
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npm test -- test/admin-backend-factory.test.ts test/admin-routes.test.ts
```

Expected: FAIL because factory and routes do not expose overlay/update behavior.

- [ ] **Step 3: Wire backend factory**

Modify `src/admin/backend-factory.ts`:

```ts
import { OverlayGatewayBackend } from "./overlay-backend.js";
import { GatewayOverlayStore } from "./overlay-store.js";
```

Update `buildAdminBackend`:

```ts
export function buildAdminBackend(config: GatewayConfig): GatewayConnectionBackend {
  if (config.adminDataSource === "fixture") {
    return new FixtureGatewayBackend();
  }

  if (config.adminDataSource === "fixture-overlay") {
    return new OverlayGatewayBackend({
      source: new FixtureGatewayBackend(),
      store: new GatewayOverlayStore(config.gatewayStorePath),
      sourceLabel: "Fixture",
      sourceType: "fixture"
    });
  }

  const baseUrl = requireSetting(config.haverfordDevApiBaseUrl, "HAVERFORD_DEV_API_BASE_URL");
  const clientId = requireSetting(config.haverfordDevApiClientId, "HAVERFORD_DEV_API_CLIENT_ID");
  const clientSecret = requireSetting(config.haverfordDevApiClientSecret, "HAVERFORD_DEV_API_CLIENT_SECRET");

  const devApiBackend = new DevApiGatewayBackend(
    new DevApiBrandsClient({
      baseUrl,
      clientId,
      clientSecret
    })
  );

  if (config.adminDataSource === "dev-api-overlay") {
    return new OverlayGatewayBackend({
      source: devApiBackend,
      store: new GatewayOverlayStore(config.gatewayStorePath),
      sourceLabel: "Dev API",
      sourceType: "dev_api"
    });
  }

  return devApiBackend;
}
```

- [ ] **Step 4: Add route handlers**

In `src/admin/routes.ts`, add:

```ts
function updateConfigSummaryFromBody(body: any): Record<string, unknown> | undefined {
  if (!Object.prototype.hasOwnProperty.call(body ?? {}, "configSummary")) {
    return undefined;
  }
  return configSummaryFromBody(body);
}
```

Add routes before connection test route:

```ts
  router.patch("/api/brands/:brandId", async (req: Request, res: Response) => {
    try {
      const body = req.body as any;
      const brand = await backend.updateBrand(req.params.brandId, {
        name: body?.name,
        slug: body?.slug,
        status: body?.status
      });
      res.json({ brand, state: await backend.snapshot() });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.patch("/api/regions/:regionId", async (req: Request, res: Response) => {
    try {
      const body = req.body as any;
      const region = await backend.updateRegion(req.params.regionId, {
        code: body?.code,
        name: body?.name,
        domain: body?.domain,
        status: body?.status
      });
      res.json({ region, state: await backend.snapshot() });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.patch("/api/connections/:connectionId", async (req: Request, res: Response) => {
    try {
      const body = req.body as any;
      const connection = await backend.updateConnection(req.params.connectionId, {
        backendType: body?.backendType,
        displayName: body?.displayName,
        status: body?.status,
        configSummary: updateConfigSummaryFromBody(body),
        lastError: Object.prototype.hasOwnProperty.call(body ?? {}, "lastError") ? body.lastError : undefined
      });
      res.json({ connection, state: await backend.snapshot() });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/api/entities/:entityType/:entityId/reset", async (req: Request, res: Response) => {
    try {
      const state = await backend.resetEntity({
        entityType: req.params.entityType as any,
        entityId: req.params.entityId
      });
      res.json({ state });
    } catch (error) {
      sendError(res, error);
    }
  });
```

- [ ] **Step 5: Run tests**

Run:

```bash
npm test -- test/admin-backend-factory.test.ts test/admin-routes.test.ts test/admin-overlay-backend.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/admin/backend-factory.ts src/admin/routes.ts test/admin-backend-factory.test.ts test/admin-routes.test.ts
git commit -m "feat: expose admin overlay routes"
```

---

### Task 7: Add UI Reconfiguration Controls

**Files:**
- Modify: `src/admin/client-script.ts`
- Modify: `src/admin/styles.ts`
- Modify: `test/admin-routes.test.ts`

- [ ] **Step 1: Write failing UI asset assertions**

In `test/admin-routes.test.ts`, extend the `"serves admin CSS and browser JavaScript assets"` test:

```ts
    expect(css.text).toContain(".edit-drawer");
    expect(css.text).toContain(".source-badge");
    expect(js.text).toContain("function sourceBadge");
    expect(js.text).toContain("function renderEditDrawer");
    expect(js.text).toContain('data-action="open-edit"');
    expect(js.text).toContain('data-action="reset-entity"');
    expect(js.text).toContain("patchJson");
```

Add to the boot smoke test:

```ts
    expect(root.innerHTML).toContain("Source");
```

- [ ] **Step 2: Run UI tests and verify failure**

Run:

```bash
npm test -- test/admin-routes.test.ts -t "serves admin CSS|boots"
```

Expected: FAIL because UI assets do not include edit drawer behavior.

- [ ] **Step 3: Add UI state and request helper**

In `src/admin/client-script.ts`, extend `UiState`:

```ts
    editEntity: { entityType: "brand" | "region" | "connection"; entityId: string } | null;
```

Initialize:

```ts
    editEntity: null
```

Add helper after `postJson`:

```ts
  async function patchJson(path: string, body: Item = {}): Promise<Item> {
    return requestJson(path, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  }
```

- [ ] **Step 4: Add source badge helpers**

Add after `statusBadge`:

```ts
  function metaFor(entityType: string, entityId: unknown): Item | undefined {
    return collection("entityMeta").find((meta) => meta.entityType === entityType && meta.entityId === entityId);
  }

  function sourceBadge(entityType: string, entityId: unknown): string {
    const meta = metaFor(entityType, entityId);
    const label = meta?.sourceLabel ?? "Fixture";
    const classes = ["source-badge", safeClass(meta?.source ?? "fixture")];
    if (meta?.hasOverride) {
      classes.push("has-override");
    }
    return `<span class="${classes.join(" ")}">${h(label)}</span>`;
  }
```

- [ ] **Step 5: Add edit actions to rows**

In `renderBrandList`, change each row action area to include source and edit:

```ts
          <div class="record-actions">
            ${sourceBadge("brand", brand.id)}
            ${statusBadge(brand.status)}
            <button class="btn btn-small" type="button" data-action="open-edit" data-entity-type="brand" data-entity-id="${h(brand.id)}">Edit</button>
          </div>
```

In `renderRegionList`, add the same pattern with `entity-type="region"`.

In `connectionRows`, add an `Edit` button beside `Test`:

```ts
            ${sourceBadge("connection", connection.id)}
            <button class="btn btn-small" type="button" data-action="open-edit" data-entity-type="connection" data-entity-id="${h(connection.id)}">Edit</button>
            <button class="btn" type="button" data-action="test-connection" data-connection-id="${h(connection.id)}">Test</button>
```

Add a `Source` table column to connection tables so `sourceBadge` has a stable place:

```html
<th>Source</th>
```

- [ ] **Step 6: Add edit drawer renderer**

Add before `render()`:

```ts
  function renderJsonTextarea(value: unknown): string {
    return h(JSON.stringify(value ?? {}, null, 2));
  }

  function renderEditDrawer(): string {
    const edit = uiState.editEntity;
    if (!edit) {
      return "";
    }
    const item = edit.entityType === "brand"
      ? byId("brands", edit.entityId)
      : edit.entityType === "region"
        ? byId("regions", edit.entityId)
        : byId("connections", edit.entityId);
    if (!item) {
      uiState.editEntity = null;
      return "";
    }
    const meta = metaFor(edit.entityType, edit.entityId);
    const canReset = Boolean(meta?.hasOverride);
    const title = edit.entityType === "brand"
      ? item.name
      : edit.entityType === "region"
        ? `${item.name} (${item.code})`
        : item.displayName;

    if (edit.entityType === "brand") {
      return `<aside class="edit-drawer">
        <div class="drawer-header">
          <div><h3>Edit brand</h3><p>${h(title)}</p></div>
          <button class="btn btn-small" type="button" data-action="close-edit">Close</button>
        </div>
        <div class="drawer-source">${sourceBadge("brand", item.id)}</div>
        <form data-action="update-brand" data-entity-id="${h(item.id)}" class="form-grid">
          <label class="span-2">Name<input name="name" value="${h(item.name)}"></label>
          <label class="span-2">Slug<input name="slug" value="${h(item.slug)}" ${meta?.source !== "gateway" ? "disabled" : ""}></label>
          <label class="span-2">Status<select name="status">
            <option value="active" ${item.status === "active" ? "selected" : ""}>active</option>
            <option value="disabled" ${item.status === "disabled" ? "selected" : ""}>disabled</option>
          </select></label>
          <div class="button-row span-2">
            <button class="btn btn-primary" type="submit">Save</button>
            ${canReset ? `<button class="btn" type="button" data-action="reset-entity" data-entity-type="brand" data-entity-id="${h(item.id)}">Reset to source</button>` : ""}
          </div>
        </form>
      </aside>`;
    }
    if (edit.entityType === "region") {
      return `<aside class="edit-drawer">
        <div class="drawer-header">
          <div><h3>Edit region</h3><p>${h(title)}</p></div>
          <button class="btn btn-small" type="button" data-action="close-edit">Close</button>
        </div>
        <div class="drawer-source">${sourceBadge("region", item.id)}</div>
        <form data-action="update-region" data-entity-id="${h(item.id)}" class="form-grid">
          <label>Code<input name="code" value="${h(item.code)}" ${meta?.source !== "gateway" ? "disabled" : ""}></label>
          <label>Status<select name="status">
            <option value="active" ${item.status === "active" ? "selected" : ""}>active</option>
            <option value="disabled" ${item.status === "disabled" ? "selected" : ""}>disabled</option>
          </select></label>
          <label class="span-2">Name<input name="name" value="${h(item.name)}"></label>
          <label class="span-2">Domain<input name="domain" value="${h(item.domain ?? "")}"></label>
          <div class="button-row span-2">
            <button class="btn btn-primary" type="submit">Save</button>
            ${canReset ? `<button class="btn" type="button" data-action="reset-entity" data-entity-type="region" data-entity-id="${h(item.id)}">Reset to source</button>` : ""}
          </div>
        </form>
      </aside>`;
    }
    const connector = connectorFor(item);
    const backendOptions = (connector?.backendOptions ?? [item.backendType]) as string[];
    return `<aside class="edit-drawer">
      <div class="drawer-header">
        <div><h3>Edit connection</h3><p>${h(title)}</p></div>
        <button class="btn btn-small" type="button" data-action="close-edit">Close</button>
      </div>
      <div class="drawer-source">${sourceBadge("connection", item.id)}</div>
      <form data-action="update-connection" data-entity-id="${h(item.id)}" class="form-grid">
        <label class="span-2">Display name<input name="displayName" value="${h(item.displayName)}"></label>
        <label>Backend<select name="backendType">
          ${backendOptions.map((backend) => `<option value="${h(backend)}" ${backend === item.backendType ? "selected" : ""}>${h(backend)}</option>`).join("")}
        </select></label>
        <label>Status<select name="status">
          ${["needs_config", "pending", "connected", "needs_reconnect", "error"].map((status) => `<option value="${h(status)}" ${status === item.status ? "selected" : ""}>${h(status)}</option>`).join("")}
        </select></label>
        <label class="span-2">Config summary JSON<textarea name="configSummaryJson" rows="8">${renderJsonTextarea(item.configSummary)}</textarea></label>
        <label class="span-2">Operator note<input name="lastError" value="${h(item.lastError ?? "")}"></label>
        <div class="button-row span-2">
          <button class="btn btn-primary" type="submit">Save</button>
          ${canReset ? `<button class="btn" type="button" data-action="reset-entity" data-entity-type="connection" data-entity-id="${h(item.id)}">Reset to source</button>` : ""}
        </div>
      </form>
    </aside>`;
  }
```

- [ ] **Step 7: Render drawer**

At the end of `render()`, after assigning `appRoot.innerHTML`, append:

```ts
    appRoot.innerHTML = `${(views[uiState.view] ?? renderOverview)()}${renderEditDrawer()}`;
```

- [ ] **Step 8: Handle update submits**

In `handleSubmit`, after create-connection handling, add:

```ts
    if (action === "update-brand") {
      const entityId = form.dataset.entityId;
      if (!entityId) throw new Error("Missing brand id.");
      const result = await patchJson(`/admin/api/brands/${encodeURIComponent(entityId)}`, {
        name: field(form, "name"),
        slug: field(form, "slug"),
        status: field(form, "status")
      });
      applyState(result.state);
      render();
      return;
    }
    if (action === "update-region") {
      const entityId = form.dataset.entityId;
      if (!entityId) throw new Error("Missing region id.");
      const result = await patchJson(`/admin/api/regions/${encodeURIComponent(entityId)}`, {
        code: field(form, "code"),
        name: field(form, "name"),
        domain: field(form, "domain"),
        status: field(form, "status")
      });
      applyState(result.state);
      render();
      return;
    }
    if (action === "update-connection") {
      const entityId = form.dataset.entityId;
      if (!entityId) throw new Error("Missing connection id.");
      const rawConfig = field(form, "configSummaryJson") ?? "{}";
      let configSummary: Item;
      try {
        configSummary = JSON.parse(rawConfig) as Item;
      } catch {
        throw new Error("Config summary must be valid JSON.");
      }
      const lastError = field(form, "lastError");
      const result = await patchJson(`/admin/api/connections/${encodeURIComponent(entityId)}`, {
        backendType: field(form, "backendType"),
        displayName: field(form, "displayName"),
        status: field(form, "status"),
        configSummary,
        lastError: lastError ?? null
      });
      applyState(result.state);
      render();
    }
```

- [ ] **Step 9: Handle drawer buttons**

In `handleButton`, add before connection test:

```ts
    if (action === "open-edit" && button.dataset.entityType && button.dataset.entityId) {
      uiState.editEntity = {
        entityType: button.dataset.entityType as "brand" | "region" | "connection",
        entityId: button.dataset.entityId
      };
      render();
      return;
    }
    if (action === "close-edit") {
      uiState.editEntity = null;
      render();
      return;
    }
    if (action === "reset-entity" && button.dataset.entityType && button.dataset.entityId) {
      const result = await postJson(
        `/admin/api/entities/${encodeURIComponent(button.dataset.entityType)}/${encodeURIComponent(button.dataset.entityId)}/reset`
      );
      applyState(result.state);
      uiState.editEntity = null;
      render();
      return;
    }
```

- [ ] **Step 10: Add styles**

Append to `src/admin/styles.ts` before media queries:

```css
.record-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
  align-items: center;
}

.btn-small {
  min-height: 26px;
  padding: 4px 8px;
  font-size: 12px;
}

.source-badge {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 2px 7px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: #f2f5f7;
  color: #4b5a66;
  font-size: 12px;
  font-weight: 650;
  white-space: nowrap;
}

.source-badge.gateway {
  background: #e6f4ed;
  color: var(--success);
}

.source-badge.dev_api,
.source-badge.fixture {
  background: #e8eefb;
  color: var(--info);
}

.source-badge.has-override {
  background: #fff4df;
  color: var(--warning);
}

.edit-drawer {
  position: fixed;
  top: 0;
  right: 0;
  z-index: 20;
  width: min(460px, 100vw);
  height: 100vh;
  overflow-y: auto;
  padding: 16px;
  border-left: 1px solid var(--line-strong);
  background: var(--panel);
  box-shadow: -10px 0 28px rgba(23, 34, 43, 0.16);
}

.drawer-header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
  margin-bottom: 12px;
}

.drawer-header p,
.drawer-source {
  margin-bottom: 12px;
  color: var(--muted);
}

textarea {
  width: 100%;
  min-height: 140px;
  padding: 8px 9px;
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  resize: vertical;
  font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
}
```

- [ ] **Step 11: Run UI tests**

Run:

```bash
npm test -- test/admin-routes.test.ts
npm run typecheck
```

Expected: PASS and `new Function(js.text)` still does not throw.

- [ ] **Step 12: Commit**

Run:

```bash
git add src/admin/client-script.ts src/admin/styles.ts test/admin-routes.test.ts
git commit -m "feat: add admin reconfiguration UI"
```

---

### Task 8: Document Overlay Modes And Run Full Verification

**Files:**
- Modify: `README.md`
- Modify: `.env.example`
- Modify: `docs/superpowers/specs/2026-06-02-haverford-unified-gateway-phase-1-5-reconfiguration-overlay-design.md`

- [ ] **Step 1: Update README admin mode docs**

In `README.md`, update the admin section so it includes:

````md
### Fixture Overlay Mode

Use this when you want local persistence without a running Haverford Dev API:

```bash
ADMIN_DATA_SOURCE=fixture-overlay \
GATEWAY_STORE_PATH=./data/gateway.sqlite \
COMPOSIO_API_KEY=ak_local_dummy \
BRAND_SLUG=haverford \
GATEWAY_BEARER=a_secret_thats_long_enough \
npm run dev
```

### Dev API Overlay Mode

Use this for the transition path where Dev API supplies the imported source records and the gateway stores edits/new records:

```bash
ADMIN_DATA_SOURCE=dev-api-overlay \
GATEWAY_STORE_PATH=./data/gateway.sqlite \
HAVERFORD_DEV_API_BASE_URL=http://127.0.0.1:3001 \
HAVERFORD_DEV_API_CLIENT_ID=<internal-client-id> \
HAVERFORD_DEV_API_CLIENT_SECRET=<internal-client-secret> \
COMPOSIO_API_KEY=ak_local_dummy \
BRAND_SLUG=haverford \
GATEWAY_BEARER=a_secret_thats_long_enough \
npm run dev
```

Production deployments should mount the app data volume and set `GATEWAY_STORE_PATH=/data/gateway.sqlite`.
````

- [ ] **Step 2: Mark Phase 1.5 spec as approved for implementation**

Change the spec status line to:

```md
**Status:** approved for implementation  
```

- [ ] **Step 3: Run full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 4: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Run production build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 6: Smoke test fixture-overlay persistence**

Run:

```bash
rm -f ./data/gateway.sqlite
ADMIN_DATA_SOURCE=fixture-overlay \
GATEWAY_STORE_PATH=./data/gateway.sqlite \
COMPOSIO_API_KEY=ak_local_dummy \
BRAND_SLUG=haverford \
GATEWAY_BEARER=a_secret_thats_long_enough \
PORT=3002 \
npm run dev
```

In another terminal, run:

```bash
curl -s -X POST http://127.0.0.1:3002/admin/api/brands \
  -H 'content-type: application/json' \
  -d '{"name":"Smoke Overlay","slug":"smoke-overlay"}' | jq '.brand.slug'
```

Expected:

```text
"smoke-overlay"
```

Stop and restart the gateway with the same command, then run:

```bash
curl -s http://127.0.0.1:3002/admin/api/state | jq '.brands[] | select(.slug=="smoke-overlay") | .name'
```

Expected:

```text
"Smoke Overlay"
```

- [ ] **Step 7: Commit docs and verification notes**

Run:

```bash
git add README.md .env.example docs/superpowers/specs/2026-06-02-haverford-unified-gateway-phase-1-5-reconfiguration-overlay-design.md
git commit -m "docs: document gateway overlay mode"
```

---

## Final Verification

Run after Task 8:

```bash
npm test
npm run typecheck
npm run build
```

Expected: all commands pass.

Then, if the local Haverford Dev API is available on port `3001`, run the gateway in `dev-api-overlay` mode and verify the UI opens:

```bash
ADMIN_DATA_SOURCE=dev-api-overlay \
GATEWAY_STORE_PATH=./data/gateway-dev-api-overlay.sqlite \
HAVERFORD_DEV_API_BASE_URL=http://127.0.0.1:3001 \
HAVERFORD_DEV_API_CLIENT_ID="$HAVERFORD_DEV_API_CLIENT_ID" \
HAVERFORD_DEV_API_CLIENT_SECRET="$HAVERFORD_DEV_API_CLIENT_SECRET" \
COMPOSIO_API_KEY=ak_local_dummy \
BRAND_SLUG=haverford \
GATEWAY_BEARER=a_secret_thats_long_enough \
PORT=3002 \
npm run dev
```

Open:

```bash
rtk open http://localhost:3002/admin
```

Verify in the UI:

- A Dev API-imported brand has `Source: Dev API`.
- Editing it changes the visible value and source badge to `Dev API + Gateway override`.
- Resetting it restores the source value.
- Creating a new brand shows `Source: Gateway`.

## Plan Self-Review

- Spec coverage: storage, overlay merge, update/reset API, UI controls, source badges, local persistence, and docs are covered.
- No real OAuth, Nango, Composio mutation, native connector execution, MCP read gateway, app dashboard, or API access persistence is included.
- Type names are consistent across tasks: `OverlayGatewayBackend`, `GatewayOverlayStore`, `GatewayEntityMeta`, `UpdateBrandInput`, `UpdateRegionInput`, `UpdateConnectionInput`, `ResetEntityInput`.
- Verification includes unit tests, route tests, typecheck, build, and a local fixture-overlay persistence smoke test.
