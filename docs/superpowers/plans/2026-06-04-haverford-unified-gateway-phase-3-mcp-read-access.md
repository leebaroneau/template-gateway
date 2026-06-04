# Haverford Unified Gateway Phase 3 MCP Read Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a gateway-owned `/mcp/v1` read-only MCP endpoint for Haverford Gateway metadata while preserving the existing `/mcp` Composio proxy unchanged.

**Architecture:** Implement `/mcp/v1` as a small Express JSON-RPC adapter over the Phase 2 gateway primitives: `GatewayConnectionBackend.snapshot()`, `toGatewayApiResources()`, `GatewayAccessStore.authenticate()`, usage, and audit. Keep provider execution, Composio OAuth, Nango, native connector runtime behavior, and Claude hosted connector OAuth out of this phase.

**Tech Stack:** Node 20, TypeScript ESM, Express 4, better-sqlite3, Vitest, Supertest, existing gateway API/admin modules.

---

## Current State

- Working repo: `/Users/leebaroneau/Documents/GitHub/lee-dashboard/00_repos/template-gateway`
- Current implementation branch: `story/19-phase-3-mcp-read-access`
- Pipeline Core: no `.github/pipeline-config.yml` in this clone, so no Pipeline Core issue/branch/PR gate is active locally.
- Existing issue context: GitHub issue `#19` tracks the Haverford Unified Gateway epic.
- Existing `/mcp` path: Composio Tool Router proxy using `GATEWAY_BEARER`; must remain unchanged.
- Existing `/api/v1` path: Phase 2 metadata API with gateway API clients, keys, scopes, usage, and audit.
- Unrelated working tree file to ignore: `scripts/fix-pipedrive-connection.mjs`.

## File Structure

Create these focused files:

- `src/mcp-v1/types.ts` - MCP JSON-RPC/tool result types and actor/tool context types.
- `src/mcp-v1/tools.ts` - tool definitions, argument validation, safe filtering, and tool handlers.
- `src/mcp-v1/auth.ts` - bearer API-key auth plus optional Auth Gate identity allowlist auth.
- `src/mcp-v1/routes.ts` - Express router for `/mcp/v1` JSON-RPC methods and audit/usage recording.
- `test/mcp-v1-tools.test.ts` - direct unit tests for tool definitions and tool handlers.
- `test/mcp-v1-auth.test.ts` - direct unit tests for bearer/Auth Gate auth decisions.
- `test/mcp-v1-routes.test.ts` - route tests for MCP JSON-RPC, auth, scopes, usage, audit, and `/mcp` separation.

Modify these existing files:

- `src/config.ts` - parse `MCP_AUTH_GATE_ALLOWED_DOMAINS` and `MCP_AUTH_GATE_ALLOWED_USERS`.
- `src/access/types.ts` - add `mcp.read`.
- `src/admin/types.ts` - add MCP audit actions.
- `src/index.ts` - mount `/mcp/v1` before `/mcp`.
- `test/config.test.ts` - cover new allowlist config parsing.
- `test/access-secret.test.ts` - cover `mcp.read` scope validation.
- `README.md` - document `/mcp/v1` local usage and smoke steps.

Do not add an MCP SDK dependency in this phase. The repo already has Express JSON handling and the Phase 3 contract only needs `initialize`, `notifications/initialized`, `ping`, `tools/list`, and `tools/call`. A tiny internal router avoids adding a larger transport/session abstraction before Phase 4 OAuth and streaming decisions.

---

## Task 0: Phase Gate And Baseline Verification

**Files:**
- Read: `docs/superpowers/specs/2026-06-04-haverford-unified-gateway-phase-3-mcp-read-access-design.md`
- Read: `docs/superpowers/plans/2026-06-04-haverford-unified-gateway-phase-2-access-api-front-door.md`
- Verify: repo status and current tests

- [ ] **Step 1: Confirm branch and dirty state**

Run:

```bash
git status --short --branch
```

Expected:

```text
## story/19-phase-3-mcp-read-access
?? scripts/fix-pipedrive-connection.mjs
```

If additional tracked files are dirty, stop and inspect them before editing. Do not remove or edit `scripts/fix-pipedrive-connection.mjs`.

- [ ] **Step 2: Confirm no Pipeline Core config exists**

Run:

```bash
test ! -f .github/pipeline-config.yml && echo "pipeline=no"
```

Expected:

```text
pipeline=no
```

- [ ] **Step 3: Verify Phase 2 remains green before Phase 3 edits**

Run:

```bash
npm test
npm run typecheck
npm run build
```

Expected: all commands pass. If any fail, use `superpowers:systematic-debugging` and fix the regression before starting Phase 3.

- [ ] **Step 4: Commit the plan if not already committed**

Run:

```bash
git add docs/superpowers/plans/2026-06-04-haverford-unified-gateway-phase-3-mcp-read-access.md
git commit -m "docs: plan phase 3 mcp read access"
```

Expected: one docs commit on `story/19-phase-3-mcp-read-access`.

---

## Task 1: Config, Scope, And Audit Type Surface

**Files:**
- Modify: `src/config.ts`
- Modify: `src/access/types.ts`
- Modify: `src/admin/types.ts`
- Modify: `test/config.test.ts`
- Modify: `test/access-secret.test.ts`

- [ ] **Step 1: Write failing config tests**

In `test/config.test.ts`, add these env deletes inside `beforeEach()`:

```ts
delete process.env.MCP_AUTH_GATE_ALLOWED_DOMAINS;
delete process.env.MCP_AUTH_GATE_ALLOWED_USERS;
```

Then append these tests inside `describe("loadConfig", () => { ... })`:

```ts
it("leaves MCP Auth Gate allowlists disabled by default", () => {
  const cfg = loadConfig({
    COMPOSIO_API_KEY: "ak_test",
    BRAND_SLUG: "haverford",
    GATEWAY_BEARER: "a_secret_thats_long_enough"
  });

  expect(cfg.mcpAuthGateAllowedDomains).toBeUndefined();
  expect(cfg.mcpAuthGateAllowedUsers).toBeUndefined();
});

it("parses MCP Auth Gate allowlists as lowercased arrays", () => {
  const cfg = loadConfig({
    COMPOSIO_API_KEY: "ak_test",
    BRAND_SLUG: "haverford",
    GATEWAY_BEARER: "a_secret_thats_long_enough",
    MCP_AUTH_GATE_ALLOWED_DOMAINS: " Haverford.au, haverford.COM.AU ,, ",
    MCP_AUTH_GATE_ALLOWED_USERS: " Lee@Haverford.au, Ops@Haverford.com.au "
  });

  expect(cfg.mcpAuthGateAllowedDomains).toEqual(["haverford.au", "haverford.com.au"]);
  expect(cfg.mcpAuthGateAllowedUsers).toEqual(["lee@haverford.au", "ops@haverford.com.au"]);
});
```

- [ ] **Step 2: Write failing scope tests**

In `test/access-secret.test.ts`, update the scope helper test:

```ts
it("validates and de-duplicates known scopes in first-seen order", () => {
  expect(isGatewayApiScope("brands.read")).toBe(true);
  expect(isGatewayApiScope("mcp.read")).toBe(true);
  expect(isGatewayApiScope("unknown.read")).toBe(false);
  expect(validateGatewayApiScopes(["brands.read", "mcp.read", "audit.read", "brands.read"])).toEqual([
    "brands.read",
    "mcp.read",
    "audit.read"
  ]);
});
```

Add this scope behavior test:

```ts
it("treats mcp.read as its own explicit scope", () => {
  expect(scopeAllowed(["mcp.read"], "mcp.read")).toBe(true);
  expect(scopeAllowed(["connections.read"], "mcp.read")).toBe(false);
  expect(scopeAllowed(["mcp.read"], "connections.read")).toBe(false);
});
```

- [ ] **Step 3: Run failing tests**

Run:

```bash
npx vitest run test/config.test.ts test/access-secret.test.ts
```

Expected: fails because the config properties and `mcp.read` scope are not implemented yet.

- [ ] **Step 4: Implement config parsing**

In `src/config.ts`, add properties to `GatewayConfig`:

```ts
mcpAuthGateAllowedDomains?: string[];
mcpAuthGateAllowedUsers?: string[];
```

Add this parser near `parseToolkitAllowlist()`:

```ts
function parseCommaList(raw?: string): string[] | undefined {
  if (!raw) return undefined;
  const values = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return values.length === 0 ? undefined : Array.from(new Set(values));
}
```

Replace `toolkitAllowlist: parseToolkitAllowlist(env.TOOLKIT_ALLOWLIST),` with:

```ts
toolkitAllowlist: parseToolkitAllowlist(env.TOOLKIT_ALLOWLIST),
mcpAuthGateAllowedDomains: parseCommaList(env.MCP_AUTH_GATE_ALLOWED_DOMAINS),
mcpAuthGateAllowedUsers: parseCommaList(env.MCP_AUTH_GATE_ALLOWED_USERS),
```

Keep `parseToolkitAllowlist()` unchanged so existing behavior remains stable.

- [ ] **Step 5: Implement scope and audit action types**

In `src/access/types.ts`, add the new scope after the existing read scopes:

```ts
export const gatewayApiScopes = [
  "brands.read",
  "regions.read",
  "connectors.read",
  "connections.read",
  "mcp.read",
  "api_clients.read",
  "api_clients.write",
  "audit.read"
] as const;
```

In `src/admin/types.ts`, extend `AuditAction`:

```ts
  | "api_read.succeeded"
  | "api_read.failed"
  | "mcp_auth.succeeded"
  | "mcp_auth.failed"
  | "mcp_tool.listed"
  | "mcp_tool.called"
  | "mcp_tool.failed";
```

Do not change `AuditEvent["targetType"]` for this phase. MCP auth/tool events can target `api_client` with `targetId` set to the authenticated client id, the Auth Gate email, or `unknown`.

- [ ] **Step 6: Verify Task 1**

Run:

```bash
npx vitest run test/config.test.ts test/access-secret.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

- [ ] **Step 7: Commit Task 1**

Run:

```bash
git add src/config.ts src/access/types.ts src/admin/types.ts test/config.test.ts test/access-secret.test.ts
git commit -m "feat(mcp): add read scope and auth gate config"
```

---

## Task 2: MCP Tool Contract And Safe Handlers

**Files:**
- Create: `src/mcp-v1/types.ts`
- Create: `src/mcp-v1/tools.ts`
- Create: `test/mcp-v1-tools.test.ts`

- [ ] **Step 1: Write failing tool tests**

Create `test/mcp-v1-tools.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { GatewayState } from "../src/admin/types.js";
import { FixtureGatewayBackend } from "../src/admin/fixture-backend.js";
import {
  callGatewayMcpTool,
  gatewayMcpTools,
  requiredScopeForGatewayMcpTool
} from "../src/mcp-v1/tools.js";

async function fixtureState(): Promise<GatewayState> {
  return new FixtureGatewayBackend().snapshot();
}

describe("gateway MCP v1 tools", () => {
  it("publishes the six read-only gateway tool definitions", () => {
    expect(gatewayMcpTools.map((tool) => tool.name)).toEqual([
      "gateway_list_brands",
      "gateway_list_regions",
      "gateway_list_connectors",
      "gateway_list_connections",
      "gateway_get_connection",
      "gateway_find_connections"
    ]);
    expect(gatewayMcpTools.every((tool) => tool.inputSchema.type === "object")).toBe(true);
  });

  it("maps each tool to its granular read scope", () => {
    expect(requiredScopeForGatewayMcpTool("gateway_list_brands")).toBe("brands.read");
    expect(requiredScopeForGatewayMcpTool("gateway_list_regions")).toBe("regions.read");
    expect(requiredScopeForGatewayMcpTool("gateway_list_connectors")).toBe("connectors.read");
    expect(requiredScopeForGatewayMcpTool("gateway_list_connections")).toBe("connections.read");
    expect(requiredScopeForGatewayMcpTool("gateway_get_connection")).toBe("connections.read");
    expect(requiredScopeForGatewayMcpTool("gateway_find_connections")).toBe("connections.read");
  });

  it("lists brands with structured content and text content", async () => {
    const result = await callGatewayMcpTool("gateway_list_brands", {}, await fixtureState());

    expect(result.isError).toBe(false);
    expect(result.structuredContent).toEqual({
      brands: [expect.objectContaining({ id: "brand_haverford", slug: "haverford" })]
    });
    expect(result.content).toEqual([{ type: "text", text: "Found 1 brand." }]);
  });

  it("filters regions by brand id and status", async () => {
    const result = await callGatewayMcpTool(
      "gateway_list_regions",
      { brandId: "brand_haverford", status: "active" },
      await fixtureState()
    );

    expect(result.isError).toBe(false);
    expect(result.structuredContent).toEqual({
      regions: expect.arrayContaining([expect.objectContaining({ brandId: "brand_haverford", status: "active" })])
    });
  });

  it("filters connectors by category and backend type", async () => {
    const result = await callGatewayMcpTool(
      "gateway_list_connectors",
      { category: "commerce", backendType: "nango" },
      await fixtureState()
    );

    expect(result.isError).toBe(false);
    expect(result.structuredContent).toEqual({
      connectors: expect.arrayContaining([
        expect.objectContaining({ slug: "shopify", category: "commerce", backendOptions: expect.arrayContaining(["nango"]) })
      ])
    });
  });

  it("filters connections by hierarchy fields and setup mode", async () => {
    const result = await callGatewayMcpTool(
      "gateway_list_connections",
      {
        brandId: "brand_haverford",
        regionId: "region_haverford_au",
        connectorId: "connector_shopify",
        setupMode: "current"
      },
      await fixtureState()
    );

    expect(result.isError).toBe(false);
    expect(result.structuredContent).toEqual({
      connections: [
        expect.objectContaining({
          brandId: "brand_haverford",
          regionId: "region_haverford_au",
          connectorId: "connector_shopify",
          setupMode: "current",
          runtimeStatus: "metadata_only"
        })
      ]
    });
  });

  it("gets one connection and returns tool-level errors for missing ids", async () => {
    const state = await fixtureState();
    const found = await callGatewayMcpTool(
      "gateway_get_connection",
      { connectionId: "connection_haverford_au_shopify" },
      state
    );
    const missing = await callGatewayMcpTool("gateway_get_connection", { connectionId: "missing" }, state);

    expect(found.isError).toBe(false);
    expect(found.structuredContent).toEqual({
      connection: expect.objectContaining({ id: "connection_haverford_au_shopify" })
    });
    expect(missing.isError).toBe(true);
    expect(missing.content[0].text).toBe("Connection not found: missing");
  });

  it("finds connections across connection, connector, brand, region, and safe config fields", async () => {
    const state = await fixtureState();

    await expect(callGatewayMcpTool("gateway_find_connections", { query: "shopify au" }, state)).resolves.toMatchObject({
      isError: false,
      structuredContent: { connections: [expect.objectContaining({ connectorId: "connector_shopify" })] }
    });
    await expect(callGatewayMcpTool("gateway_find_connections", { query: "haverford" }, state)).resolves.toMatchObject({
      isError: false,
      structuredContent: { connections: expect.arrayContaining([expect.objectContaining({ brandId: "brand_haverford" })]) }
    });
  });

  it("does not expose raw secret-like config values in tool output", async () => {
    const state = await fixtureState();
    state.connections[0].configSummary = {
      access_token: "ya29.secret",
      shop_domain: "haverford-au.myshopify.com",
      credential_ref: "haverford-shopify-prod"
    };

    const result = await callGatewayMcpTool("gateway_get_connection", { connectionId: state.connections[0].id }, state);
    const json = JSON.stringify(result);

    expect(json).toContain("haverford-au.myshopify.com");
    expect(json).toContain("haverford-shopify-prod");
    expect(json).not.toContain("ya29.secret");
  });

  it("returns tool-level errors for invalid filters and unknown tools", async () => {
    const state = await fixtureState();

    await expect(callGatewayMcpTool("gateway_list_brands", { status: "deleted" }, state)).resolves.toMatchObject({
      isError: true,
      content: [{ type: "text", text: "Invalid status: deleted" }]
    });
    await expect(callGatewayMcpTool("missing_tool", {}, state)).resolves.toMatchObject({
      isError: true,
      content: [{ type: "text", text: "Unknown tool: missing_tool" }]
    });
  });
});
```

- [ ] **Step 2: Run the failing tool tests**

Run:

```bash
npx vitest run test/mcp-v1-tools.test.ts
```

Expected: fails because `src/mcp-v1/tools.ts` does not exist.

- [ ] **Step 3: Create MCP type definitions**

Create `src/mcp-v1/types.ts`:

```ts
import type { GatewayApiScope } from "../access/types.js";
import type { AuthenticatedGatewayApiClient } from "../access/types.js";

export interface McpJsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

export interface McpTextContent {
  type: "text";
  text: string;
}

export interface GatewayMcpToolResult {
  content: McpTextContent[];
  structuredContent: Record<string, unknown>;
  isError: boolean;
}

export type GatewayMcpActor =
  | {
      type: "api_client";
      authMethod: "api_key";
      actorId: string;
      scopes: GatewayApiScope[];
      authenticated: AuthenticatedGatewayApiClient;
    }
  | {
      type: "auth_gate";
      authMethod: "auth_gate";
      actorId: string;
      email: string;
      domain: string;
      scopes: GatewayApiScope[];
    };
```

- [ ] **Step 4: Create MCP tool handlers**

Create `src/mcp-v1/tools.ts`:

```ts
import type { GatewayApiScope } from "../access/types.js";
import type {
  AuthMode,
  ConnectionStatus,
  ConnectorCategory,
  EntityStatus,
  GatewayBackendType,
  GatewayState
} from "../admin/types.js";
import { toGatewayApiResources } from "../api/resources.js";
import type { GatewayConnectionApiResource } from "../api/resources.js";
import type { GatewayMcpToolResult, McpToolDefinition } from "./types.js";

type ToolArgs = Record<string, unknown>;

const entityStatuses: EntityStatus[] = ["active", "disabled"];
const connectionStatuses: ConnectionStatus[] = ["needs_config", "pending", "connected", "needs_reconnect", "error"];
const setupModes = ["current", "manual_ref", "oauth_managed"] as const;
const backendTypes: GatewayBackendType[] = ["nango", "composio", "native", "internal"];
const connectorCategories: ConnectorCategory[] = ["commerce", "analytics", "marketing", "crm", "productivity", "internal"];
const authModes: AuthMode[] = ["oauth", "api_key", "service_account", "none"];

export const gatewayMcpTools: McpToolDefinition[] = [
  {
    name: "gateway_list_brands",
    description: "List Haverford Gateway brands.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: entityStatuses }
      },
      additionalProperties: false
    }
  },
  {
    name: "gateway_list_regions",
    description: "List Haverford Gateway regions, optionally filtered by brand.",
    inputSchema: {
      type: "object",
      properties: {
        brandId: { type: "string" },
        status: { type: "string", enum: entityStatuses }
      },
      additionalProperties: false
    }
  },
  {
    name: "gateway_list_connectors",
    description: "List connector definitions available to Haverford Gateway connections.",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string", enum: connectorCategories },
        backendType: { type: "string", enum: backendTypes },
        authMode: { type: "string", enum: authModes }
      },
      additionalProperties: false
    }
  },
  {
    name: "gateway_list_connections",
    description: "List Haverford Gateway connections under the Brand > Region > Connector hierarchy.",
    inputSchema: {
      type: "object",
      properties: {
        brandId: { type: "string" },
        regionId: { type: "string" },
        connectorId: { type: "string" },
        status: { type: "string", enum: connectionStatuses },
        setupMode: { type: "string", enum: setupModes }
      },
      additionalProperties: false
    }
  },
  {
    name: "gateway_get_connection",
    description: "Get one Haverford Gateway connection by id.",
    inputSchema: {
      type: "object",
      properties: {
        connectionId: { type: "string" }
      },
      required: ["connectionId"],
      additionalProperties: false
    }
  },
  {
    name: "gateway_find_connections",
    description: "Search Haverford Gateway connections by local metadata.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" }
      },
      required: ["query"],
      additionalProperties: false
    }
  }
];

const toolScopes: Record<string, GatewayApiScope> = {
  gateway_list_brands: "brands.read",
  gateway_list_regions: "regions.read",
  gateway_list_connectors: "connectors.read",
  gateway_list_connections: "connections.read",
  gateway_get_connection: "connections.read",
  gateway_find_connections: "connections.read"
};

export function requiredScopeForGatewayMcpTool(name: string): GatewayApiScope | undefined {
  return toolScopes[name];
}

export async function callGatewayMcpTool(
  name: string,
  args: unknown,
  state: GatewayState
): Promise<GatewayMcpToolResult> {
  const parsedArgs = asArgs(args);
  try {
    switch (name) {
      case "gateway_list_brands":
        return listBrands(parsedArgs, state);
      case "gateway_list_regions":
        return listRegions(parsedArgs, state);
      case "gateway_list_connectors":
        return listConnectors(parsedArgs, state);
      case "gateway_list_connections":
        return listConnections(parsedArgs, state);
      case "gateway_get_connection":
        return getConnection(parsedArgs, state);
      case "gateway_find_connections":
        return findConnections(parsedArgs, state);
      default:
        return toolError(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return toolError(error instanceof Error ? error.message : "MCP tool failed");
  }
}

function listBrands(args: ToolArgs, state: GatewayState): GatewayMcpToolResult {
  const status = optionalEnum(args.status, "status", entityStatuses);
  const brands = state.brands.filter((brand) => status === undefined || brand.status === status);
  return toolSuccess({ brands }, countText("brand", brands.length));
}

function listRegions(args: ToolArgs, state: GatewayState): GatewayMcpToolResult {
  const brandId = optionalString(args.brandId, "brandId");
  const status = optionalEnum(args.status, "status", entityStatuses);
  const regions = state.regions.filter(
    (region) =>
      (brandId === undefined || region.brandId === brandId) &&
      (status === undefined || region.status === status)
  );
  return toolSuccess({ regions }, countText("region", regions.length));
}

function listConnectors(args: ToolArgs, state: GatewayState): GatewayMcpToolResult {
  const category = optionalEnum(args.category, "category", connectorCategories);
  const backendType = optionalEnum(args.backendType, "backendType", backendTypes);
  const authMode = optionalEnum(args.authMode, "authMode", authModes);
  const connectors = state.connectors.filter(
    (connector) =>
      (category === undefined || connector.category === category) &&
      (backendType === undefined || connector.backendOptions.includes(backendType)) &&
      (authMode === undefined || connector.authMode === authMode)
  );
  return toolSuccess({ connectors }, countText("connector", connectors.length));
}

function listConnections(args: ToolArgs, state: GatewayState): GatewayMcpToolResult {
  const brandId = optionalString(args.brandId, "brandId");
  const regionId = optionalString(args.regionId, "regionId");
  const connectorId = optionalString(args.connectorId, "connectorId");
  const status = optionalEnum(args.status, "status", connectionStatuses);
  const setupMode = optionalEnum(args.setupMode, "setupMode", [...setupModes]);
  const connections = toGatewayApiResources(state).connections.filter(
    (connection) =>
      (brandId === undefined || connection.brandId === brandId) &&
      (regionId === undefined || connection.regionId === regionId) &&
      (connectorId === undefined || connection.connectorId === connectorId) &&
      (status === undefined || connection.status === status) &&
      (setupMode === undefined || connection.setupMode === setupMode)
  );
  return toolSuccess({ connections }, countText("connection", connections.length));
}

function getConnection(args: ToolArgs, state: GatewayState): GatewayMcpToolResult {
  const connectionId = requiredString(args.connectionId, "connectionId");
  const connection = toGatewayApiResources(state).connections.find((candidate) => candidate.id === connectionId);
  if (connection === undefined) {
    return toolError(`Connection not found: ${connectionId}`);
  }
  return toolSuccess({ connection }, `Found connection ${connection.displayName}.`);
}

function findConnections(args: ToolArgs, state: GatewayState): GatewayMcpToolResult {
  const query = requiredString(args.query, "query").trim().toLowerCase();
  if (query.length === 0) {
    return toolError("query must not be empty");
  }
  const resources = toGatewayApiResources(state);
  const terms = query.split(/\s+/).filter(Boolean);
  const connections = resources.connections.filter((connection) =>
    terms.every((term) => searchableConnectionText(connection, state).includes(term))
  );
  return toolSuccess({ connections }, countText("connection", connections.length));
}

function searchableConnectionText(connection: GatewayConnectionApiResource, state: GatewayState): string {
  const brand = state.brands.find((candidate) => candidate.id === connection.brandId);
  const region = state.regions.find((candidate) => candidate.id === connection.regionId);
  const connector = state.connectors.find((candidate) => candidate.id === connection.connectorId);
  return [
    connection.id,
    connection.displayName,
    brand?.id,
    brand?.name,
    brand?.slug,
    region?.id,
    region?.code,
    region?.name,
    region?.domain,
    connector?.id,
    connector?.slug,
    connector?.name,
    ...Object.values(connection.configSummary)
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
}

function asArgs(args: unknown): ToolArgs {
  if (args === undefined || args === null) return {};
  if (typeof args === "object" && !Array.isArray(args)) return args as ToolArgs;
  throw new Error("arguments must be an object");
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  return value;
}

function requiredString(value: unknown, field: string): string {
  const parsed = optionalString(value, field);
  if (parsed === undefined || parsed.trim() === "") throw new Error(`${field} is required`);
  return parsed;
}

function optionalEnum<T extends string>(value: unknown, field: string, allowed: readonly T[]): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`Invalid ${field}: ${String(value)}`);
  }
  return value as T;
}

function toolSuccess(structuredContent: Record<string, unknown>, text: string): GatewayMcpToolResult {
  return { content: [{ type: "text", text }], structuredContent, isError: false };
}

function toolError(text: string): GatewayMcpToolResult {
  return { content: [{ type: "text", text }], structuredContent: {}, isError: true };
}

function countText(noun: string, count: number): string {
  return `Found ${count} ${noun}${count === 1 ? "" : "s"}.`;
}
```

- [ ] **Step 5: Verify Task 2**

Run:

```bash
npx vitest run test/mcp-v1-tools.test.ts
npm run typecheck
```

Expected: tests and typecheck pass. If the fixture ids differ, inspect `src/admin/fixture-data.ts` and update test ids to the existing fixture ids only.

- [ ] **Step 6: Commit Task 2**

Run:

```bash
git add src/mcp-v1/types.ts src/mcp-v1/tools.ts test/mcp-v1-tools.test.ts
git commit -m "feat(mcp): add gateway metadata tools"
```

---

## Task 3: MCP Auth Decisions

**Files:**
- Create: `src/mcp-v1/auth.ts`
- Create: `test/mcp-v1-auth.test.ts`

- [ ] **Step 1: Write failing auth tests**

Create `test/mcp-v1-auth.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GatewayAccessStore } from "../src/access/store.js";
import type { GatewayApiScope } from "../src/access/types.js";
import { authenticateGatewayMcpRequest, mcpAuthGateEmailFromHeaders } from "../src/mcp-v1/auth.js";

const stores: GatewayAccessStore[] = [];
const tempDirs: string[] = [];

function tempStore(): GatewayAccessStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-mcp-auth-"));
  tempDirs.push(dir);
  const store = new GatewayAccessStore(path.join(dir, "gateway.sqlite"));
  stores.push(store);
  return store;
}

function credential(store: GatewayAccessStore, scopes: GatewayApiScope[]) {
  const client = store.createClient({ name: "MCP Client", type: "agent", owner: "mcp@haverford.au", scopes }, "test");
  const created = store.createKey(client.id, { label: "primary" }, "test");
  return { client, key: created.key, secret: created.secret };
}

afterEach(() => {
  while (stores.length > 0) stores.pop()?.close();
  while (tempDirs.length > 0) fs.rmSync(tempDirs.pop() ?? "", { recursive: true, force: true });
});

describe("MCP v1 auth", () => {
  it("extracts Auth Gate email headers in priority order", () => {
    expect(
      mcpAuthGateEmailFromHeaders({
        "x-user-email": "fallback@haverford.au",
        "x-forwarded-email": "forwarded@haverford.au",
        "x-auth-gate-email": "primary@haverford.au"
      })
    ).toBe("primary@haverford.au");
    expect(mcpAuthGateEmailFromHeaders({ "x-forwarded-email": " Forwarded@Haverford.au " })).toBe(
      "forwarded@haverford.au"
    );
  });

  it("authenticates gateway API keys with mcp.read", () => {
    const store = tempStore();
    const { client, secret } = credential(store, ["mcp.read"]);

    const result = authenticateGatewayMcpRequest({
      authorizationHeader: `Bearer ${secret}`,
      identityHeaders: {},
      accessStore: store,
      authGateAllowedDomains: undefined,
      authGateAllowedUsers: undefined
    });

    expect(result.ok).toBe(true);
    expect(result.actor).toMatchObject({ type: "api_client", actorId: client.id, scopes: ["mcp.read"] });
  });

  it("allows trusted Auth Gate users only when allowlists are configured", () => {
    const store = tempStore();
    const allowed = authenticateGatewayMcpRequest({
      authorizationHeader: undefined,
      identityHeaders: { "x-auth-gate-email": "Lee@Haverford.au" },
      accessStore: store,
      authGateAllowedDomains: ["haverford.au"],
      authGateAllowedUsers: []
    });
    const disabled = authenticateGatewayMcpRequest({
      authorizationHeader: undefined,
      identityHeaders: { "x-auth-gate-email": "lee@haverford.au" },
      accessStore: store,
      authGateAllowedDomains: undefined,
      authGateAllowedUsers: undefined
    });

    expect(allowed.ok).toBe(true);
    expect(allowed.actor).toMatchObject({
      type: "auth_gate",
      actorId: "lee@haverford.au",
      scopes: ["mcp.read"]
    });
    expect(disabled).toMatchObject({ ok: false, statusCode: 401, reason: "missing_or_invalid_auth" });
  });

  it("rejects invalid bearer keys even when a query token value is present", () => {
    const store = tempStore();

    const result = authenticateGatewayMcpRequest({
      authorizationHeader: "Bearer gw_live_invalid",
      identityHeaders: {},
      accessStore: store,
      authGateAllowedDomains: undefined,
      authGateAllowedUsers: undefined
    });

    expect(result).toMatchObject({ ok: false, statusCode: 401, reason: "missing_or_invalid_auth" });
  });
});
```

- [ ] **Step 2: Run failing auth tests**

Run:

```bash
npx vitest run test/mcp-v1-auth.test.ts
```

Expected: fails because `src/mcp-v1/auth.ts` does not exist.

- [ ] **Step 3: Create auth decision helper**

Create `src/mcp-v1/auth.ts`:

```ts
import type { GatewayAccessStore } from "../access/store.js";
import type { GatewayApiScope } from "../access/types.js";
import type { GatewayMcpActor } from "./types.js";

export interface GatewayMcpAuthInput {
  authorizationHeader?: string;
  identityHeaders: Record<string, string | string[] | undefined>;
  accessStore: GatewayAccessStore;
  authGateAllowedDomains?: string[];
  authGateAllowedUsers?: string[];
}

export type GatewayMcpAuthResult =
  | { ok: true; actor: GatewayMcpActor }
  | { ok: false; statusCode: 401 | 403; reason: "missing_or_invalid_auth" | "missing_scope"; detail: string };

const authGateHeaderPriority = ["x-auth-gate-email", "x-forwarded-email", "x-user-email"] as const;
const authGateScopes: GatewayApiScope[] = ["mcp.read"];

export function authenticateGatewayMcpRequest(input: GatewayMcpAuthInput): GatewayMcpAuthResult {
  const secret = bearerSecret(input.authorizationHeader);
  if (secret !== undefined) {
    const authenticated = input.accessStore.authenticate(secret);
    if (authenticated !== undefined) {
      return {
        ok: true,
        actor: {
          type: "api_client",
          authMethod: "api_key",
          actorId: authenticated.client.id,
          scopes: authenticated.client.scopes as GatewayApiScope[],
          authenticated
        }
      };
    }
  }

  const email = mcpAuthGateEmailFromHeaders(input.identityHeaders);
  if (email !== undefined && isAllowedAuthGateEmail(email, input.authGateAllowedDomains, input.authGateAllowedUsers)) {
    const domain = email.split("@")[1] ?? "";
    return {
      ok: true,
      actor: {
        type: "auth_gate",
        authMethod: "auth_gate",
        actorId: email,
        email,
        domain,
        scopes: authGateScopes
      }
    };
  }

  return { ok: false, statusCode: 401, reason: "missing_or_invalid_auth", detail: "Missing or invalid MCP auth" };
}

export function mcpAuthGateEmailFromHeaders(
  headers: Record<string, string | string[] | undefined>
): string | undefined {
  for (const header of authGateHeaderPriority) {
    const value = headers[header];
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first === "string" && first.trim()) {
      return first.trim().toLowerCase();
    }
  }
  return undefined;
}

function bearerSecret(header: string | undefined): string | undefined {
  const match = (header ?? "").match(/^Bearer\s+(\S+)$/i);
  return match?.[1];
}

function isAllowedAuthGateEmail(
  email: string,
  allowedDomains: string[] | undefined,
  allowedUsers: string[] | undefined
): boolean {
  const hasAllowlist = (allowedDomains?.length ?? 0) > 0 || (allowedUsers?.length ?? 0) > 0;
  if (!hasAllowlist) return false;
  if (allowedUsers?.includes(email)) return true;
  const domain = email.split("@")[1] ?? "";
  return allowedDomains?.includes(domain) ?? false;
}
```

- [ ] **Step 4: Verify Task 3**

Run:

```bash
npx vitest run test/mcp-v1-auth.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

- [ ] **Step 5: Commit Task 3**

Run:

```bash
git add src/mcp-v1/auth.ts test/mcp-v1-auth.test.ts
git commit -m "feat(mcp): add read auth decisions"
```

---

## Task 4: MCP v1 JSON-RPC Router

**Files:**
- Create: `src/mcp-v1/routes.ts`
- Create: `test/mcp-v1-routes.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write failing route tests**

Create `test/mcp-v1-routes.test.ts`:

```ts
import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GatewayAccessStore } from "../src/access/store.js";
import type { GatewayApiScope } from "../src/access/types.js";
import { FixtureGatewayBackend } from "../src/admin/fixture-backend.js";
import { createGatewayMcpV1Router } from "../src/mcp-v1/routes.js";

const stores: GatewayAccessStore[] = [];
const tempDirs: string[] = [];

function tempStorePath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-mcp-routes-"));
  tempDirs.push(dir);
  return path.join(dir, "gateway.sqlite");
}

function openStore(dbPath = tempStorePath()): GatewayAccessStore {
  const store = new GatewayAccessStore(dbPath);
  stores.push(store);
  return store;
}

function appWithStore(
  store: GatewayAccessStore,
  opts: { domains?: string[]; users?: string[]; backend?: FixtureGatewayBackend } = {}
) {
  const app = express();
  app.disable("x-powered-by");
  app.use(
    "/mcp/v1",
    createGatewayMcpV1Router({
      backend: opts.backend ?? new FixtureGatewayBackend(),
      accessStore: store,
      authGateAllowedDomains: opts.domains,
      authGateAllowedUsers: opts.users
    })
  );
  return app;
}

function credential(store: GatewayAccessStore, scopes: GatewayApiScope[]) {
  const client = store.createClient({ name: "MCP Client", type: "agent", owner: "mcp@haverford.au", scopes }, "test");
  const created = store.createKey(client.id, { label: "primary" }, "test");
  return { client, key: created.key, secret: created.secret };
}

function rpc(method: string, params?: unknown, id: number | string | null = 1) {
  return { jsonrpc: "2.0", id, method, params };
}

afterEach(() => {
  while (stores.length > 0) stores.pop()?.close();
  while (tempDirs.length > 0) fs.rmSync(tempDirs.pop() ?? "", { recursive: true, force: true });
});

describe("/mcp/v1 routes", () => {
  it("requires auth for initialize", async () => {
    const res = await request(appWithStore(openStore())).post("/mcp/v1").send(rpc("initialize"));

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "unauthorized", message: "Missing or invalid MCP auth" });
  });

  it("initializes with a gateway API key", async () => {
    const store = openStore();
    const { secret } = credential(store, ["mcp.read"]);

    const res = await request(appWithStore(store))
      .post("/mcp/v1")
      .set("Authorization", `Bearer ${secret}`)
      .send(rpc("initialize", { protocolVersion: "2025-06-18" }));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "haverford-gateway", version: "v1" }
      }
    });
  });

  it("lists tools and records audit", async () => {
    const store = openStore();
    const { secret } = credential(store, ["mcp.read"]);

    const res = await request(appWithStore(store))
      .post("/mcp/v1")
      .set("Authorization", `Bearer ${secret}`)
      .send(rpc("tools/list"));

    expect(res.status).toBe(200);
    expect(res.body.result.tools.map((tool: { name: string }) => tool.name)).toContain("gateway_list_connections");
    expect(store.listAuditEvents()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "mcp_auth.succeeded" }),
        expect.objectContaining({ action: "mcp_tool.listed" })
      ])
    );
  });

  it("calls tools with mcp.read and returns structured content", async () => {
    const store = openStore();
    const { secret } = credential(store, ["mcp.read"]);

    const res = await request(appWithStore(store))
      .post("/mcp/v1")
      .set("Authorization", `Bearer ${secret}`)
      .send(rpc("tools/call", { name: "gateway_list_connections", arguments: { brandId: "brand_haverford" } }));

    expect(res.status).toBe(200);
    expect(res.body.result).toMatchObject({
      isError: false,
      structuredContent: { connections: expect.any(Array) },
      content: [{ type: "text", text: expect.stringMatching(/^Found \d+ connections?\.$/) }]
    });
  });

  it("allows granular scopes for matching tools and denies unrelated tools", async () => {
    const store = openStore();
    const { secret } = credential(store, ["brands.read"]);
    const app = appWithStore(store);

    await request(app)
      .post("/mcp/v1")
      .set("Authorization", `Bearer ${secret}`)
      .send(rpc("tools/call", { name: "gateway_list_brands", arguments: {} }))
      .expect(200);

    const denied = await request(app)
      .post("/mcp/v1")
      .set("Authorization", `Bearer ${secret}`)
      .send(rpc("tools/call", { name: "gateway_list_connections", arguments: {} }));

    expect(denied.status).toBe(403);
    expect(denied.body).toEqual({ error: "forbidden", message: "Missing required scope: connections.read" });
  });

  it("allows trusted Auth Gate identity without requiring bearer auth", async () => {
    const store = openStore();

    const res = await request(appWithStore(store, { domains: ["haverford.au"] }))
      .post("/mcp/v1")
      .set("x-auth-gate-email", "lee@haverford.au")
      .send(rpc("tools/list"));

    expect(res.status).toBe(200);
    expect(store.listAuditEvents()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "mcp_auth.succeeded",
          actor: "lee@haverford.au",
          metadata: expect.objectContaining({ authMethod: "auth_gate", domain: "haverford.au" })
        })
      ])
    );
  });

  it("ignores query-string tokens and does not audit them", async () => {
    const store = openStore();

    const res = await request(appWithStore(store))
      .post("/mcp/v1?api_key=gw_live_should_not_work&access_token=secret")
      .send(rpc("tools/list"));

    expect(res.status).toBe(401);
    expect(JSON.stringify(store.listAuditEvents())).not.toContain("gw_live_should_not_work");
    expect(JSON.stringify(store.listAuditEvents())).not.toContain("secret");
  });

  it("returns JSON-RPC errors for bad protocol shape and method names", async () => {
    const store = openStore();
    const { secret } = credential(store, ["mcp.read"]);
    const app = appWithStore(store);

    const invalid = await request(app).post("/mcp/v1").set("Authorization", `Bearer ${secret}`).send({ method: 1 });
    const missing = await request(app).post("/mcp/v1").set("Authorization", `Bearer ${secret}`).send(rpc("missing"));

    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toMatchObject({ code: -32600 });
    expect(missing.status).toBe(200);
    expect(missing.body.error).toMatchObject({ code: -32601 });
  });

  it("returns 405 for unsupported HTTP methods", async () => {
    const store = openStore();
    const { secret } = credential(store, ["mcp.read"]);

    const res = await request(appWithStore(store)).get("/mcp/v1").set("Authorization", `Bearer ${secret}`);

    expect(res.status).toBe(405);
    expect(res.body).toEqual({ error: "method_not_allowed", message: "Use POST for /mcp/v1 JSON-RPC requests" });
  });

  it("records usage and audit without raw bearer secrets", async () => {
    const store = openStore();
    const { secret, key } = credential(store, ["mcp.read"]);

    await request(appWithStore(store))
      .post("/mcp/v1")
      .set("Authorization", `Bearer ${secret}`)
      .send(rpc("tools/call", { name: "gateway_find_connections", arguments: { query: "shopify" } }))
      .expect(200);

    const client = store.listApiClients()[0];
    const auditJson = JSON.stringify(store.listAuditEvents());
    expect(client.requestCount24h).toBe(1);
    expect(client.errorRate24h).toBe(0);
    expect(auditJson).toContain(key.fingerprint);
    expect(auditJson).not.toContain(secret);
  });

  it("keeps tool-level errors inside tools/call results", async () => {
    const store = openStore();
    const { secret } = credential(store, ["mcp.read"]);

    const res = await request(appWithStore(store))
      .post("/mcp/v1")
      .set("Authorization", `Bearer ${secret}`)
      .send(rpc("tools/call", { name: "gateway_get_connection", arguments: { connectionId: "missing" } }));

    expect(res.status).toBe(200);
    expect(res.body.result).toMatchObject({ isError: true, content: [{ type: "text", text: "Connection not found: missing" }] });
    expect(store.listAuditEvents()).toEqual(expect.arrayContaining([expect.objectContaining({ action: "mcp_tool.failed" })]));
  });
});
```

- [ ] **Step 2: Run failing route tests**

Run:

```bash
npx vitest run test/mcp-v1-routes.test.ts
```

Expected: fails because `src/mcp-v1/routes.ts` does not exist.

- [ ] **Step 3: Create route implementation**

Create `src/mcp-v1/routes.ts`:

```ts
import express from "express";
import type { NextFunction, Request, Response } from "express";
import type { GatewayAccessStore } from "../access/store.js";
import type { GatewayApiScope } from "../access/types.js";
import { scopeAllowed } from "../access/types.js";
import type { GatewayConnectionBackend } from "../admin/types.js";
import { authenticateGatewayMcpRequest } from "./auth.js";
import { callGatewayMcpTool, gatewayMcpTools, requiredScopeForGatewayMcpTool } from "./tools.js";
import type { GatewayMcpActor, McpJsonRpcRequest } from "./types.js";

interface CreateGatewayMcpV1RouterOptions {
  backend: GatewayConnectionBackend;
  accessStore: GatewayAccessStore;
  authGateAllowedDomains?: string[];
  authGateAllowedUsers?: string[];
}

declare module "express-serve-static-core" {
  interface Request {
    gatewayMcpActor?: GatewayMcpActor;
  }
}

export function createGatewayMcpV1Router(options: CreateGatewayMcpV1RouterOptions): express.Router {
  const router = express.Router();

  router.use(express.json({ limit: "1mb" }));
  router.use((req, res, next) => authenticateRequest(req, res, next, options));
  router.post("/", (req, res) => handleJsonRpc(req, res, options));
  router.all("/", (_req, res) => {
    res.status(405).json({ error: "method_not_allowed", message: "Use POST for /mcp/v1 JSON-RPC requests" });
  });

  return router;
}

function authenticateRequest(
  req: Request,
  res: Response,
  next: NextFunction,
  options: CreateGatewayMcpV1RouterOptions
): void {
  const result = authenticateGatewayMcpRequest({
    authorizationHeader: req.get("Authorization"),
    identityHeaders: req.headers,
    accessStore: options.accessStore,
    authGateAllowedDomains: options.authGateAllowedDomains,
    authGateAllowedUsers: options.authGateAllowedUsers
  });

  if (!result.ok) {
    options.accessStore.writeAccessAudit({
      action: "mcp_auth.failed",
      targetType: "api_client",
      targetId: "unknown",
      detail: result.detail,
      actor: "anonymous",
      metadata: { route: "/mcp/v1", method: req.method, reason: result.reason }
    });
    res.status(result.statusCode).json({
      error: result.statusCode === 403 ? "forbidden" : "unauthorized",
      message: result.detail
    });
    return;
  }

  req.gatewayMcpActor = result.actor;
  options.accessStore.writeAccessAudit({
    action: "mcp_auth.succeeded",
    targetType: "api_client",
    targetId: result.actor.actorId,
    detail: `Authenticated MCP ${req.method} /mcp/v1`,
    actor: result.actor.actorId,
    metadata: actorMetadata(result.actor)
  });
  next();
}

async function handleJsonRpc(
  req: Request,
  res: Response,
  options: CreateGatewayMcpV1RouterOptions
): Promise<void> {
  const startedAt = Date.now();
  const actor = req.gatewayMcpActor;
  if (actor === undefined) {
    res.status(401).json({ error: "unauthorized", message: "Missing or invalid MCP auth" });
    return;
  }

  const request = parseJsonRpcRequest(req.body);
  if (!request.ok) {
    recordUsage(options.accessStore, actor, req.method, 400, undefined, startedAt);
    res.status(400).json(jsonRpcError(null, -32600, request.message));
    return;
  }

  try {
    switch (request.value.method) {
      case "initialize":
        recordUsage(options.accessStore, actor, req.method, 200, "mcp.read", startedAt);
        res.json(jsonRpcResult(request.value.id, initializeResult(request.value.params)));
        return;
      case "notifications/initialized":
        recordUsage(options.accessStore, actor, req.method, 200, "mcp.read", startedAt);
        res.status(202).end();
        return;
      case "ping":
        recordUsage(options.accessStore, actor, req.method, 200, "mcp.read", startedAt);
        res.json(jsonRpcResult(request.value.id, {}));
        return;
      case "tools/list":
        assertActorScope(actor, "mcp.read", undefined);
        options.accessStore.writeAccessAudit({
          action: "mcp_tool.listed",
          targetType: "api_client",
          targetId: actor.actorId,
          detail: "Listed MCP gateway tools",
          actor: actor.actorId,
          metadata: { route: "/mcp/v1", method: req.method, toolCount: String(gatewayMcpTools.length), ...actorMetadata(actor) }
        });
        recordUsage(options.accessStore, actor, req.method, 200, "mcp.read", startedAt);
        res.json(jsonRpcResult(request.value.id, { tools: gatewayMcpTools }));
        return;
      case "tools/call":
        await handleToolCall(req, res, options, request.value, actor, startedAt);
        return;
      default:
        recordUsage(options.accessStore, actor, req.method, 200, undefined, startedAt);
        res.json(jsonRpcError(request.value.id, -32601, `Method not found: ${request.value.method}`));
        return;
    }
  } catch (error) {
    const message = error instanceof McpRouteError ? error.message : "Internal MCP error";
    const statusCode = error instanceof McpRouteError ? error.statusCode : 500;
    recordUsage(options.accessStore, actor, req.method, statusCode, undefined, startedAt);
    res.status(statusCode).json({
      error: statusCode === 403 ? "forbidden" : "internal_error",
      message
    });
  }
}

async function handleToolCall(
  req: Request,
  res: Response,
  options: CreateGatewayMcpV1RouterOptions,
  request: McpJsonRpcRequest,
  actor: GatewayMcpActor,
  startedAt: number
): Promise<void> {
  const params = asToolCallParams(request.params);
  const requiredScope = requiredScopeForGatewayMcpTool(params.name);
  if (requiredScope === undefined) {
    const result = await callGatewayMcpTool(params.name, params.arguments ?? {}, await options.backend.snapshot());
    recordToolAudit(options.accessStore, actor, params.name, result.isError, {});
    recordUsage(options.accessStore, actor, req.method, 200, undefined, startedAt);
    res.json(jsonRpcResult(request.id, result));
    return;
  }

  assertActorScope(actor, "mcp.read", requiredScope);
  const result = await callGatewayMcpTool(params.name, params.arguments ?? {}, await options.backend.snapshot());
  const count = resultCount(result.structuredContent);
  recordToolAudit(options.accessStore, actor, params.name, result.isError, { resultCount: count });
  recordUsage(options.accessStore, actor, req.method, 200, requiredScope, startedAt);
  res.json(jsonRpcResult(request.id, result));
}

function assertActorScope(actor: GatewayMcpActor, mcpScope: GatewayApiScope, granularScope: GatewayApiScope | undefined): void {
  if (scopeAllowed(actor.scopes, mcpScope)) return;
  if (granularScope !== undefined && scopeAllowed(actor.scopes, granularScope)) return;
  throw new McpRouteError(403, `Missing required scope: ${granularScope ?? mcpScope}`);
}

function parseJsonRpcRequest(body: unknown): { ok: true; value: McpJsonRpcRequest } | { ok: false; message: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, message: "Invalid JSON-RPC request" };
  }
  const value = body as Partial<McpJsonRpcRequest>;
  if (value.jsonrpc !== "2.0" || typeof value.method !== "string") {
    return { ok: false, message: "Invalid JSON-RPC request" };
  }
  return { ok: true, value: value as McpJsonRpcRequest };
}

function initializeResult(params: unknown): Record<string, unknown> {
  const requested =
    params && typeof params === "object" && "protocolVersion" in params && typeof params.protocolVersion === "string"
      ? params.protocolVersion
      : "2025-06-18";
  return {
    protocolVersion: requested,
    capabilities: { tools: { listChanged: false } },
    serverInfo: { name: "haverford-gateway", version: "v1" }
  };
}

function asToolCallParams(params: unknown): { name: string; arguments?: unknown } {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    throw new McpRouteError(400, "tools/call params must be an object");
  }
  const value = params as { name?: unknown; arguments?: unknown };
  if (typeof value.name !== "string" || value.name.trim() === "") {
    throw new McpRouteError(400, "tools/call name is required");
  }
  return { name: value.name, arguments: value.arguments };
}

function jsonRpcResult(id: McpJsonRpcRequest["id"], result: unknown): Record<string, unknown> {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function jsonRpcError(id: McpJsonRpcRequest["id"], code: number, message: string): Record<string, unknown> {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function recordUsage(
  accessStore: GatewayAccessStore,
  actor: GatewayMcpActor,
  method: string,
  statusCode: number,
  scope: GatewayApiScope | undefined,
  startedAt: number
): void {
  accessStore.recordUsage({
    clientId: actor.type === "api_client" ? actor.authenticated.client.id : undefined,
    keyId: actor.type === "api_client" ? actor.authenticated.key.id : undefined,
    route: "/mcp/v1",
    method,
    statusCode,
    scope,
    durationMs: Math.max(0, Date.now() - startedAt)
  });
}

function recordToolAudit(
  accessStore: GatewayAccessStore,
  actor: GatewayMcpActor,
  toolName: string,
  failed: boolean,
  metadata: Record<string, string>
): void {
  accessStore.writeAccessAudit({
    action: failed ? "mcp_tool.failed" : "mcp_tool.called",
    targetType: "api_client",
    targetId: actor.actorId,
    detail: `${failed ? "Failed" : "Called"} MCP tool ${toolName}`,
    actor: actor.actorId,
    metadata: { toolName, ...metadata, ...actorMetadata(actor) }
  });
}

function actorMetadata(actor: GatewayMcpActor): Record<string, string> {
  if (actor.type === "api_client") {
    return {
      authMethod: "api_key",
      clientId: actor.authenticated.client.id,
      keyId: actor.authenticated.key.id,
      fingerprint: actor.authenticated.key.fingerprint
    };
  }
  return { authMethod: "auth_gate", email: actor.email, domain: actor.domain };
}

function resultCount(structuredContent: Record<string, unknown>): string {
  for (const value of Object.values(structuredContent)) {
    if (Array.isArray(value)) return String(value.length);
  }
  return "1";
}

class McpRouteError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}
```

- [ ] **Step 4: Mount `/mcp/v1` before `/mcp`**

In `src/index.ts`, add the import:

```ts
import { createGatewayMcpV1Router } from "./mcp-v1/routes.js";
```

Mount before the existing `/mcp` router:

```ts
app.use(
  "/mcp/v1",
  createGatewayMcpV1Router({
    backend: adminBackend,
    accessStore,
    authGateAllowedDomains: config.mcpAuthGateAllowedDomains,
    authGateAllowedUsers: config.mcpAuthGateAllowedUsers
  })
);

const mcpRouter = express.Router();
```

Do not change the existing `/mcp` router body.

- [ ] **Step 5: Verify Task 4**

Run:

```bash
npx vitest run test/mcp-v1-routes.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

- [ ] **Step 6: Commit Task 4**

Run:

```bash
git add src/index.ts src/mcp-v1/routes.ts test/mcp-v1-routes.test.ts
git commit -m "feat(mcp): add versioned read endpoint"
```

---

## Task 5: Existing `/mcp` Regression Coverage And Documentation

**Files:**
- Modify: `test/mcp-proxy.test.ts`
- Modify: `README.md`

- [ ] **Step 1: Add regression test for `/mcp/v1` separation**

Append this test to `test/mcp-proxy.test.ts`:

```ts
it("does not route /mcp/v1 through the Composio proxy", async () => {
  const upstreamFetch = makeFetch({
    status: 200,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools: [{ name: "upstream" }] } })
  });
  const { app } = buildApp({ fetchImpl: upstreamFetch });

  const res = await request(app)
    .post("/mcp/v1")
    .set("Authorization", "Bearer a_secret_thats_long_enough")
    .send({ jsonrpc: "2.0", id: 1, method: "tools/list" });

  expect(res.status).toBe(404);
  expect(upstreamFetch).not.toHaveBeenCalled();
});
```

This test uses the local `buildApp()` helper that only mounts `/mcp`; it proves the Composio proxy helper does not catch `/mcp/v1` by itself. The full route mounting behavior is covered in `test/mcp-v1-routes.test.ts`.

- [ ] **Step 2: Run MCP regression tests**

Run:

```bash
npx vitest run test/mcp-proxy.test.ts test/mcp-v1-routes.test.ts
```

Expected: existing `/mcp` proxy tests still pass and `/mcp/v1` route tests pass.

- [ ] **Step 3: Update README environment table**

In `README.md`, add rows near the existing env var table:

```md
| `MCP_AUTH_GATE_ALLOWED_DOMAINS` | no | Comma-separated lowercased domain allowlist for optional `/mcp/v1` Auth Gate identity access |
| `MCP_AUTH_GATE_ALLOWED_USERS` | no | Comma-separated lowercased email allowlist for optional `/mcp/v1` Auth Gate identity access |
```

- [ ] **Step 4: Add local `/mcp/v1` smoke docs**

In `README.md`, add a short section after the API access smoke section:

```md
### Local MCP v1 metadata smoke

`/mcp/v1` is the gateway-owned read-only MCP metadata endpoint. It is separate from the existing `/mcp` Composio proxy.

1. Start the gateway with fixture overlay and a persistent local store:

   ```bash
   ADMIN_DATA_SOURCE=fixture-overlay \
   GATEWAY_STORE_PATH=./data/local-mcp-smoke.sqlite \
   COMPOSIO_API_KEY=ak_local_dummy \
   BRAND_SLUG=haverford \
   GATEWAY_BEARER=local_gateway_bearer \
   npm run dev
   ```

2. Create an API client in the admin UI or admin API with the `mcp.read` scope and create one key.
3. Call the MCP tools list:

   ```bash
   curl -s http://localhost:3000/mcp/v1 \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $GW_KEY" \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
   ```

4. Call connection metadata:

   ```bash
   curl -s http://localhost:3000/mcp/v1 \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $GW_KEY" \
     -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"gateway_list_connections","arguments":{"brandId":"brand_haverford"}}}'
   ```

5. Restart with the same `GATEWAY_STORE_PATH` and repeat step 4. The same key should still work, and usage/audit rows should persist.
```

- [ ] **Step 5: Verify docs and regression tests**

Run:

```bash
npx vitest run test/mcp-proxy.test.ts test/mcp-v1-routes.test.ts
npm run typecheck
```

Expected: pass.

- [ ] **Step 6: Commit Task 5**

Run:

```bash
git add README.md test/mcp-proxy.test.ts
git commit -m "docs: document mcp v1 metadata smoke"
```

---

## Task 6: Full Verification And Local Smoke

**Files:**
- Verify: all implementation files
- Optional modify if smoke reveals a real defect

- [ ] **Step 1: Run the full automated suite**

Run:

```bash
npm test
npm run typecheck
npm run build
```

Expected: all pass.

- [ ] **Step 2: Run local MCP smoke with persisted SQLite**

Use a disposable smoke store:

```bash
rm -f ./data/phase3-mcp-smoke.sqlite
ADMIN_DATA_SOURCE=fixture-overlay \
GATEWAY_STORE_PATH=./data/phase3-mcp-smoke.sqlite \
COMPOSIO_API_KEY=ak_local_dummy \
BRAND_SLUG=haverford \
GATEWAY_BEARER=local_gateway_bearer \
PORT=3000 \
npm run dev
```

In another terminal, create a client/key using the existing admin API. If the admin API requires no admin auth in this local build, use:

```bash
curl -s http://localhost:3000/admin/api/clients \
  -H "Content-Type: application/json" \
  -d '{"name":"Local MCP Smoke","type":"agent","owner":"mcp@haverford.au","scopes":["mcp.read"]}'
```

Then create a key using the returned `client.id`:

```bash
curl -s http://localhost:3000/admin/api/clients/$CLIENT_ID/keys \
  -H "Content-Type: application/json" \
  -d '{"label":"local-smoke"}'
```

Call MCP:

```bash
curl -s http://localhost:3000/mcp/v1 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $GW_KEY" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

curl -s http://localhost:3000/mcp/v1 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $GW_KEY" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"gateway_list_connections","arguments":{"brandId":"brand_haverford"}}}'
```

Expected:

- `tools/list` includes `gateway_list_connections`.
- `tools/call` returns `structuredContent.connections`.
- The response does not contain `access_token`, `secret`, `password`, `Bearer`, `ya29`, `shpat_`, `sk_`, or `gw_live_` except the client-provided header outside the response body.

- [ ] **Step 3: Restart and verify persistence**

Stop `npm run dev`, restart with the same `GATEWAY_STORE_PATH`, then run:

```bash
curl -s http://localhost:3000/mcp/v1 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $GW_KEY" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"gateway_find_connections","arguments":{"query":"shopify au"}}}'
```

Expected: same key still authenticates and returns Shopify AU connection metadata.

- [ ] **Step 4: Inspect usage and audit via admin state**

Run:

```bash
curl -s http://localhost:3000/admin/api/state
```

Expected:

- API client `Local MCP Smoke` has increased `requestCount24h`.
- Audit history includes `mcp_auth.succeeded`, `mcp_tool.listed`, and `mcp_tool.called`.
- Audit JSON does not include `$GW_KEY`.

- [ ] **Step 5: Stop local dev server**

Terminate the `npm run dev` process used for smoke. Do not leave an execution session running before final response.

- [ ] **Step 6: Commit smoke docs if any docs changed**

If smoke required README command corrections, commit them:

```bash
git add README.md
git commit -m "docs: refine mcp v1 smoke commands"
```

If smoke required no edits, skip this commit.

---

## Task 7: Final Phase Gate

**Files:**
- Verify: all changed files

- [ ] **Step 1: Compare implementation to approved Phase 3 spec**

Run:

```bash
git diff main...HEAD --stat
```

Manual checklist:

- `/mcp` Composio proxy behavior is unchanged.
- `/mcp/v1` exists and is mounted before `/mcp`.
- `/mcp/v1` supports `initialize`, `notifications/initialized`, `ping`, `tools/list`, and `tools/call`.
- Six read-only gateway tools exist.
- Tool calls return `structuredContent`, `content`, and `isError`.
- Gateway API keys with `mcp.read` can use all tools.
- Granular read scopes can use matching tools only.
- Auth Gate identity is optional and allowlist-gated.
- Query-token auth is not implemented.
- Usage and audit rows are recorded without raw secrets.
- No provider execution, OAuth setup, Nango, Composio OAuth, native connector execution, writes, or `/api/compat` behavior was added.

- [ ] **Step 2: Run final verification**

Run:

```bash
npm test
npm run typecheck
npm run build
```

Expected: all pass.

- [ ] **Step 3: Capture final status**

Run:

```bash
git status --short --branch
git log --oneline --decorate -5
```

Expected:

- Branch is `story/19-phase-3-mcp-read-access`.
- Only unrelated untracked file, if present, is `scripts/fix-pipedrive-connection.mjs`.
- Recent commits include the Phase 3 plan and implementation commits.

- [ ] **Step 4: Request code review before merge**

Use `superpowers:requesting-code-review` because this is a major feature phase. Give the reviewer:

```text
Review Phase 3 MCP read access on branch story/19-phase-3-mcp-read-access. Focus on auth separation between /mcp and /mcp/v1, scope enforcement, secret redaction, JSON-RPC compatibility, usage/audit behavior, and whether any provider/OAuth behavior leaked into Phase 3.
```

- [ ] **Step 5: Apply review feedback using the receiving-code-review workflow**

If review returns issues, use `superpowers:receiving-code-review` before editing. Fix only confirmed issues or clearly defensible improvements connected to Phase 3.

- [ ] **Step 6: Finish branch**

Use `superpowers:finishing-a-development-branch` after all tests, smoke, and review are complete. If the branch is merged locally into `main`, run the final verification again on `main` before reporting completion.

---

## Self-Review

Spec coverage:

- Separate `/mcp/v1` endpoint: Task 4.
- Existing `/mcp` unchanged: Tasks 4 and 5.
- Read-only tools for brands, regions, connectors, connections, get, and find: Task 2.
- Phase 2 backend/resource/access-store reuse: Tasks 2, 3, and 4.
- Gateway API key bearer auth with `mcp.read`: Tasks 1, 3, and 4.
- Granular read scopes: Tasks 2 and 4.
- Optional Auth Gate identity allowlists: Tasks 1, 3, and 4.
- No query-token auth: Tasks 3, 4, and 6.
- Usage/audit without secrets: Tasks 4 and 6.
- Local smoke with persistent SQLite: Task 6.
- No OAuth/provider execution/Nango/native runtime behavior: Task 7 checklist.

Placeholder scan:

- No unresolved placeholder markers or undefined placeholder functions remain in the plan.
- Each implementation task includes concrete file paths, code snippets, commands, and expected outcomes.

Type consistency:

- `GatewayMcpActor`, `GatewayMcpToolResult`, `McpToolDefinition`, `callGatewayMcpTool()`, `gatewayMcpTools`, `requiredScopeForGatewayMcpTool()`, `authenticateGatewayMcpRequest()`, and `createGatewayMcpV1Router()` are defined before route tasks use them.
- Scope strings match `GatewayApiScope`.
- Audit actions match `AuditAction`.
