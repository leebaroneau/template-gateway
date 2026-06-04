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

const allReadScopes: GatewayApiScope[] = ["brands.read", "regions.read", "connectors.read", "connections.read"];

const stores: GatewayAccessStore[] = [];
const tempDirs: string[] = [];

function tempStorePath(): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-api-routes-"));
  tempDirs.push(tempDir);
  return path.join(tempDir, "gateway.sqlite");
}

function openStore(): GatewayAccessStore {
  const store = new GatewayAccessStore(tempStorePath());
  stores.push(store);
  return store;
}

function appWithStore(store: GatewayAccessStore, backend = new FixtureGatewayBackend()) {
  const app = express();
  app.disable("x-powered-by");
  app.use("/api/v1", createGatewayApiRouter({ backend, accessStore: store }));
  return app;
}

function createApiCredential(store: GatewayAccessStore, scopes: GatewayApiScope[] = allReadScopes) {
  const client = store.createClient(
    { name: "Test Client", type: "service", owner: "test-owner", scopes },
    "test-admin"
  );
  const created = store.createKey(client.id, { label: "primary" }, "test-admin");
  return { client, key: created.key, secret: created.secret };
}

afterEach(() => {
  while (stores.length > 0) {
    stores.pop()?.close();
  }
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop() ?? "", { recursive: true, force: true });
  }
});

describe("/api/v1 gateway API routes", () => {
  it("exposes only version health without authentication", async () => {
    const res = await request(appWithStore(openStore())).get("/api/v1/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", version: "v1" });
    expect(JSON.stringify(res.body)).not.toContain("brand_haverford");
  });

  it("requires authentication for metadata routes", async () => {
    const store = openStore();

    const res = await request(appWithStore(store)).get("/api/v1/brands");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: "unauthorized", message: "Missing bearer token" } });
    expect(store.listAuditEvents()[0]).toMatchObject({
      action: "api_auth.failed",
      targetType: "api_client",
      targetId: "unknown",
      actor: "anonymous",
      metadata: { route: "/api/v1/brands", method: "GET", reason: "missing_bearer" }
    });
  });

  it("returns authenticated client details from /me without raw secrets", async () => {
    const store = openStore();
    const { client, key, secret } = createApiCredential(store, ["brands.read"]);

    const res = await request(appWithStore(store)).get("/api/v1/me").set("Authorization", `Bearer ${secret}`);

    expect(res.status).toBe(200);
    expect(res.body.client).toEqual(
      expect.objectContaining({ id: client.id, name: "Test Client", owner: "test-owner", scopes: ["brands.read"] })
    );
    expect(res.body.key).toEqual(
      expect.objectContaining({ id: key.id, label: "primary", preview: expect.stringMatching(/^gw_live_\.\.\./) })
    );
    expect(res.body.key).not.toHaveProperty("secret");
    expect(JSON.stringify(res.body)).not.toContain(secret);
  });

  it("allows scoped brand reads", async () => {
    const store = openStore();
    const { secret } = createApiCredential(store, ["brands.read"]);

    const res = await request(appWithStore(store)).get("/api/v1/brands").set("Authorization", `Bearer ${secret}`);

    expect(res.status).toBe(200);
    expect(res.body.brands).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "brand_haverford", slug: "haverford" })])
    );
  });

  it("denies reads without the required scope", async () => {
    const store = openStore();
    const { secret } = createApiCredential(store, ["brands.read"]);

    const res = await request(appWithStore(store)).get("/api/v1/connections").set("Authorization", `Bearer ${secret}`);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: { code: "forbidden", message: "Missing required scope: connections.read" }
    });
    expect(store.listAuditEvents()[0]).toMatchObject({
      action: "api_scope.denied",
      metadata: { route: "/api/v1/connections", method: "GET", requiredScope: "connections.read" }
    });
  });

  it("returns 404 structured errors for unknown resource ids", async () => {
    const store = openStore();
    const { secret } = createApiCredential(store, ["brands.read"]);

    const res = await request(appWithStore(store)).get("/api/v1/brands/missing").set("Authorization", `Bearer ${secret}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: "not_found", message: "Brand not found: missing" } });
    expect(store.listApiClients()[0]).toMatchObject({ requestCount24h: 1, errorRate24h: 1 });
    expect(store.listAuditEvents()[0]).toMatchObject({
      action: "api_read.failed",
      metadata: {
        route: "/api/v1/brands/missing",
        method: "GET",
        statusCode: "404",
        requiredScope: "brands.read"
      }
    });
  });

  it("persists usage and audit records for API reads", async () => {
    const store = openStore();
    const { key, secret } = createApiCredential(store, ["brands.read"]);

    await request(appWithStore(store)).get("/api/v1/brands").set("Authorization", `Bearer ${secret}`).expect(200);

    const client = store.listApiClients()[0];
    expect(client.requestCount24h).toBe(1);
    expect(client.errorRate24h).toBe(0);
    expect(store.listAuditEvents()[0]).toMatchObject({
      action: "api_read.succeeded",
      metadata: {
        route: "/api/v1/brands",
        method: "GET",
        statusCode: "200",
        requiredScope: "brands.read",
        fingerprint: key.fingerprint
      }
    });
    expect(JSON.stringify(store.listAuditEvents())).not.toContain(secret);
  });

  it("exposes the read-only metadata route surface with matching scopes", async () => {
    const store = openStore();
    const { secret } = createApiCredential(store);
    const app = appWithStore(store);
    const auth = { Authorization: `Bearer ${secret}` };

    await request(app)
      .get("/api/v1/brands/brand_haverford")
      .set(auth)
      .expect(200)
      .expect((res) => expect(res.body.brand).toMatchObject({ id: "brand_haverford" }));
    await request(app)
      .get("/api/v1/brands/brand_haverford/regions")
      .set(auth)
      .expect(200)
      .expect((res) => expect(res.body.regions[0]).toMatchObject({ brandId: "brand_haverford" }));
    await request(app)
      .get("/api/v1/regions/region_haverford_au")
      .set(auth)
      .expect(200)
      .expect((res) => expect(res.body.region).toMatchObject({ id: "region_haverford_au" }));
    await request(app)
      .get("/api/v1/regions/region_haverford_au/connections")
      .set(auth)
      .expect(200)
      .expect((res) => expect(res.body.connections[0]).toMatchObject({ regionId: "region_haverford_au" }));
    await request(app)
      .get("/api/v1/connectors")
      .set(auth)
      .expect(200)
      .expect((res) => expect(res.body.connectors.length).toBeGreaterThan(0));
    await request(app)
      .get("/api/v1/connectors/connector_shopify")
      .set(auth)
      .expect(200)
      .expect((res) => expect(res.body.connector).toMatchObject({ id: "connector_shopify" }));
    await request(app)
      .get("/api/v1/connections")
      .set(auth)
      .expect(200)
      .expect((res) => expect(res.body.connections.length).toBeGreaterThan(0));
    await request(app)
      .get("/api/v1/connections/connection_haverford_au_shopify")
      .set(auth)
      .expect(200)
      .expect((res) => expect(res.body.connection).toMatchObject({ id: "connection_haverford_au_shopify" }));
  });
});
