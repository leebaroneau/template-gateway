# Haverford Unified Gateway Phase 2 Access API Front Door Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first versioned Haverford Gateway API front door so current brand, region, connector, connection, and API access metadata can be served from the gateway with persistent API keys.

**Architecture:** Reuse the Phase 1.5 `GatewayConnectionBackend` as the canonical read model for brand hierarchy and connection metadata. Add a focused access store on the same `/data/gateway.sqlite` volume, then mount a scoped `/api/v1` router and wire the admin UI/API to create, rotate, revoke, and audit gateway API clients and keys.

**Tech Stack:** Node 20, TypeScript, Express 4, `better-sqlite3`, Node `crypto`, Vitest, Supertest.

---

## Phase Gate Before Code

This phase must start with the standing Haverford phase-gate check.

- Confirm Phase 1.5 merged behavior against `docs/superpowers/specs/2026-06-02-haverford-unified-gateway-phase-1-5-reconfiguration-overlay-design.md`.
- Confirm `npm test`, `npm run typecheck`, `npm run build`, and the fixture-overlay persistence smoke still pass before changing code.
- If a gap is found, fix that gap and commit it before starting Phase 2.
- Current clone has no `.github/pipeline-config.yml`; if one appears at execution time, stop and follow Pipeline Core issue -> branch -> PR sequence.
- Create an implementation branch from current `main`, for example:

```bash
git switch -c story/19-phase-2-access-api-front-door
```

## File Structure

Create focused new modules:

- `src/access/types.ts` - API scopes, API clients, API keys, one-time secret response types, usage rows, and validation helpers.
- `src/access/secret.ts` - API key generation, preview, fingerprinting, scrypt hashing, and timing-safe verification.
- `src/access/store.ts` - `GatewayAccessStore` backed by the existing SQLite file and responsible for API clients, keys, usage, and access audit writes.
- `src/api/errors.ts` - structured `/api/v1` error response helpers.
- `src/api/resources.ts` - conversion from `GatewayState` to public `/api/v1` resources, including `setupMode`, `runtimeStatus`, `migrationStatus`, and safe `credentialRef`.
- `src/api/auth.ts` - scoped API-key authentication middleware for `/api/v1`.
- `src/api/routes.ts` - read-only versioned gateway API router.

Modify existing modules:

- `src/admin/types.ts` - expand audit actions and keep admin dashboard API client shape aligned with the access store.
- `src/admin/routes.ts` - accept an optional `GatewayAccessStore`, add API client/key create/update routes, and use persistent key rotation/revocation when the store is available.
- `src/admin/client-script.ts` - add operational controls for creating clients, creating keys, copying one-time secrets, rotating, revoking, and viewing scopes/usage/audit.
- `src/admin/styles.ts` - add compact admin-tool styling for the new access controls.
- `src/index.ts` - instantiate one access store from `config.gatewayStorePath`, pass it into `/admin`, and mount `/api/v1`.
- `README.md` - document local `/api/v1` usage and smoke commands.

Add tests:

- `test/access-secret.test.ts`
- `test/access-store.test.ts`
- `test/api-resources.test.ts`
- `test/api-routes.test.ts`
- Extend `test/admin-routes.test.ts`
- No dedicated admin UI DOM test file exists in the current repo; verify UI script/style changes with `npm run build` unless an admin asset test is added during implementation.

## Task 0: Phase Gate And Working Branch

**Files:**
- Read: `docs/superpowers/specs/2026-06-02-haverford-unified-gateway-phase-1-5-reconfiguration-overlay-design.md`
- Read: `docs/superpowers/specs/2026-06-04-haverford-unified-gateway-phase-2-access-api-front-door-design.md`

- [ ] **Step 1: Confirm the repository state**

```bash
git status --short --branch
test -f .github/pipeline-config.yml && echo "pipeline=yes" || echo "pipeline=no"
```

Expected: no unexpected tracked changes. The known unrelated untracked file `scripts/fix-pipedrive-connection.mjs` can remain untouched.

- [ ] **Step 2: Run the Phase 1.5 verification suite**

```bash
npm test
npm run typecheck
npm run build
```

Expected: all pass before Phase 2 edits begin.

- [ ] **Step 3: Run the fixture-overlay persistence smoke**

Start the gateway:

```bash
export ADMIN_DATA_SOURCE=fixture-overlay
export GATEWAY_STORE_PATH="$(mktemp -d)/gateway-phase-gate.sqlite"
export PORT=3100
npm run dev
```

In a second terminal, create a gateway-owned brand:

```bash
curl -s http://localhost:3100/admin/api/brands \
  -H 'Content-Type: application/json' \
  -d '{"name":"Phase Gate Brand","slug":"phase-gate-brand"}'
```

Stop `npm run dev`, restart it with the same `GATEWAY_STORE_PATH`, then confirm the brand persisted:

```bash
curl -s http://localhost:3100/admin/api/state | rg "phase-gate-brand"
```

Expected: `phase-gate-brand` appears after restart.

- [ ] **Step 4: Create the Phase 2 branch**

```bash
git switch -c story/19-phase-2-access-api-front-door
```

Expected: branch created from current `main`.

## Task 1: Access Types And Secret Utilities

**Files:**
- Create: `src/access/types.ts`
- Create: `src/access/secret.ts`
- Create: `test/access-secret.test.ts`
- Modify: `src/admin/types.ts`

- [ ] **Step 1: Write the failing secret utility tests**

Create `test/access-secret.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  createApiKeySecret,
  fingerprintApiKeySecret,
  hashApiKeySecret,
  previewApiKeySecret,
  verifyApiKeySecret
} from "../src/access/secret.js";

describe("API key secret utilities", () => {
  it("generates gateway-prefixed one-time secrets", () => {
    const secret = createApiKeySecret();

    expect(secret).toMatch(/^gw_live_[A-Za-z0-9_-]{32,}$/);
    expect(previewApiKeySecret(secret)).toMatch(/^gw_live_.*[A-Za-z0-9_-]{4}$/);
    expect(fingerprintApiKeySecret(secret)).toMatch(/^[a-f0-9]{16}$/);
  });

  it("hashes and verifies secrets without storing the raw value", () => {
    const secret = createApiKeySecret();
    const hash = hashApiKeySecret(secret);

    expect(hash).toMatch(/^scrypt\\$/);
    expect(hash).not.toContain(secret);
    expect(verifyApiKeySecret(secret, hash)).toBe(true);
    expect(verifyApiKeySecret(`${secret}x`, hash)).toBe(false);
  });

  it("uses stable fingerprints for the same secret", () => {
    const secret = createApiKeySecret();

    expect(fingerprintApiKeySecret(secret)).toBe(fingerprintApiKeySecret(secret));
    expect(fingerprintApiKeySecret(secret)).not.toBe(fingerprintApiKeySecret(createApiKeySecret()));
  });
});
```

- [ ] **Step 2: Run the failing test**

```bash
npm test -- test/access-secret.test.ts
```

Expected: fail because `src/access/secret.ts` does not exist.

- [ ] **Step 3: Add access type definitions**

Create `src/access/types.ts`:

```ts
import type { ApiClient, ApiKey, AuditEvent } from "../admin/types.js";

export const gatewayApiScopes = [
  "brands.read",
  "regions.read",
  "connectors.read",
  "connections.read",
  "api_clients.read",
  "api_clients.write",
  "audit.read"
] as const;

export type GatewayApiScope = (typeof gatewayApiScopes)[number];
export type GatewayApiClientType = ApiClient["type"];
export type GatewayApiClientStatus = ApiClient["status"];
export type GatewayApiKeyStatus = ApiKey["status"];

export interface CreateApiClientInput {
  name: string;
  type: GatewayApiClientType;
  owner: string;
  scopes: GatewayApiScope[];
}

export interface UpdateApiClientInput {
  name?: string;
  type?: GatewayApiClientType;
  owner?: string;
  scopes?: GatewayApiScope[];
  status?: GatewayApiClientStatus;
}

export interface CreateApiKeyInput {
  label: string;
}

export interface ApiKeyWithSecret {
  key: ApiKey;
  secret: string;
}

export interface AuthenticatedGatewayApiClient {
  client: ApiClient;
  key: ApiKey;
}

export interface RecordApiUsageInput {
  clientId?: string;
  keyId?: string;
  route: string;
  method: string;
  statusCode: number;
  scope?: GatewayApiScope;
  durationMs?: number;
}

export interface AccessAuditInput {
  action: AuditEvent["action"];
  targetType: AuditEvent["targetType"];
  targetId: string;
  detail: string;
  actor: string;
  metadata?: Record<string, string>;
}

export function isGatewayApiScope(value: string): value is GatewayApiScope {
  return (gatewayApiScopes as readonly string[]).includes(value);
}

export function validateGatewayApiScopes(values: unknown): GatewayApiScope[] {
  if (!Array.isArray(values)) {
    throw new Error("scopes must be an array");
  }
  const scopes = values.map((value) => {
    if (typeof value !== "string" || !isGatewayApiScope(value)) {
      throw new Error(`Unknown API scope: ${String(value)}`);
    }
    return value;
  });
  return Array.from(new Set(scopes));
}

export function scopeAllowed(clientScopes: readonly string[], requiredScope: GatewayApiScope): boolean {
  if (requiredScope === "api_clients.read" && clientScopes.includes("api_clients.write")) {
    return true;
  }
  return clientScopes.includes(requiredScope);
}
```

- [ ] **Step 4: Add the secret utility implementation**

Create `src/access/secret.ts`:

```ts
import crypto from "node:crypto";

const SECRET_PREFIX = "gw_live_";
const SCRYPT_KEY_LENGTH = 32;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };

export function createApiKeySecret(): string {
  return `${SECRET_PREFIX}${crypto.randomBytes(32).toString("base64url")}`;
}

export function previewApiKeySecret(secret: string): string {
  return `${SECRET_PREFIX}...${secret.slice(-4)}`;
}

export function fingerprintApiKeySecret(secret: string): string {
  return crypto.createHash("sha256").update(secret).digest("hex").slice(0, 16);
}

export function hashApiKeySecret(secret: string): string {
  const salt = crypto.randomBytes(16).toString("base64url");
  const derived = crypto.scryptSync(secret, salt, SCRYPT_KEY_LENGTH, SCRYPT_PARAMS).toString("base64url");
  return `scrypt$${SCRYPT_PARAMS.N}$${SCRYPT_PARAMS.r}$${SCRYPT_PARAMS.p}$${salt}$${derived}`;
}

export function verifyApiKeySecret(secret: string, storedHash: string): boolean {
  const parts = storedHash.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") {
    return false;
  }
  const [, nValue, rValue, pValue, salt, expectedValue] = parts;
  const expected = Buffer.from(expectedValue, "base64url");
  const actual = crypto.scryptSync(secret, salt, expected.length, {
    N: Number(nValue),
    r: Number(rValue),
    p: Number(pValue)
  });
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}
```

- [ ] **Step 5: Expand audit actions**

Modify `src/admin/types.ts` so `AuditAction` includes the Phase 2 actions:

```ts
export type AuditAction =
  | "brand.created"
  | "brand.updated"
  | "region.created"
  | "region.updated"
  | "connection.saved"
  | "connection.updated"
  | "connection.tested"
  | "entity.reset"
  | "api_client.created"
  | "api_client.updated"
  | "api_client.revoked"
  | "api_key.created"
  | "api_key.rotated"
  | "api_key.revoked"
  | "api_auth.succeeded"
  | "api_auth.failed"
  | "api_scope.denied"
  | "api_read.succeeded"
  | "api_read.failed";
```

- [ ] **Step 6: Verify and commit**

```bash
npm test -- test/access-secret.test.ts
npm run typecheck
git add src/access/types.ts src/access/secret.ts src/admin/types.ts test/access-secret.test.ts
git commit -m "feat: add gateway api secret utilities"
```

Expected: tests and typecheck pass.

## Task 2: Persistent Access Store

**Files:**
- Modify: `src/admin/backend-error.ts`
- Create: `src/access/store.ts`
- Create: `test/access-store.test.ts`

- [ ] **Step 1: Write failing store lifecycle tests**

Create `test/access-store.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GatewayAccessStore } from "../src/access/store.js";

function tempStorePath(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "gateway-access-store-")), "gateway.sqlite");
}

describe("GatewayAccessStore", () => {
  const stores: GatewayAccessStore[] = [];

  afterEach(() => {
    while (stores.length > 0) {
      stores.pop()?.close();
    }
  });

  function openStore(dbPath = tempStorePath()): GatewayAccessStore {
    const store = new GatewayAccessStore(dbPath);
    stores.push(store);
    return store;
  }

  it("creates clients and reveals key secrets once", () => {
    const store = openStore();
    const client = store.createClient(
      { name: "Dashboard App", type: "service", owner: "ops@haverford.au", scopes: ["brands.read"] },
      "local-admin"
    );
    const created = store.createKey(client.id, { label: "local smoke" }, "local-admin");

    expect(created.secret).toMatch(/^gw_live_/);
    expect(created.key.preview).toMatch(/^gw_live_\\.\\.\\./);
    expect(store.listApiClients()[0].keys[0]).not.toHaveProperty("secret");
    expect(store.authenticate(created.secret)?.client.id).toBe(client.id);
  });

  it("persists clients and active keys across store restarts", () => {
    const dbPath = tempStorePath();
    const firstStore = openStore(dbPath);
    const client = firstStore.createClient(
      { name: "MCP Reader", type: "agent", owner: "mcp@haverford.au", scopes: ["connections.read"] },
      "local-admin"
    );
    const created = firstStore.createKey(client.id, { label: "reader" }, "local-admin");
    firstStore.close();
    stores.pop();

    const secondStore = openStore(dbPath);
    expect(secondStore.authenticate(created.secret)?.client.name).toBe("MCP Reader");
    expect(secondStore.listApiClients()).toHaveLength(1);
  });

  it("rotates a key in place and invalidates the old secret immediately", () => {
    const store = openStore();
    const client = store.createClient(
      { name: "Rotation Client", type: "worker", owner: "ops@haverford.au", scopes: ["brands.read"] },
      "local-admin"
    );
    const created = store.createKey(client.id, { label: "primary" }, "local-admin");
    const rotated = store.rotateKey(client.id, created.key.id, "local-admin");

    expect(rotated.key.id).toBe(created.key.id);
    expect(rotated.secret).not.toBe(created.secret);
    expect(store.authenticate(created.secret)).toBeUndefined();
    expect(store.authenticate(rotated.secret)?.key.id).toBe(created.key.id);
    expect(store.listApiClients()[0].keys[0].rotatedAt).toBeDefined();
  });

  it("blocks revoked keys and revoked clients", () => {
    const store = openStore();
    const client = store.createClient(
      { name: "Revocation Client", type: "service", owner: "ops@haverford.au", scopes: ["brands.read"] },
      "local-admin"
    );
    const created = store.createKey(client.id, { label: "primary" }, "local-admin");

    store.revokeKey(client.id, created.key.id, "local-admin");
    expect(store.authenticate(created.secret)).toBeUndefined();

    const second = store.createKey(client.id, { label: "replacement" }, "local-admin");
    store.updateClient(client.id, { status: "revoked" }, "local-admin");
    expect(store.authenticate(second.secret)).toBeUndefined();
  });

  it("records usage and access audit without raw secrets", () => {
    const store = openStore();
    const client = store.createClient(
      { name: "Usage Client", type: "service", owner: "ops@haverford.au", scopes: ["brands.read"] },
      "local-admin"
    );
    const key = store.createKey(client.id, { label: "primary" }, "local-admin").key;

    store.recordUsage({
      clientId: client.id,
      keyId: key.id,
      route: "/api/v1/brands",
      method: "GET",
      statusCode: 200,
      scope: "brands.read",
      durationMs: 12
    });
    store.writeAccessAudit({
      action: "api_read.succeeded",
      targetType: "api_client",
      targetId: client.id,
      detail: "Read /api/v1/brands",
      actor: client.id,
      metadata: { fingerprint: key.fingerprint, route: "/api/v1/brands" }
    });

    const listed = store.listApiClients()[0];
    expect(listed.requestCount24h).toBe(1);
    expect(listed.errorRate24h).toBe(0);
    expect(store.listAuditEvents()[0].metadata).not.toEqual(expect.objectContaining({ secret: expect.any(String) }));
  });

  it("rejects unknown scopes and duplicate key labels under one client", () => {
    const store = openStore();
    expect(() =>
      store.createClient(
        { name: "Bad Scopes", type: "service", owner: "ops@haverford.au", scopes: ["bad.scope" as any] },
        "local-admin"
      )
    ).toThrow("Unknown API scope: bad.scope");

    const client = store.createClient(
      { name: "Duplicate Labels", type: "service", owner: "ops@haverford.au", scopes: ["brands.read"] },
      "local-admin"
    );
    store.createKey(client.id, { label: "primary" }, "local-admin");
    expect(() => store.createKey(client.id, { label: "primary" }, "local-admin")).toThrow(
      "API key label already exists for client"
    );
  });
});
```

- [ ] **Step 2: Run the failing store tests**

```bash
npm test -- test/access-store.test.ts
```

Expected: fail because `GatewayAccessStore` does not exist.

- [ ] **Step 3: Implement `GatewayAccessStore` schema and methods**

Modify `src/admin/backend-error.ts` before implementing store mutations so admin routes can return `409` for access-store conflicts without coupling every route to string matching:

```ts
export class AdminBackendError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "AdminBackendError";
    this.statusCode = statusCode;
  }
}

function hasStatusCode(error: unknown): error is { statusCode: number } {
  return Boolean(error && typeof error === "object" && typeof (error as { statusCode?: unknown }).statusCode === "number");
}

export function statusCodeForAdminError(error: unknown): number {
  if (error instanceof AdminBackendError || hasStatusCode(error)) {
    return error.statusCode;
  }
  return 400;
}
```

Create `src/access/store.ts` with these exported APIs:

```ts
export class AccessStoreError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = "AccessStoreError";
  }
}

export class GatewayAccessStore {
  constructor(dbPath: string);
  close(): void;
  listApiClients(): ApiClient[];
  createClient(input: CreateApiClientInput, actor: string): ApiClient;
  updateClient(clientId: string, input: UpdateApiClientInput, actor: string): ApiClient;
  createKey(clientId: string, input: CreateApiKeyInput, actor: string): ApiKeyWithSecret;
  rotateKey(clientId: string, keyId: string, actor: string): ApiKeyWithSecret;
  revokeKey(clientId: string, keyId: string, actor: string): ApiKey;
  authenticate(secret: string): AuthenticatedGatewayApiClient | undefined;
  recordUsage(input: RecordApiUsageInput): void;
  writeAccessAudit(input: AccessAuditInput): void;
  listAuditEvents(): AuditEvent[];
}
```

The implementation must:

- Create `gateway_schema_migrations` if missing so it can share the SQLite file with `GatewayOverlayStore`.
- Create `gateway_audit_events` if missing using the same columns as `src/admin/overlay-store.ts`.
- Create `gateway_api_clients`, `gateway_api_keys`, and `gateway_api_usage` exactly as defined in the Phase 2 spec.
- Use ids with stable prefixes: `api_client_`, `api_key_`, `api_usage_`, and `gateway_audit_`.
- Store scopes as sorted JSON after `validateGatewayApiScopes`.
- Use `createApiKeySecret`, `hashApiKeySecret`, `previewApiKeySecret`, and `fingerprintApiKeySecret`.
- Return raw `secret` only from `createKey` and `rotateKey`.
- Keep the same key id on rotation and replace `secret_hash`, `preview`, `fingerprint`, `rotated_at`, and `rotated_by`.
- Reject duplicate active key labels for the same client with `API key label already exists for client: <label>`.
- Update `last_used_at` for the key and client inside `authenticate`.
- Return `undefined` from `authenticate` for malformed secrets, unknown fingerprints, revoked keys, and revoked clients.
- Compute `requestCount24h` and `errorRate24h` from `gateway_api_usage`.
- Write audit events for client create/update/revoke and key create/rotate/revoke.
- Throw `new AccessStoreError(409, "API key label already exists for client: <label>")` for duplicate active key labels.
- Throw `new AccessStoreError(409, "API client already exists: <id>")` for duplicate generated or supplied client ids if the implementation allows id input.
- Throw `new AccessStoreError(404, "API client not found: <clientId>")` or `new AccessStoreError(404, "API key not found: <keyId>")` for missing mutation targets.

Use `better-sqlite3` transactions for create client, create key, rotate, revoke, authenticate last-used update, and usage insert.

- [ ] **Step 4: Verify and commit**

```bash
npm test -- test/access-secret.test.ts test/access-store.test.ts
npm run typecheck
git add src/admin/backend-error.ts src/access/store.ts test/access-store.test.ts
git commit -m "feat: persist gateway api clients"
```

Expected: tests and typecheck pass.

## Task 3: Public API Resource Mapping

**Files:**
- Create: `src/api/resources.ts`
- Create: `test/api-resources.test.ts`

- [ ] **Step 1: Write failing resource mapper tests**

Create `test/api-resources.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { toConnectionApiResource, toGatewayApiResources } from "../src/api/resources.js";
import type { GatewayState } from "../src/admin/types.js";

const baseState: GatewayState = {
  brands: [{ id: "brand_haverford", name: "Haverford", slug: "haverford", status: "active" }],
  regions: [{ id: "region_au", brandId: "brand_haverford", code: "AU", name: "Australia", status: "active" }],
  connectors: [
    {
      id: "connector_shopify",
      slug: "shopify",
      name: "Shopify",
      category: "commerce",
      authMode: "api_key",
      backendOptions: ["native"],
      requiredFields: [],
      scopes: ["orders.read"],
      description: "Shopify storefront"
    }
  ],
  connections: [],
  apiClients: [],
  auditEvents: [],
  entityMeta: []
};

describe("gateway API resources", () => {
  it("marks Dev API imported connections as current metadata-only setup", () => {
    const state: GatewayState = {
      ...baseState,
      connections: [
        {
          id: "connection_shopify_au",
          brandId: "brand_haverford",
          regionId: "region_au",
          connectorId: "connector_shopify",
          backendType: "native",
          displayName: "Shopify AU",
          status: "connected",
          configSummary: { shop_domain: "haverford.myshopify.com" }
        }
      ],
      entityMeta: [
        {
          entityType: "connection",
          entityId: "connection_shopify_au",
          source: "dev_api",
          hasOverride: false,
          overrideFields: [],
          sourceLabel: "Dev API"
        }
      ]
    };

    expect(toConnectionApiResource(state, state.connections[0])).toEqual(
      expect.objectContaining({
        id: "connection_shopify_au",
        setupMode: "current",
        runtimeStatus: "metadata_only",
        migrationStatus: "not_started",
        source: "dev_api"
      })
    );
  });

  it("marks gateway-owned connections as manual references without pretending OAuth is ready", () => {
    const state: GatewayState = {
      ...baseState,
      connections: [
        {
          id: "connection_manual",
          brandId: "brand_haverford",
          regionId: "region_au",
          connectorId: "connector_shopify",
          backendType: "native",
          displayName: "Manual Shopify",
          status: "needs_config",
          configSummary: { credential_group: "shopify-au-current" }
        }
      ],
      entityMeta: [
        {
          entityType: "connection",
          entityId: "connection_manual",
          source: "gateway",
          hasOverride: false,
          overrideFields: [],
          sourceLabel: "Gateway"
        }
      ]
    };

    expect(toConnectionApiResource(state, state.connections[0])).toEqual(
      expect.objectContaining({
        setupMode: "manual_ref",
        runtimeStatus: "metadata_only",
        migrationStatus: "not_started",
        credentialRef: "shopify-au-current"
      })
    );
  });

  it("does not expose forbidden secret-like credential references", () => {
    const state: GatewayState = {
      ...baseState,
      connections: [
        {
          id: "connection_leaky",
          brandId: "brand_haverford",
          regionId: "region_au",
          connectorId: "connector_shopify",
          backendType: "native",
          displayName: "Leaky Shopify",
          status: "needs_config",
          configSummary: {
            credential_ref: "Bearer ya29.secret",
            credential_group: "safe-group"
          }
        }
      ]
    };

    const resource = toConnectionApiResource(state, state.connections[0]);

    expect(resource.credentialRef).toBe("safe-group");
    expect(JSON.stringify(resource)).not.toContain("ya29.secret");
  });

  it("returns stable resource collections", () => {
    const state: GatewayState = {
      ...baseState,
      connections: [
        {
          id: "connection_shopify_au",
          brandId: "brand_haverford",
          regionId: "region_au",
          connectorId: "connector_shopify",
          backendType: "native",
          displayName: "Shopify AU",
          status: "connected",
          configSummary: {}
        }
      ]
    };

    expect(toGatewayApiResources(state).brands).toHaveLength(1);
    expect(toGatewayApiResources(state).regions).toHaveLength(1);
    expect(toGatewayApiResources(state).connectors).toHaveLength(1);
    expect(toGatewayApiResources(state).connections[0].runtimeStatus).toBe("metadata_only");
  });
});
```

- [ ] **Step 2: Run the failing mapper tests**

```bash
npm test -- test/api-resources.test.ts
```

Expected: fail because `src/api/resources.ts` does not exist.

- [ ] **Step 3: Implement public resource mapping**

Create `src/api/resources.ts` with these exported types and functions:

```ts
import type { Brand, Connection, Connector, GatewayBackendType, GatewayEntitySource, GatewayState, Region } from "../admin/types.js";

export type GatewaySetupMode = "current" | "manual_ref" | "oauth_managed";
export type GatewayRuntimeStatus = "metadata_only" | "read_proxy_ready" | "oauth_ready";
export type GatewayMigrationStatus = "not_started" | "oauth_ready" | "migrated";

export interface GatewayConnectionApiResource {
  id: string;
  brandId: string;
  regionId: string;
  connectorId: string;
  backendType: GatewayBackendType;
  displayName: string;
  status: Connection["status"];
  setupMode: GatewaySetupMode;
  runtimeStatus: GatewayRuntimeStatus;
  migrationStatus: GatewayMigrationStatus;
  source: GatewayEntitySource;
  configSummary: Record<string, string>;
  credentialRef?: string;
}

export interface GatewayApiResources {
  brands: Brand[];
  regions: Region[];
  connectors: Connector[];
  connections: GatewayConnectionApiResource[];
}
```

Implementation rules:

- `toGatewayApiResources(state)` returns shallow copies of `brands`, `regions`, and `connectors`, plus mapped connections.
- `toConnectionApiResource(state, connection)` reads connection source from `state.entityMeta`; default source is `"fixture"` when metadata is absent.
- Source `"gateway"` maps to `setupMode: "manual_ref"`; source `"dev_api"` and `"fixture"` map to `setupMode: "current"`.
- Every Phase 2 connection maps to `runtimeStatus: "metadata_only"` and `migrationStatus: "not_started"`.
- `credentialRef` is selected from `credential_ref`, `credentialRef`, then `credential_group`, but only when the value is a safe non-secret string.
- A safe credential reference is 1-160 characters and does not match `bearer`, `token`, `secret`, `password`, `private_key`, `BEGIN`, `ya29`, `shpat_`, `xox`, `sk_`, `{`, or `}` case-insensitively.

- [ ] **Step 4: Verify and commit**

```bash
npm test -- test/api-resources.test.ts
npm run typecheck
git add src/api/resources.ts test/api-resources.test.ts
git commit -m "feat: map gateway api resources"
```

Expected: tests and typecheck pass.

## Task 4: Scoped API Auth And `/api/v1` Router

**Files:**
- Create: `src/api/errors.ts`
- Create: `src/api/auth.ts`
- Create: `src/api/routes.ts`
- Create: `test/api-routes.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write failing `/api/v1` route tests**

Create `test/api-routes.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { GatewayAccessStore } from "../src/access/store.js";
import { FixtureGatewayBackend } from "../src/admin/fixture-backend.js";
import { createGatewayApiRouter } from "../src/api/routes.js";
import express from "express";

function tempStorePath(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "gateway-api-routes-")), "gateway.sqlite");
}

function appWithStore(store: GatewayAccessStore, backend = new FixtureGatewayBackend()) {
  const app = express();
  app.use("/api/v1", createGatewayApiRouter({ backend, accessStore: store }));
  return app;
}

describe("/api/v1 gateway API routes", () => {
  const stores: GatewayAccessStore[] = [];

  afterEach(() => {
    while (stores.length > 0) {
      stores.pop()?.close();
    }
  });

  function openStore(): GatewayAccessStore {
    const store = new GatewayAccessStore(tempStorePath());
    stores.push(store);
    return store;
  }

  function createSecret(store: GatewayAccessStore, scopes: any[] = ["brands.read", "regions.read", "connectors.read", "connections.read"]): string {
    const client = store.createClient({ name: "Test Client", type: "service", owner: "test", scopes }, "test");
    return store.createKey(client.id, { label: "primary" }, "test").secret;
  }

  it("requires authentication for metadata routes", async () => {
    const res = await request(appWithStore(openStore())).get("/api/v1/brands");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: "unauthorized", message: "Missing bearer token" } });
  });

  it("returns authenticated client details from /me", async () => {
    const store = openStore();
    const secret = createSecret(store, ["brands.read"]);

    const res = await request(appWithStore(store)).get("/api/v1/me").set("Authorization", `Bearer ${secret}`);

    expect(res.status).toBe(200);
    expect(res.body.client).toEqual(expect.objectContaining({ name: "Test Client", scopes: ["brands.read"] }));
    expect(res.body.key).toEqual(expect.objectContaining({ preview: expect.stringMatching(/^gw_live_\\.\\.\\./) }));
    expect(JSON.stringify(res.body)).not.toContain(secret);
  });

  it("allows scoped reads", async () => {
    const store = openStore();
    const secret = createSecret(store, ["brands.read"]);

    const res = await request(appWithStore(store)).get("/api/v1/brands").set("Authorization", `Bearer ${secret}`);

    expect(res.status).toBe(200);
    expect(res.body.brands.length).toBeGreaterThan(0);
  });

  it("denies reads without the required scope", async () => {
    const store = openStore();
    const secret = createSecret(store, ["brands.read"]);

    const res = await request(appWithStore(store)).get("/api/v1/connections").set("Authorization", `Bearer ${secret}`);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: { code: "forbidden", message: "Missing required scope: connections.read" }
    });
  });

  it("returns 404 for unknown resource ids", async () => {
    const store = openStore();
    const secret = createSecret(store, ["brands.read"]);

    const res = await request(appWithStore(store)).get("/api/v1/brands/missing").set("Authorization", `Bearer ${secret}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: "not_found", message: "Brand not found: missing" } });
  });

  it("persists usage and audit records for API reads", async () => {
    const store = openStore();
    const secret = createSecret(store, ["brands.read"]);

    await request(appWithStore(store)).get("/api/v1/brands").set("Authorization", `Bearer ${secret}`).expect(200);

    const client = store.listApiClients()[0];
    expect(client.requestCount24h).toBe(1);
    expect(store.listAuditEvents().some((event) => event.action === "api_read.succeeded")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the failing route tests**

```bash
npm test -- test/api-routes.test.ts
```

Expected: fail because API modules do not exist.

- [ ] **Step 3: Add structured API errors**

Create `src/api/errors.ts`:

```ts
import type { Response } from "express";

export type GatewayApiErrorCode = "unauthorized" | "forbidden" | "not_found" | "invalid_request" | "internal_error";

export class GatewayApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: GatewayApiErrorCode,
    message: string
  ) {
    super(message);
  }
}

export function sendGatewayApiError(res: Response, error: unknown): void {
  if (error instanceof GatewayApiError) {
    res.status(error.statusCode).json({ error: { code: error.code, message: error.message } });
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  res.status(500).json({ error: { code: "internal_error", message } });
}
```

- [ ] **Step 4: Add scoped auth middleware**

Create `src/api/auth.ts` exporting:

```ts
import type { NextFunction, Request, Response } from "express";
import type { GatewayAccessStore } from "../access/store.js";
import type { AuthenticatedGatewayApiClient, GatewayApiScope } from "../access/types.js";
import { scopeAllowed } from "../access/types.js";
import { GatewayApiError, sendGatewayApiError } from "./errors.js";

declare module "express-serve-static-core" {
  interface Request {
    gatewayApiAuth?: AuthenticatedGatewayApiClient;
    gatewayApiRequiredScope?: GatewayApiScope;
  }
}

export function gatewayApiAuth(accessStore: GatewayAccessStore, requiredScope?: GatewayApiScope) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const header = req.get("Authorization") ?? "";
      const match = header.match(/^Bearer\\s+(.+)$/i);
      if (!match) {
        accessStore.writeAccessAudit({
          action: "api_auth.failed",
          targetType: "api_client",
          targetId: "unknown",
          detail: "Missing bearer token",
          actor: "anonymous",
          metadata: { route: req.originalUrl, method: req.method, reason: "missing_bearer" }
        });
        throw new GatewayApiError(401, "unauthorized", "Missing bearer token");
      }
      const authenticated = accessStore.authenticate(match[1]);
      if (!authenticated) {
        accessStore.writeAccessAudit({
          action: "api_auth.failed",
          targetType: "api_client",
          targetId: "unknown",
          detail: "Invalid or revoked API key",
          actor: "anonymous",
          metadata: { route: req.originalUrl, method: req.method, reason: "invalid_or_revoked" }
        });
        throw new GatewayApiError(401, "unauthorized", "Invalid or revoked API key");
      }
      if (requiredScope && !scopeAllowed(authenticated.client.scopes, requiredScope)) {
        accessStore.writeAccessAudit({
          action: "api_scope.denied",
          targetType: "api_client",
          targetId: authenticated.client.id,
          detail: `Missing required scope: ${requiredScope}`,
          actor: authenticated.client.id,
          metadata: { route: req.originalUrl, method: req.method, requiredScope }
        });
        throw new GatewayApiError(403, "forbidden", `Missing required scope: ${requiredScope}`);
      }
      accessStore.writeAccessAudit({
        action: "api_auth.succeeded",
        targetType: "api_client",
        targetId: authenticated.client.id,
        detail: `Authenticated ${req.method} ${req.originalUrl}`,
        actor: authenticated.client.id,
        metadata: {
          route: req.originalUrl,
          method: req.method,
          fingerprint: authenticated.key.fingerprint,
          requiredScope: requiredScope ?? ""
        }
      });
      req.gatewayApiAuth = authenticated;
      req.gatewayApiRequiredScope = requiredScope;
      next();
    } catch (error) {
      sendGatewayApiError(res, error);
    }
  };
}
```

- [ ] **Step 5: Add `/api/v1` routes**

Create `src/api/routes.ts` with:

- `GET /health` returning `{ status: "ok", version: "v1" }` without brand metadata.
- `GET /me` requiring a valid key and returning client/key metadata with no raw secret.
- `GET /brands`, `GET /brands/:brandId` requiring `brands.read`.
- `GET /brands/:brandId/regions`, `GET /regions/:regionId`, `GET /regions/:regionId/connections` requiring `regions.read` or `connections.read` based on the resource returned.
- `GET /connectors`, `GET /connectors/:connectorId` requiring `connectors.read`.
- `GET /connections`, `GET /connections/:connectionId` requiring `connections.read`.
- A wrapper that records `gateway_api_usage` and `api_read.succeeded` or `api_read.failed` for every authenticated `/api/v1` metadata request.
- `GET /health` is the only unauthenticated `/api/v1` route and must not expose brand, region, connector, connection, or API client metadata.

The route factory signature must be:

```ts
import type { GatewayAccessStore } from "../access/store.js";
import type { GatewayConnectionBackend } from "../admin/types.js";

export interface CreateGatewayApiRouterOptions {
  backend: GatewayConnectionBackend;
  accessStore: GatewayAccessStore;
}

export function createGatewayApiRouter(options: CreateGatewayApiRouterOptions): express.Router;
```

- [ ] **Step 6: Mount `/api/v1` in the app**

Modify `src/index.ts`:

- Build `const adminBackend = options.adminBackend ?? buildAdminBackend(config);`.
- Add `accessStore?: GatewayAccessStore` to `CreateAppOptions` for tests.
- Build `const accessStore = options.accessStore ?? new GatewayAccessStore(config.gatewayStorePath);`.
- Use `app.use("/admin", createAdminRouter(adminBackend, accessStore));`.
- Use `app.use("/api/v1", createGatewayApiRouter({ backend: adminBackend, accessStore }));`.

- [ ] **Step 7: Verify and commit**

```bash
npm test -- test/access-store.test.ts test/api-resources.test.ts test/api-routes.test.ts
npm run typecheck
git add src/api/errors.ts src/api/auth.ts src/api/routes.ts src/index.ts test/api-routes.test.ts
git commit -m "feat: add scoped gateway api routes"
```

Expected: tests and typecheck pass.

## Task 5: Admin API Client Management Routes

**Files:**
- Modify: `src/admin/routes.ts`
- Modify: `test/admin-routes.test.ts`

- [ ] **Step 1: Add failing admin route tests**

Extend `test/admin-routes.test.ts` imports:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GatewayAccessStore } from "../src/access/store.js";
```

Add these helpers near the existing `buildAdminApp` helper:

```ts
function tempStorePath(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "gateway-admin-access-")), "gateway.sqlite");
}
```

Inside `describe("admin routes", () => {`, add:

```ts
const stores: GatewayAccessStore[] = [];

afterEach(() => {
  while (stores.length > 0) {
    stores.pop()?.close();
  }
});
```

Then add tests that build `createAdminRouter(new FixtureGatewayBackend(), accessStore)` and assert:

```ts
it("creates persistent API clients from the admin API", async () => {
  const store = new GatewayAccessStore(tempStorePath());
  stores.push(store);
  const app = express();
  app.use("/admin", createAdminRouter(new FixtureGatewayBackend(), store));

  const res = await request(app)
    .post("/admin/api/api-clients")
    .send({ name: "Local API", type: "service", owner: "ops@haverford.au", scopes: ["brands.read"] });

  expect(res.status).toBe(201);
  expect(res.body.client).toEqual(expect.objectContaining({ name: "Local API", scopes: ["brands.read"] }));
  expect(res.body.state.apiClients).toHaveLength(1);
});

it("creates API keys with a one-time secret from the admin API", async () => {
  const store = new GatewayAccessStore(tempStorePath());
  stores.push(store);
  const client = store.createClient(
    { name: "Local API", type: "service", owner: "ops@haverford.au", scopes: ["brands.read"] },
    "test"
  );
  const app = express();
  app.use("/admin", createAdminRouter(new FixtureGatewayBackend(), store));

  const res = await request(app).post(`/admin/api/api-clients/${client.id}/keys`).send({ label: "primary" });

  expect(res.status).toBe(201);
  expect(res.body.secret).toMatch(/^gw_live_/);
  expect(res.body.key).toEqual(expect.objectContaining({ label: "primary", status: "active" }));
  expect(JSON.stringify(res.body.state)).not.toContain(res.body.secret);
});

it("rotates and revokes API keys through the persistent access store", async () => {
  const store = new GatewayAccessStore(tempStorePath());
  stores.push(store);
  const client = store.createClient(
    { name: "Local API", type: "service", owner: "ops@haverford.au", scopes: ["brands.read"] },
    "test"
  );
  const created = store.createKey(client.id, { label: "primary" }, "test");
  const app = express();
  app.use("/admin", createAdminRouter(new FixtureGatewayBackend(), store));

  const rotated = await request(app).post(`/admin/api/api-clients/${client.id}/keys/${created.key.id}/rotate`).send({});
  expect(rotated.status).toBe(200);
  expect(rotated.body.secret).toMatch(/^gw_live_/);
  expect(store.authenticate(created.secret)).toBeUndefined();

  const revoked = await request(app).post(`/admin/api/api-clients/${client.id}/keys/${created.key.id}/revoke`).send({});
  expect(revoked.status).toBe(200);
  expect(revoked.body.key.status).toBe("revoked");
});
```

- [ ] **Step 2: Run the failing admin tests**

```bash
npm test -- test/admin-routes.test.ts
```

Expected: new tests fail because `createAdminRouter` does not accept an access store and create routes do not exist.

- [ ] **Step 3: Implement admin access routes**

Modify `src/admin/routes.ts`:

- Change `createAdminRouter(backend = new FixtureGatewayBackend())` to `createAdminRouter(backend = new FixtureGatewayBackend(), accessStore?: GatewayAccessStore)`.
- Add `actorFromRequest(req)` that checks `x-auth-gate-email`, `x-forwarded-email`, and `x-user-email`, then falls back to `local-admin`.
- Add `snapshotForResponse()` that returns `backend.snapshot()` with `apiClients` replaced by `accessStore.listApiClients()` and `auditEvents` merged with `accessStore.listAuditEvents()` when `accessStore` exists.
- Add:
  - `POST /api/api-clients`
  - `PATCH /api/api-clients/:clientId`
  - `POST /api/api-clients/:clientId/keys`
  - persistent-store behavior for the existing rotate/revoke routes when `accessStore` exists.
- Return `503` with `{ error: "Gateway access store is not configured" }` if create/update/key routes are called without an access store.
- For key create and rotate, return `{ key, secret, state }`; the raw secret must not appear inside `state`.

- [ ] **Step 4: Verify and commit**

```bash
npm test -- test/admin-routes.test.ts test/access-store.test.ts
npm run typecheck
git add src/admin/routes.ts test/admin-routes.test.ts
git commit -m "feat: manage gateway api clients from admin"
```

Expected: targeted tests and typecheck pass.

## Task 6: Admin Dashboard UX For API Access

**Files:**
- Modify: `src/admin/client-script.ts`
- Modify: `src/admin/styles.ts`
- Modify: relevant admin UI tests if present

- [ ] **Step 1: Define UI behavior**

The API Access panel must show:

- API clients with name, owner, type, status, scopes, key count, 24h request count, 24h error rate, and last used time.
- Key rows with label, preview, fingerprint, status, created, rotated, revoked, and last used timestamps.
- A create-client form with name, owner, type, and scope checkboxes.
- A create-key action per client that asks for a label.
- A one-time secret reveal panel after create or rotate with a copy button and clear/dismiss button.
- Rotate and revoke buttons for active keys.
- A compact audit list filtered to access-related events when data is available.

- [ ] **Step 2: Implement client-side calls**

Modify `src/admin/client-script.ts` to add functions using the existing fetch/render pattern:

```js
async function createApiClientFromForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const scopes = Array.from(form.querySelectorAll('input[name="api-client-scope"]:checked')).map((input) => input.value);
  await apiRequest("/api/api-clients", {
    method: "POST",
    body: JSON.stringify({
      name: form.elements.name.value,
      owner: form.elements.owner.value,
      type: form.elements.type.value,
      scopes
    })
  });
}

async function createApiKey(clientId) {
  const label = window.prompt("Key label");
  if (!label) return;
  const result = await apiRequest(`/api/api-clients/${clientId}/keys`, {
    method: "POST",
    body: JSON.stringify({ label })
  });
  showOneTimeSecret(result.secret);
}

async function rotateApiKey(clientId, keyId) {
  const result = await apiRequest(`/api/api-clients/${clientId}/keys/${keyId}/rotate`, { method: "POST" });
  showOneTimeSecret(result.secret);
}

async function revokeApiKey(clientId, keyId) {
  await apiRequest(`/api/api-clients/${clientId}/keys/${keyId}/revoke`, { method: "POST" });
}
```

Wire these functions into the existing render loop so successful responses update the in-memory state with `result.state`.

- [ ] **Step 3: Render compact admin controls**

In `src/admin/client-script.ts`, render the access section as an operational dashboard, not a marketing page:

- Keep the current admin shell.
- Use dense rows and inline actions.
- Use existing button classes and add only the smallest new classes needed.
- Show empty state text: `No API clients yet. Create one to test /api/v1 locally.`
- Do not show raw secrets except in the one-time reveal panel.

- [ ] **Step 4: Style the new controls**

Modify `src/admin/styles.ts` with classes for:

- `.access-grid`
- `.access-client`
- `.access-key-list`
- `.secret-reveal`
- `.scope-checklist`
- `.audit-compact`

Use restrained spacing, 8px or smaller border radius, stable row heights, and no marketing-style hero/card treatment.

- [ ] **Step 5: Verify and commit**

```bash
npm test -- test/admin-routes.test.ts
npm run typecheck
npm run build
git add src/admin/client-script.ts src/admin/styles.ts
git commit -m "feat: add api access admin controls"
```

Expected: tests, typecheck, and build pass.

## Task 7: App Wiring And Local Smoke

**Files:**
- Modify: `src/index.ts`
- Modify: `README.md`

- [ ] **Step 1: Verify `createApp` wires the access store once**

Check `src/index.ts` after Task 4. It should:

- Build one `adminBackend`.
- Build one `GatewayAccessStore`.
- Pass the same backend and access store to `/admin` and `/api/v1`.
- Keep `/mcp` behavior unchanged.
- Keep `/health` behavior unchanged.

- [ ] **Step 2: Add local smoke documentation**

Add a docs section with these commands:

```bash
export ADMIN_DATA_SOURCE=fixture-overlay
export GATEWAY_STORE_PATH="$(pwd)/.tmp/gateway-phase-2.sqlite"
npm run dev
```

Then in another terminal:

```bash
curl -s http://localhost:3000/admin/api/api-clients \
  -H 'Content-Type: application/json' \
  -d '{"name":"Local Smoke","type":"service","owner":"local","scopes":["brands.read","regions.read","connectors.read","connections.read"]}'
```

Create a key through the admin UI or:

```bash
curl -s http://localhost:3000/admin/api/api-clients/<client-id>/keys \
  -H 'Content-Type: application/json' \
  -d '{"label":"local smoke"}'
```

Call the gateway API:

```bash
curl -s http://localhost:3000/api/v1/brands \
  -H "Authorization: Bearer <gw_live_secret>"
```

Restart `npm run dev` with the same `GATEWAY_STORE_PATH` and call `/api/v1/brands` again with the same secret. Expected: the key still authenticates and usage counters increase.

- [ ] **Step 3: Run full verification**

```bash
npm test
npm run typecheck
npm run build
```

Expected: all pass.

- [ ] **Step 4: Run local smoke**

Run the fixture-overlay smoke from Step 2. Confirm:

- API client persists.
- API key persists.
- `/api/v1/brands` works after restart.
- Usage count increases.
- Audit events contain `api_key.created`, `api_auth.succeeded`, and `api_read.succeeded`.
- No raw `gw_live_` secret appears in `/admin/api/state` or `/api/v1/me`.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts README.md
git commit -m "docs: document gateway api smoke test"
```

Expected: docs and final wiring committed.

## Final Verification

- [ ] Run the complete suite:

```bash
npm test
npm run typecheck
npm run build
```

- [ ] Run fixture-overlay restart smoke with the same `GATEWAY_STORE_PATH`.
- [ ] If a local Haverford Dev API is listening, run optional `ADMIN_DATA_SOURCE=dev-api-overlay` smoke and confirm `/api/v1/brands` plus `/api/v1/connections` expose imported Dev API setup through the gateway resource contract.
- [ ] Run `git status --short --branch` and confirm only intentional Phase 2 files are tracked.
- [ ] Record any optional Dev API smoke omission explicitly in the final answer.

## Acceptance Checklist

- `/api/v1` exposes versioned brand, region, connector, connection, and authenticated self metadata.
- Current and manual-ref connections are visible as `current` or `manual_ref`, never `oauth_managed`.
- API clients and keys persist in `/data/gateway.sqlite`.
- Key create and rotate reveal raw secrets once only.
- Old key secrets stop working immediately after rotation.
- Revoked keys and revoked clients cannot authenticate.
- Scope denials return `403` and are audited.
- Usage and audit history record API access without storing Authorization headers or raw secrets.
- Admin dashboard can create clients, create keys, rotate keys, revoke keys, and show usage/audit state.
- `/mcp` behavior is unchanged.
- No Nango, Composio OAuth, native provider execution, or `/api/compat` route is added in this phase.
