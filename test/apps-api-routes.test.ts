import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { GatewayAccessStore } from "../src/access/store.js";
import type { GatewayApiScope } from "../src/access/types.js";
import { FixtureGatewayBackend } from "../src/admin/fixture-backend.js";
import { createGatewayApiRouter } from "../src/api/routes.js";
import { BUILT_IN_APPS } from "../src/apps/catalog.js";
import { GatewayAppInstallStore } from "../src/apps/store.js";
import { GatewayShopifyStore } from "../src/shopify-oauth/store.js";

// ── Cleanup tracking ──────────────────────────────────────────────────────────

const stores: Array<{ close(): void }> = [];
const tempDirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-apps-api-routes-"));
  tempDirs.push(dir);
  return dir;
}

function openAccessStore(): GatewayAccessStore {
  const dir = tempDir();
  const store = new GatewayAccessStore(path.join(dir, "access.sqlite"));
  stores.push(store);
  return store;
}

function openInstallStore(): GatewayAppInstallStore {
  const dir = tempDir();
  const store = new GatewayAppInstallStore(path.join(dir, "installs.sqlite"));
  stores.push(store);
  return store;
}

function openShopifyStore(): GatewayShopifyStore {
  const dir = tempDir();
  const store = new GatewayShopifyStore(path.join(dir, "shopify.sqlite"));
  stores.push(store);
  return store;
}

afterEach(() => {
  while (stores.length > 0) stores.pop()?.close();
  while (tempDirs.length > 0) fs.rmSync(tempDirs.pop() ?? "", { recursive: true, force: true });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildApp(
  accessStore: GatewayAccessStore,
  appInstallStore: GatewayAppInstallStore,
  backend = new FixtureGatewayBackend(),
  shopifyStore?: GatewayShopifyStore
) {
  const app = express();
  app.disable("x-powered-by");
  app.use(
    "/api/v1",
    createGatewayApiRouter({ backend, accessStore, appInstallStore, shopifyStore })
  );
  return app;
}

function createApiCredential(
  store: GatewayAccessStore,
  scopes: GatewayApiScope[] = ["apps.read", "apps.write"]
) {
  const client = store.createClient(
    { name: "Test Client", type: "service", owner: "test-owner", scopes },
    "test-admin"
  );
  const created = store.createKey(client.id, { label: "primary" }, "test-admin");
  return { client, key: created.key, secret: created.secret };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("/api/v1 app catalog + install routes", () => {
  describe("GET /apps", () => {
    it("returns 200 with BUILT_IN_APPS when authenticated with apps.read scope", async () => {
      const accessStore = openAccessStore();
      const installStore = openInstallStore();
      const { secret } = createApiCredential(accessStore, ["apps.read"]);
      const app = buildApp(accessStore, installStore);

      const res = await request(app).get("/api/v1/apps").set("Authorization", `Bearer ${secret}`);

      expect(res.status).toBe(200);
      expect(res.body.apps).toEqual(BUILT_IN_APPS);
      expect(res.body.apps[0]).toMatchObject({ slug: "haverford-storefront" });
    });

    it("returns 401 when no bearer token is provided", async () => {
      const accessStore = openAccessStore();
      const installStore = openInstallStore();
      const app = buildApp(accessStore, installStore);

      const res = await request(app).get("/api/v1/apps");

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: { code: "unauthorized", message: "Missing bearer token" } });
    });

    it("returns 403 when authenticated but missing apps.read scope", async () => {
      const accessStore = openAccessStore();
      const installStore = openInstallStore();
      const { secret } = createApiCredential(accessStore, ["brands.read"]);
      const app = buildApp(accessStore, installStore);

      const res = await request(app).get("/api/v1/apps").set("Authorization", `Bearer ${secret}`);

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: { code: "forbidden", message: "Missing required scope: apps.read" } });
    });
  });

  describe("GET /app-installs", () => {
    it("returns empty installs array when no installs exist", async () => {
      const accessStore = openAccessStore();
      const installStore = openInstallStore();
      const { secret } = createApiCredential(accessStore, ["apps.read"]);
      const app = buildApp(accessStore, installStore);

      const res = await request(app).get("/api/v1/app-installs").set("Authorization", `Bearer ${secret}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ installs: [] });
    });

    it("returns all installs when some exist", async () => {
      const accessStore = openAccessStore();
      const installStore = openInstallStore();
      installStore.createInstall({ appSlug: "haverford-storefront", brandId: "brand_a", regionId: "region_a" });
      installStore.createInstall({ appSlug: "haverford-storefront", brandId: "brand_b", regionId: "region_b" });
      const { secret } = createApiCredential(accessStore, ["apps.read"]);
      const app = buildApp(accessStore, installStore);

      const res = await request(app).get("/api/v1/app-installs").set("Authorization", `Bearer ${secret}`);

      expect(res.status).toBe(200);
      expect(res.body.installs).toHaveLength(2);
    });

    it("filters installs by appSlug query param", async () => {
      const accessStore = openAccessStore();
      const installStore = openInstallStore();
      installStore.createInstall({ appSlug: "haverford-storefront", brandId: "brand_a", regionId: "region_a" });
      const { secret } = createApiCredential(accessStore, ["apps.read"]);
      const app = buildApp(accessStore, installStore);

      const res = await request(app)
        .get("/api/v1/app-installs?appSlug=haverford-storefront")
        .set("Authorization", `Bearer ${secret}`);

      expect(res.status).toBe(200);
      expect(res.body.installs).toHaveLength(1);
      expect(res.body.installs[0].appSlug).toBe("haverford-storefront");
    });

    it("returns 401 when no bearer token is provided", async () => {
      const accessStore = openAccessStore();
      const installStore = openInstallStore();
      const app = buildApp(accessStore, installStore);

      const res = await request(app).get("/api/v1/app-installs");

      expect(res.status).toBe(401);
    });
  });

  describe("GET /app-installs/:id", () => {
    it("returns the install when it exists", async () => {
      const accessStore = openAccessStore();
      const installStore = openInstallStore();
      const created = installStore.createInstall({
        appSlug: "haverford-storefront",
        brandId: "brand_a",
        regionId: "region_a"
      });
      const { secret } = createApiCredential(accessStore, ["apps.read"]);
      const app = buildApp(accessStore, installStore);

      const res = await request(app)
        .get(`/api/v1/app-installs/${created.id}`)
        .set("Authorization", `Bearer ${secret}`);

      expect(res.status).toBe(200);
      expect(res.body.install).toMatchObject({
        id: created.id,
        appSlug: "haverford-storefront",
        brandId: "brand_a",
        regionId: "region_a",
        status: "pending"
      });
    });

    it("returns 404 when the install does not exist", async () => {
      const accessStore = openAccessStore();
      const installStore = openInstallStore();
      const { secret } = createApiCredential(accessStore, ["apps.read"]);
      const app = buildApp(accessStore, installStore);

      const res = await request(app)
        .get("/api/v1/app-installs/nonexistent_id")
        .set("Authorization", `Bearer ${secret}`);

      expect(res.status).toBe(404);
      expect(res.body).toEqual({
        error: { code: "not_found", message: "App install not found: nonexistent_id" }
      });
    });
  });

  describe("POST /app-installs", () => {
    it("creates a new install and returns 201", async () => {
      const accessStore = openAccessStore();
      const installStore = openInstallStore();
      const { secret } = createApiCredential(accessStore, ["apps.write"]);
      const app = buildApp(accessStore, installStore);

      const res = await request(app)
        .post("/api/v1/app-installs")
        .set("Authorization", `Bearer ${secret}`)
        .send({ appSlug: "haverford-storefront", brandId: "brand_a", regionId: "region_a" });

      expect(res.status).toBe(201);
      expect(res.body.install).toMatchObject({
        appSlug: "haverford-storefront",
        brandId: "brand_a",
        regionId: "region_a",
        status: "pending"
      });
      expect(typeof res.body.install.id).toBe("string");
    });

    it("creates an install with an optional connectionId", async () => {
      const accessStore = openAccessStore();
      const installStore = openInstallStore();
      const { secret } = createApiCredential(accessStore, ["apps.write"]);
      const app = buildApp(accessStore, installStore);

      const res = await request(app)
        .post("/api/v1/app-installs")
        .set("Authorization", `Bearer ${secret}`)
        .send({
          appSlug: "haverford-storefront",
          brandId: "brand_a",
          regionId: "region_a",
          connectionId: "conn_123"
        });

      expect(res.status).toBe(201);
      expect(res.body.install.connectionId).toBe("conn_123");
    });

    it("returns 400 for an unknown appSlug", async () => {
      const accessStore = openAccessStore();
      const installStore = openInstallStore();
      const { secret } = createApiCredential(accessStore, ["apps.write"]);
      const app = buildApp(accessStore, installStore);

      const res = await request(app)
        .post("/api/v1/app-installs")
        .set("Authorization", `Bearer ${secret}`)
        .send({ appSlug: "unknown-app", brandId: "brand_a", regionId: "region_a" });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: { code: "invalid_request", message: "Unknown app slug: unknown-app" }
      });
    });

    it("returns 400 when required fields are missing", async () => {
      const accessStore = openAccessStore();
      const installStore = openInstallStore();
      const { secret } = createApiCredential(accessStore, ["apps.write"]);
      const app = buildApp(accessStore, installStore);

      const res = await request(app)
        .post("/api/v1/app-installs")
        .set("Authorization", `Bearer ${secret}`)
        .send({ appSlug: "haverford-storefront" });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("invalid_request");
    });

    it("returns 401 when no bearer token is provided", async () => {
      const accessStore = openAccessStore();
      const installStore = openInstallStore();
      const app = buildApp(accessStore, installStore);

      const res = await request(app)
        .post("/api/v1/app-installs")
        .send({ appSlug: "haverford-storefront", brandId: "brand_a", regionId: "region_a" });

      expect(res.status).toBe(401);
    });

    it("returns 403 when authenticated but missing apps.write scope", async () => {
      const accessStore = openAccessStore();
      const installStore = openInstallStore();
      const { secret } = createApiCredential(accessStore, ["apps.read"]);
      const app = buildApp(accessStore, installStore);

      const res = await request(app)
        .post("/api/v1/app-installs")
        .set("Authorization", `Bearer ${secret}`)
        .send({ appSlug: "haverford-storefront", brandId: "brand_a", regionId: "region_a" });

      expect(res.status).toBe(403);
    });
  });

  describe("PATCH /app-installs/:id/status", () => {
    it("updates the install status and returns 200", async () => {
      const accessStore = openAccessStore();
      const installStore = openInstallStore();
      const created = installStore.createInstall({
        appSlug: "haverford-storefront",
        brandId: "brand_a",
        regionId: "region_a"
      });
      const { secret } = createApiCredential(accessStore, ["apps.write"]);
      const app = buildApp(accessStore, installStore);

      const res = await request(app)
        .patch(`/api/v1/app-installs/${created.id}/status`)
        .set("Authorization", `Bearer ${secret}`)
        .send({ status: "enabled" });

      expect(res.status).toBe(200);
      expect(res.body.install).toMatchObject({ id: created.id, status: "enabled" });
    });

    it("updates status to error with an errorDetail", async () => {
      const accessStore = openAccessStore();
      const installStore = openInstallStore();
      const created = installStore.createInstall({
        appSlug: "haverford-storefront",
        brandId: "brand_a",
        regionId: "region_a"
      });
      const { secret } = createApiCredential(accessStore, ["apps.write"]);
      const app = buildApp(accessStore, installStore);

      const res = await request(app)
        .patch(`/api/v1/app-installs/${created.id}/status`)
        .set("Authorization", `Bearer ${secret}`)
        .send({ status: "error", errorDetail: "Connection timed out" });

      expect(res.status).toBe(200);
      expect(res.body.install).toMatchObject({ status: "error", errorDetail: "Connection timed out" });
    });

    it("returns 400 for an invalid status value", async () => {
      const accessStore = openAccessStore();
      const installStore = openInstallStore();
      const created = installStore.createInstall({
        appSlug: "haverford-storefront",
        brandId: "brand_a",
        regionId: "region_a"
      });
      const { secret } = createApiCredential(accessStore, ["apps.write"]);
      const app = buildApp(accessStore, installStore);

      const res = await request(app)
        .patch(`/api/v1/app-installs/${created.id}/status`)
        .set("Authorization", `Bearer ${secret}`)
        .send({ status: "flying" });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("invalid_request");
    });

    it("returns 404 when the install does not exist", async () => {
      const accessStore = openAccessStore();
      const installStore = openInstallStore();
      const { secret } = createApiCredential(accessStore, ["apps.write"]);
      const app = buildApp(accessStore, installStore);

      const res = await request(app)
        .patch("/api/v1/app-installs/nonexistent/status")
        .set("Authorization", `Bearer ${secret}`)
        .send({ status: "enabled" });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("not_found");
    });
  });

  describe("POST /app-installs/provision", () => {
    it("returns provisioned=0 and empty installs when no shopifyStore is provided", async () => {
      const accessStore = openAccessStore();
      const installStore = openInstallStore();
      const { secret } = createApiCredential(accessStore, ["apps.write"]);
      // Build app WITHOUT shopifyStore
      const app = buildApp(accessStore, installStore);

      const res = await request(app)
        .post("/api/v1/app-installs/provision")
        .set("Authorization", `Bearer ${secret}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ provisioned: 0, installs: [] });
    });

    it("provisions installs for connected Shopify credentials matching fixture connections", async () => {
      const accessStore = openAccessStore();
      const installStore = openInstallStore();
      const shopifyStore = openShopifyStore();

      // The fixture backend has a connection: connection_haverford_au_shopify
      // with configSummary.shop_domain = "haverford-au.myshopify.com"
      // Add a connected credential for that shop
      shopifyStore.saveCredential({
        shop: "haverford-au.myshopify.com",
        encryptedPayload: "encrypted_test_payload",
        scope: "orders:read",
        status: "connected"
      });

      const { secret } = createApiCredential(accessStore, ["apps.write"]);
      const backend = new FixtureGatewayBackend();
      const app = buildApp(accessStore, installStore, backend, shopifyStore);

      const res = await request(app)
        .post("/api/v1/app-installs/provision")
        .set("Authorization", `Bearer ${secret}`);

      expect(res.status).toBe(200);
      expect(res.body.provisioned).toBe(1);
      expect(res.body.installs).toHaveLength(1);
      expect(res.body.installs[0]).toMatchObject({
        appSlug: "haverford-storefront",
        brandId: "brand_haverford",
        regionId: "region_haverford_au",
        status: "pending"
      });

      // Verify it was persisted to the store
      const persisted = installStore.listInstalls();
      expect(persisted).toHaveLength(1);
      expect(persisted[0].appSlug).toBe("haverford-storefront");
    });

    it("skips credentials with non-connected status", async () => {
      const accessStore = openAccessStore();
      const installStore = openInstallStore();
      const shopifyStore = openShopifyStore();

      shopifyStore.saveCredential({
        shop: "haverford-au.myshopify.com",
        encryptedPayload: "encrypted_test_payload",
        scope: "orders:read",
        status: "needs_reconnect"
      });

      const { secret } = createApiCredential(accessStore, ["apps.write"]);
      const app = buildApp(accessStore, installStore, new FixtureGatewayBackend(), shopifyStore);

      const res = await request(app)
        .post("/api/v1/app-installs/provision")
        .set("Authorization", `Bearer ${secret}`);

      expect(res.status).toBe(200);
      expect(res.body.provisioned).toBe(0);
    });

    it("skips credentials with no matching Shopify connection in state", async () => {
      const accessStore = openAccessStore();
      const installStore = openInstallStore();
      const shopifyStore = openShopifyStore();

      shopifyStore.saveCredential({
        shop: "unknown-shop.myshopify.com",
        encryptedPayload: "encrypted_test_payload",
        scope: "orders:read",
        status: "connected"
      });

      const { secret } = createApiCredential(accessStore, ["apps.write"]);
      const app = buildApp(accessStore, installStore, new FixtureGatewayBackend(), shopifyStore);

      const res = await request(app)
        .post("/api/v1/app-installs/provision")
        .set("Authorization", `Bearer ${secret}`);

      expect(res.status).toBe(200);
      expect(res.body.provisioned).toBe(0);
    });

    it("returns 401 when no bearer token is provided", async () => {
      const accessStore = openAccessStore();
      const installStore = openInstallStore();
      const app = buildApp(accessStore, installStore);

      const res = await request(app).post("/api/v1/app-installs/provision");

      expect(res.status).toBe(401);
    });

    it("returns 403 when authenticated but missing apps.write scope", async () => {
      const accessStore = openAccessStore();
      const installStore = openInstallStore();
      const { secret } = createApiCredential(accessStore, ["apps.read"]);
      const app = buildApp(accessStore, installStore);

      const res = await request(app)
        .post("/api/v1/app-installs/provision")
        .set("Authorization", `Bearer ${secret}`);

      expect(res.status).toBe(403);
    });
  });

  describe("apps.write scope also grants apps.read (scopeAllowed hierarchy)", () => {
    it("GET /apps succeeds with only apps.write scope", async () => {
      const accessStore = openAccessStore();
      const installStore = openInstallStore();
      const { secret } = createApiCredential(accessStore, ["apps.write"]);
      const app = buildApp(accessStore, installStore);

      const res = await request(app).get("/api/v1/apps").set("Authorization", `Bearer ${secret}`);

      expect(res.status).toBe(200);
    });
  });
});
