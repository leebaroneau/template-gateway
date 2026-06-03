import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { AdminBackendError } from "../src/admin/backend-error.js";
import { renderAdminClientScript } from "../src/admin/client-script.js";
import { FixtureGatewayBackend } from "../src/admin/fixture-backend.js";
import { createAdminRouter } from "../src/admin/routes.js";
import { createApp } from "../src/index.js";
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
import type { GatewayConfig } from "../src/config.js";

function buildAdminApp(backend: GatewayConnectionBackend = new FixtureGatewayBackend()) {
  const app = express();
  app.disable("x-powered-by");
  app.use("/admin", createAdminRouter(backend));
  return { app, backend };
}

function asyncBackendFromFixture(): GatewayConnectionBackend {
  const fixture = new FixtureGatewayBackend();
  return {
    snapshot: async () => fixture.snapshot(),
    createBrand: async (input: CreateBrandInput): Promise<Brand> => fixture.createBrand(input),
    createRegion: async (input: CreateRegionInput): Promise<Region> => fixture.createRegion(input),
    createConnection: async (input: CreateConnectionInput): Promise<Connection> => fixture.createConnection(input),
    updateBrand: async (brandId, input) => fixture.updateBrand(brandId, input),
    updateRegion: async (regionId, input) => fixture.updateRegion(regionId, input),
    updateConnection: async (connectionId, input) => fixture.updateConnection(connectionId, input),
    resetEntity: async (input) => fixture.resetEntity(input),
    testConnection: async (connectionId: string): Promise<Connection> => fixture.testConnection(connectionId),
    rotateApiKey: async (clientId: string, keyId: string): Promise<ApiKey> => fixture.rotateApiKey(clientId, keyId),
    revokeApiKey: async (clientId: string, keyId: string): Promise<ApiKey> => fixture.revokeApiKey(clientId, keyId)
  };
}

function testConfig(): GatewayConfig {
  return {
    composioApiKey: "ak_test",
    brandSlug: "haverford",
    gatewayBearer: "a_secret_thats_long_enough",
    port: 3000,
    sessionTtlSeconds: 3600,
    adminDataSource: "fixture",
    gatewayStorePath: "./data/gateway.sqlite"
  };
}

describe("admin routes", () => {
  it("mounts the admin HTML shell under /admin without changing health routing", async () => {
    const app = createApp(testConfig());

    const admin = await request(app).get("/admin");
    const health = await request(app).get("/health");

    expect(admin.status).toBe(200);
    expect(admin.headers["content-type"]).toContain("text/html");
    expect(admin.headers["cache-control"]).toBe("no-store");
    expect(admin.text).toContain("Haverford Unified Gateway");
    expect(admin.text).toContain("/admin/style.css");
    expect(admin.text).toContain("/admin/app.js?v=fixture-ui");
    expect(admin.text).toContain("Overview");
    expect(admin.text).toContain("Brands");
    expect(admin.text).toContain("Connectors");
    expect(admin.text).toContain("API Access");
    expect(admin.text).toContain("Audit");
    expect(health.status).toBe(200);
    expect(health.body).toMatchObject({ status: "ok", brand: "haverford" });
  });

  it("lets createApp mount an injected admin backend for local smoke tests", async () => {
    const fixtureBackend = asyncBackendFromFixture();
    const injectedBackend = {
      ...fixtureBackend,
      snapshot: async () => {
        const fixtureState = await fixtureBackend.snapshot();
        return {
          ...fixtureState,
          brands: [{ id: "brand_injected", slug: "injected-only", name: "Injected Only", status: "active" }],
          regions: [],
          connections: []
        };
      },
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
      }
    } satisfies GatewayConnectionBackend;
    const app = createApp(testConfig(), { adminBackend: injectedBackend });

    const res = await request(app).get("/admin/api/state");
    const brandSlugs = res.body.brands.map((brand: { slug: string }) => brand.slug);

    expect(res.status).toBe(200);
    expect(brandSlugs).toContain("injected-only");
    expect(brandSlugs).not.toContain("haverford");
  });

  it("requires Dev API settings when createApp uses the dev-api admin data source", () => {
    expect(() => createApp({ ...testConfig(), adminDataSource: "dev-api" })).toThrow(/HAVERFORD_DEV_API_BASE_URL/);
  });

  it("serves admin CSS and browser JavaScript assets", async () => {
    const { app } = buildAdminApp();

    const css = await request(app).get("/admin/style.css");
    const js = await request(app).get("/admin/app.js");

    expect(css.status).toBe(200);
    expect(css.headers["content-type"]).toContain("text/css");
    expect(css.headers["cache-control"]).toBe("no-store");
    expect(css.text).toContain(".admin-shell");
    expect(css.text).toContain(".source-chip");
    expect(css.text).toContain(".inline-edit");
    expect(css.text).toContain(".btn-reset");
    expect(js.status).toBe(200);
    expect(js.headers["content-type"]).toContain("javascript");
    expect(js.headers["cache-control"]).toBe("no-store");
    expect(js.text).toContain("/admin/api/state");
    expect(js.text).toContain("function patchJson");
    expect(js.text).toContain("function sourceBadge");
    expect(js.text).toContain("function configSummaryFromText");
    expect(js.text).toContain("/admin/api/entities/reset");
    expect(js.text).toContain("/admin/api/brands/");
    expect(js.text).toContain("/admin/api/regions/");
    expect(js.text).toContain("/admin/api/connections/");
    expect(js.text).toContain('class="panel setup-flow" id="setup-flow"');
    expect(js.text).toContain('class="setup-summary span-2"');
    expect(js.text).toContain("<strong>Scopes</strong>");
    expect(js.text).toContain("<strong>Supported backends</strong>");
    expect(js.text).toContain('form data-action="create-connection"');
    expect(js.text).toContain('form data-action="update-brand"');
    expect(js.text).toContain('form data-action="update-region"');
    expect(js.text).toContain('form data-action="update-connection"');
    expect(js.text).toContain('select name="connectorId" data-control="connector"');
    expect(js.text).toContain('select data-control="region" aria-label="Selected region"');
    expect(js.text).toContain('select data-control="connection" aria-label="Selected connection"');
    expect(js.text).toContain('data-action="test-connection"');
    expect(js.text).toContain('data-action="select-connection"');
    expect(js.text).toContain('data-action="reset-entity"');
    expect(js.text).toContain('data-action="rotate-key"');
    expect(js.text).toContain('data-action="revoke-key"');
    expect(() => new Function(js.text)).not.toThrow();
  });

  it("serves admin JavaScript that boots against the fixture state", async () => {
    const { app, backend } = buildAdminApp();
    const js = await request(app).get("/admin/app.js");
    const root = { innerHTML: "" };
    const errorPanel = { textContent: "", hidden: true };
    const documentMock = {
      getElementById(id: string) {
        if (id === "app-root") {
          return root;
        }
        if (id === "app-error") {
          return errorPanel;
        }
        return null;
      },
      querySelectorAll() {
        return [];
      },
      addEventListener() {
        // Event wiring is covered by route/lifecycle tests; this smoke check verifies initial boot.
      }
    };
    const fetchMock = async (path: string) => {
      expect(path).toBe("/admin/api/state");
      return {
        ok: true,
        text: async () => JSON.stringify(backend.snapshot())
      };
    };

    const executeScript = new Function("document", "fetch", js.text);
    expect(() => executeScript(documentMock, fetchMock)).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));

    expect(errorPanel.hidden).toBe(true);
    expect(root.innerHTML).toContain("Overview");
    expect(root.innerHTML).toContain("Brands");
    expect(root.innerHTML).toContain("Active keys");
  });

  it("renders provenance, override, and reconfiguration controls in browser JavaScript", async () => {
    const { app, backend } = buildAdminApp();
    const js = await request(app).get("/admin/app.js");
    const fixtureState = backend.snapshot();
    const state = {
      ...fixtureState,
      entityMeta: [
        {
          entityType: "brand",
          entityId: "brand_haverford",
          source: "dev_api",
          sourceLabel: "Haverford Dev API",
          hasOverride: true,
          overrideFields: ["name", "status"],
          updatedAt: "2026-06-02T00:00:00.000Z",
          updatedBy: "task-7-test"
        },
        {
          entityType: "region",
          entityId: "region_haverford_au",
          source: "gateway",
          sourceLabel: "Gateway overlay",
          hasOverride: true,
          overrideFields: ["domain"],
          updatedAt: "2026-06-02T00:00:00.000Z",
          updatedBy: "task-7-test"
        },
        {
          entityType: "connection",
          entityId: "connection_haverford_au_outlook",
          source: "fixture",
          sourceLabel: "Fixture backend",
          hasOverride: true,
          overrideFields: ["displayName", "configSummary"],
          updatedAt: "2026-06-02T00:00:00.000Z",
          updatedBy: "task-7-test"
        }
      ]
    };
    const root = { innerHTML: "" };
    const errorPanel = { textContent: "", hidden: true };
    const listeners = new Map<string, (event: unknown) => void>();
    const documentMock = {
      getElementById(id: string) {
        if (id === "app-root") {
          return root;
        }
        if (id === "app-error") {
          return errorPanel;
        }
        return null;
      },
      querySelectorAll() {
        return [];
      },
      addEventListener(type: string, listener: (event: unknown) => void) {
        listeners.set(type, listener);
      }
    };
    const fetchMock = async (path: string) => ({
      ok: true,
      text: async () => {
        expect(path).toBe("/admin/api/state");
        return JSON.stringify(state);
      }
    });

    const executeScript = new Function("document", "fetch", js.text);
    expect(() => executeScript(documentMock, fetchMock)).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));
    listeners.get("click")?.({
      target: {
        closest: (selector: string) => (selector === "button[data-view]" ? { dataset: { view: "brands" } } : null)
      }
    });

    expect(errorPanel.hidden).toBe(true);
    expect(root.innerHTML).toContain("Haverford Dev API");
    expect(root.innerHTML).toContain("Gateway overlay");
    expect(root.innerHTML).toContain("Fixture backend");
    expect(root.innerHTML).toContain("Override");
    expect(root.innerHTML).toContain('form data-action="update-brand"');
    expect(root.innerHTML).toContain('form data-action="update-region"');
    expect(root.innerHTML).toContain('form data-action="update-connection"');
    expect(root.innerHTML).toContain('data-action="reset-entity"');
  });

  it("wraps browser JavaScript so tsx helper-injected function strings can execute", () => {
    const script = renderAdminClientScript(`function mockClientApp() {
      function markBooted() {
        window.booted = true;
      }
      __name(markBooted, "markBooted");
      markBooted();
    }`);
    const windowMock = { booted: false };

    const executeScript = new Function("window", script);
    expect(() => executeScript(windowMock)).not.toThrow();
    expect(windowMock.booted).toBe(true);
  });

  it("serves browser JavaScript that keeps selected regions scoped to the selected brand", async () => {
    const { app } = buildAdminApp();

    const js = await request(app).get("/admin/app.js");

    expect(js.status).toBe(200);
    expect(js.text).toContain("function selectedRegionForBrand");
    expect(js.text).toContain("function selectBrand");
    expect(js.text).not.toContain('const selectedRegion = byId("regions", uiState.selectedRegionId);');
  });

  it("keeps unauthenticated MCP POST protected when admin routes are mounted", async () => {
    const app = createApp(testConfig());

    const res = await request(app).post("/mcp").send({ jsonrpc: "2.0", id: 1, method: "tools/list" });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "missing bearer token" });
  });

  it("returns fixture state with brands and connectors", async () => {
    const { app } = buildAdminApp();

    const res = await request(app).get("/admin/api/state");

    expect(res.status).toBe(200);
    expect(res.body.brands.length).toBeGreaterThanOrEqual(3);
    expect(res.body.connectors.length).toBeGreaterThanOrEqual(8);
    expect(res.body.connections.length).toBeGreaterThanOrEqual(8);
  });

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

  it("returns JSON errors when async state loading fails", async () => {
    const backend = {
      ...asyncBackendFromFixture(),
      snapshot: async () => {
        throw new Error("snapshot failed");
      },
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
      }
    } satisfies GatewayConnectionBackend;
    const app = express();
    app.disable("x-powered-by");
    app.use("/admin", createAdminRouter(backend));

    const res = await request(app).get("/admin/api/state");

    expect(res.status).toBe(400);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.body).toEqual({ error: "snapshot failed" });
  });

  it("creates brands, regions, and connections with 201 responses and fresh state", async () => {
    const { app } = buildAdminApp();

    const brandRes = await request(app).post("/admin/api/brands").send({
      name: "Route Test Brand",
      slug: "route-test-brand"
    });
    expect(brandRes.status).toBe(201);
    expect(brandRes.body.brand).toMatchObject({
      name: "Route Test Brand",
      slug: "route-test-brand",
      status: "active"
    });
    expect(brandRes.body.state.brands).toContainEqual(brandRes.body.brand);

    const regionRes = await request(app).post(`/admin/api/brands/${brandRes.body.brand.id}/regions`).send({
      code: "uk",
      name: "United Kingdom",
      domain: "route-test.example"
    });
    expect(regionRes.status).toBe(201);
    expect(regionRes.body.region).toMatchObject({
      brandId: brandRes.body.brand.id,
      code: "UK",
      name: "United Kingdom",
      status: "active"
    });
    expect(regionRes.body.state.regions).toContainEqual(regionRes.body.region);

    const connector = regionRes.body.state.connectors.find((candidate: { slug: string }) => candidate.slug === "outlook");
    expect(connector).toBeDefined();
    const connectionRes = await request(app).post(`/admin/api/regions/${regionRes.body.region.id}/connections`).send({
      brandId: brandRes.body.brand.id,
      connectorId: connector.id,
      backendType: "composio",
      displayName: "Route Test Outlook",
      configSummary: {
        mailbox: "ops@route-test.example",
        tenant: "Route Test Tenant"
      }
    });

    expect(connectionRes.status).toBe(201);
    expect(connectionRes.body.connection).toMatchObject({
      brandId: brandRes.body.brand.id,
      regionId: regionRes.body.region.id,
      connectorId: connector.id,
      backendType: "composio",
      displayName: "Route Test Outlook",
      status: "pending",
      configSummary: {
        mailbox: "ops@route-test.example",
        tenant: "Route Test Tenant"
      }
    });
    expect(connectionRes.body.state.connections).toContainEqual(connectionRes.body.connection);
  });

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

  it("patches brands, regions, and connections through the backend and returns fresh state", async () => {
    const baseBackend = asyncBackendFromFixture();
    const backend = {
      ...baseBackend,
      updateBrand: vi.fn(async (brandId, input) => baseBackend.updateBrand(brandId, input)),
      updateRegion: vi.fn(async (regionId, input) => baseBackend.updateRegion(regionId, input)),
      updateConnection: vi.fn(async (connectionId, input) => baseBackend.updateConnection(connectionId, input))
    } satisfies GatewayConnectionBackend;
    const { app } = buildAdminApp(backend);

    const brandRes = await request(app).patch("/admin/api/brands/brand_haverford").send({
      name: "Haverford Route Updated",
      status: "disabled"
    });
    const regionRes = await request(app).patch("/admin/api/regions/region_haverford_au").send({
      name: "Australia Route Updated",
      domain: "routes.haverford.example"
    });
    const connectionRes = await request(app).patch("/admin/api/connections/connection_haverford_au_outlook").send({
      displayName: "Route Updated Outlook",
      status: "needs_config",
      configSummary: {
        mailbox: "ops@routes.example"
      },
      lastError: null
    });

    expect(brandRes.status).toBe(200);
    expect(backend.updateBrand).toHaveBeenCalledWith("brand_haverford", {
      name: "Haverford Route Updated",
      status: "disabled"
    });
    expect(brandRes.body.brand).toMatchObject({ id: "brand_haverford", name: "Haverford Route Updated" });
    expect(brandRes.body.state.brands).toContainEqual(brandRes.body.brand);

    expect(regionRes.status).toBe(200);
    expect(backend.updateRegion).toHaveBeenCalledWith("region_haverford_au", {
      name: "Australia Route Updated",
      domain: "routes.haverford.example"
    });
    expect(regionRes.body.region).toMatchObject({ id: "region_haverford_au", name: "Australia Route Updated" });
    expect(regionRes.body.state.regions).toContainEqual(regionRes.body.region);

    expect(connectionRes.status).toBe(200);
    expect(backend.updateConnection).toHaveBeenCalledWith("connection_haverford_au_outlook", {
      displayName: "Route Updated Outlook",
      status: "needs_config",
      configSummary: {
        mailbox: "ops@routes.example"
      },
      lastError: null
    });
    expect(connectionRes.body.connection).toMatchObject({
      id: "connection_haverford_au_outlook",
      displayName: "Route Updated Outlook",
      configSummary: {
        mailbox: "ops@routes.example"
      }
    });
    expect(connectionRes.body.state.connections).toContainEqual(connectionRes.body.connection);
  });

  it("resets entities through the backend and returns the reset state", async () => {
    const baseBackend = asyncBackendFromFixture();
    const backend = {
      ...baseBackend,
      resetEntity: vi.fn(async (input) => ({
        ...(await baseBackend.snapshot()),
        brands: [{ id: "brand_reset", slug: "reset", name: "Reset State", status: "active" }]
      }))
    } satisfies GatewayConnectionBackend;
    const { app } = buildAdminApp(backend);

    const res = await request(app).post("/admin/api/entities/reset").send({
      entityType: "brand",
      entityId: "brand_haverford"
    });

    expect(res.status).toBe(200);
    expect(backend.resetEntity).toHaveBeenCalledWith({ entityType: "brand", entityId: "brand_haverford" });
    expect(res.body).toMatchObject({
      state: {
        brands: [{ id: "brand_reset", slug: "reset", name: "Reset State", status: "active" }]
      }
    });
  });

  it("supports the spec reset route with entity type and id path params", async () => {
    const baseBackend = asyncBackendFromFixture();
    const backend = {
      ...baseBackend,
      resetEntity: vi.fn(async (input) => ({
        ...(await baseBackend.snapshot()),
        brands: [{ id: "brand_reset", slug: "reset", name: "Reset State", status: "active" }]
      }))
    } satisfies GatewayConnectionBackend;
    const { app } = buildAdminApp(backend);

    const res = await request(app).post("/admin/api/entities/brand/brand_haverford/reset").send({});

    expect(res.status).toBe(200);
    expect(backend.resetEntity).toHaveBeenCalledWith({ entityType: "brand", entityId: "brand_haverford" });
    expect(res.body).toMatchObject({
      state: {
        brands: [{ id: "brand_reset", slug: "reset", name: "Reset State", status: "active" }]
      }
    });
  });

  it("returns 400 JSON when patching entities with array bodies", async () => {
    const backend = {
      ...asyncBackendFromFixture(),
      updateBrand: vi.fn(),
      updateRegion: vi.fn(),
      updateConnection: vi.fn()
    } satisfies GatewayConnectionBackend;
    const { app } = buildAdminApp(backend);

    const brandRes = await request(app).patch("/admin/api/brands/brand_haverford").send([]);
    const regionRes = await request(app).patch("/admin/api/regions/region_haverford_au").send([]);
    const connectionRes = await request(app).patch("/admin/api/connections/connection_haverford_au_outlook").send([]);

    for (const res of [brandRes, regionRes, connectionRes]) {
      expect(res.status).toBe(400);
      expect(res.headers["content-type"]).toContain("application/json");
      expect(res.body).toEqual({ error: "Request body must be an object" });
    }
    expect(backend.updateBrand).not.toHaveBeenCalled();
    expect(backend.updateRegion).not.toHaveBeenCalled();
    expect(backend.updateConnection).not.toHaveBeenCalled();
  });

  it("returns 400 JSON when resetting entities with array or null bodies", async () => {
    const backend = {
      ...asyncBackendFromFixture(),
      resetEntity: vi.fn()
    } satisfies GatewayConnectionBackend;
    const { app } = buildAdminApp(backend);

    const arrayRes = await request(app).post("/admin/api/entities/reset").send([]);
    const nullRes = await request(app)
      .post("/admin/api/entities/reset")
      .set("Content-Type", "application/json")
      .send("null");

    for (const res of [arrayRes, nullRes]) {
      expect(res.status).toBe(400);
      expect(res.headers["content-type"]).toContain("application/json");
      expect(res.body).toEqual({ error: "Request body must be an object" });
    }
    expect(backend.resetEntity).not.toHaveBeenCalled();
  });

  it("surfaces backend conflict errors with their status code", async () => {
    const backend = {
      ...asyncBackendFromFixture(),
      updateBrand: vi.fn(async () => {
        throw new AdminBackendError(409, "Cannot edit source-owned brand identity fields.");
      })
    } satisfies GatewayConnectionBackend;
    const { app } = buildAdminApp(backend);

    const res = await request(app).patch("/admin/api/brands/brand_haverford").send({ slug: "renamed" });

    expect(res.status).toBe(409);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.body).toEqual({ error: "Cannot edit source-owned brand identity fields." });
  });

  it("does not echo raw submitted secret or reference values in connection responses or state", async () => {
    const { app } = buildAdminApp();
    const stateRes = await request(app).get("/admin/api/state");
    const brand = stateRes.body.brands.find((candidate: { slug: string }) => candidate.slug === "haverford");
    const region = stateRes.body.regions.find(
      (candidate: { brandId: string; code: string }) => candidate.brandId === brand.id && candidate.code === "AU"
    );
    const connector = stateRes.body.connectors.find((candidate: { slug: string }) => candidate.slug === "shopify");
    const rawToken = "shpat_route_raw_secret_123";
    const rawReference = "vault://route/raw-shopify-token";

    const connectionRes = await request(app).post(`/admin/api/regions/${region.id}/connections`).send({
      brandId: brand.id,
      connectorId: connector.id,
      backendType: "nango",
      displayName: "Route Sanitized Shopify",
      configSummary: {
        shop_domain: "route-test.myshopify.com",
        access_token: rawToken,
        access_token_ref: rawReference
      }
    });

    expect(connectionRes.status).toBe(201);
    expect(connectionRes.body.connection.configSummary).toEqual({
      shop_domain: "route-test.myshopify.com",
      access_token_ref: "fixture-redacted:access_token"
    });
    expect(JSON.stringify(connectionRes.body)).not.toContain(rawToken);
    expect(JSON.stringify(connectionRes.body)).not.toContain(rawReference);

    const freshState = await request(app).get("/admin/api/state");
    expect(JSON.stringify(freshState.body)).not.toContain(rawToken);
    expect(JSON.stringify(freshState.body)).not.toContain(rawReference);
  });

  it("tests connections and rotates or revokes API keys by stable fixture ID", async () => {
    const { app } = buildAdminApp();
    const lifecycleConnectionId = "connection_haverford_au_outlook";
    const stateRes = await request(app).get("/admin/api/state");
    const connection = stateRes.body.connections.find(
      (candidate: { id: string }) => candidate.id === lifecycleConnectionId
    );
    const client = stateRes.body.apiClients.find(
      (candidate: { id: string }) => candidate.id === "client-marketing-ops"
    );
    const key = client?.keys.find((candidate: { id: string }) => candidate.id === "key-marketing-primary");

    expect(connection).toBeDefined();
    expect(connection.status).not.toBe("connected");
    expect(client).toBeDefined();
    expect(key).toBeDefined();

    const testRes = await request(app).post(`/admin/api/connections/${lifecycleConnectionId}/test`).send({});
    expect(testRes.status).toBe(200);
    expect(testRes.body.connection).toMatchObject({ id: lifecycleConnectionId, status: "connected" });
    expect(testRes.body.connection.lastTestedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(testRes.body.state.auditEvents[0]).toMatchObject({
      action: "connection.tested",
      targetId: lifecycleConnectionId
    });

    const rotateRes = await request(app)
      .post("/admin/api/api-clients/client-marketing-ops/keys/key-marketing-primary/rotate")
      .send({});
    expect(rotateRes.status).toBe(200);
    expect(rotateRes.body.key).toMatchObject({ id: "key-marketing-primary", status: "active" });
    expect(rotateRes.body.key.preview).not.toBe(key.preview);

    const revokeRes = await request(app)
      .post("/admin/api/api-clients/client-marketing-ops/keys/key-marketing-primary/revoke")
      .send({});
    expect(revokeRes.status).toBe(200);
    expect(revokeRes.body.key).toMatchObject({ id: "key-marketing-primary", status: "revoked" });
    expect(
      revokeRes.body.state.auditEvents
        .slice(0, 3)
        .map((event: { action: string; targetId: string }) => ({ action: event.action, targetId: event.targetId }))
    ).toEqual([
      { action: "api_key.revoked", targetId: "key-marketing-primary" },
      { action: "api_key.rotated", targetId: "key-marketing-primary" },
      { action: "connection.tested", targetId: lifecycleConnectionId }
    ]);
  });

  it("returns 400 JSON for backend validation errors instead of 500", async () => {
    const { app } = buildAdminApp();

    const duplicateBrand = await request(app).post("/admin/api/brands").send({
      name: "Duplicate Haverford",
      slug: "haverford"
    });
    const badConnection = await request(app).post("/admin/api/regions/region_haverford_au/connections").send({
      brandId: "brand_haverford",
      connectorId: "connector_shopify",
      backendType: "nango",
      displayName: "Missing Shopify Secret",
      configSummary: ["not", "an", "object"]
    });

    expect(duplicateBrand.status).toBe(400);
    expect(duplicateBrand.headers["content-type"]).toContain("application/json");
    expect(duplicateBrand.body).toEqual({ error: "Duplicate brand slug: haverford" });
    expect(badConnection.status).toBe(400);
    expect(badConnection.headers["content-type"]).toContain("application/json");
    expect(badConnection.body.error).toMatch(/configSummary|requires/);
  });

  it("returns 400 JSON when patching a connection with a non-object configSummary", async () => {
    const { app } = buildAdminApp();

    const res = await request(app).patch("/admin/api/connections/connection_haverford_au_outlook").send({
      configSummary: ["not", "an", "object"]
    });

    expect(res.status).toBe(400);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.body).toEqual({ error: "configSummary must be an object" });
  });

  it("returns 400 JSON when patching a connection with raw secret-like config keys", async () => {
    const { app } = buildAdminApp();
    const rawSecret = "route-raw-api-key";

    const res = await request(app).patch("/admin/api/connections/connection_haverford_au_outlook").send({
      configSummary: { api_key: rawSecret }
    });

    expect(res.status).toBe(400);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.body).toEqual({ error: "Unsafe config field: api_key" });

    const freshState = await request(app).get("/admin/api/state");
    expect(JSON.stringify(freshState.body)).not.toContain(rawSecret);
  });
});
