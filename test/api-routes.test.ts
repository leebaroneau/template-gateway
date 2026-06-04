import express from "express";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  return openStoreAt(tempStorePath());
}

function openStoreAt(dbPath: string): GatewayAccessStore {
  const store = new GatewayAccessStore(dbPath);
  stores.push(store);
  return store;
}

function latestUsageRoute(dbPath: string): string {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const row = db
      .prepare("SELECT route FROM gateway_api_usage ORDER BY occurred_at DESC, rowid DESC LIMIT 1")
      .get() as { route: string } | undefined;
    if (row === undefined) {
      throw new Error("Expected a gateway API usage row");
    }
    return row.route;
  } finally {
    db.close();
  }
}

class ThrowingSnapshotBackend extends FixtureGatewayBackend {
  override snapshot(): never {
    throw new Error("backend snapshot exploded with access_token=leak");
  }
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
    expect(store.listApiClients()[0]).toMatchObject({ requestCount24h: 1, errorRate24h: 1 });
    expect(store.listAuditEvents()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "api_scope.denied",
          metadata: expect.objectContaining({
            route: "/api/v1/connections",
            method: "GET",
            requiredScope: "connections.read"
          })
        }),
        expect.objectContaining({
          action: "api_read.failed",
          metadata: expect.objectContaining({
            route: "/api/v1/connections",
            method: "GET",
            statusCode: "403",
            requiredScope: "connections.read"
          })
        })
      ])
    );
    expect(store.listAuditEvents().find((event) => event.action === "api_scope.denied")).toMatchObject({
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

  it("returns structured 404s for authenticated unknown gateway API routes", async () => {
    const store = openStore();
    const { secret } = createApiCredential(store, ["brands.read"]);

    const res = await request(appWithStore(store))
      .get("/api/v1/unknown")
      .set("Authorization", `Bearer ${secret}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: "not_found", message: "Gateway API route not found: GET /api/v1/unknown" }
    });
    expect(store.listApiClients()[0]).toMatchObject({ requestCount24h: 1, errorRate24h: 1 });
    expect(store.listAuditEvents()[0]).toMatchObject({
      action: "api_read.failed",
      metadata: {
        route: "/api/v1/unknown",
        method: "GET",
        statusCode: "404",
        requiredScope: ""
      }
    });
  });

  it("requires authentication before returning unknown gateway API route 404s", async () => {
    const store = openStore();

    const res = await request(appWithStore(store)).get("/api/v1/unknown");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: "unauthorized", message: "Missing bearer token" } });
    expect(store.listAuditEvents()[0]).toMatchObject({
      action: "api_auth.failed",
      metadata: { route: "/api/v1/unknown", method: "GET", reason: "missing_bearer" }
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

  it("persists query-free paths in usage and audit records", async () => {
    const dbPath = tempStorePath();
    const store = openStoreAt(dbPath);
    const { secret } = createApiCredential(store, ["brands.read"]);

    await request(appWithStore(store))
      .get("/api/v1/brands?api_key=leak&access_token=leak")
      .set("Authorization", `Bearer ${secret}`)
      .expect(200);

    expect(latestUsageRoute(dbPath)).toBe("/api/v1/brands");

    const requestAuditRecords = store
      .listAuditEvents()
      .filter((event) => event.action === "api_auth.succeeded" || event.action === "api_read.succeeded")
      .map((event) => ({ detail: event.detail, metadata: event.metadata }));
    expect(requestAuditRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ metadata: expect.objectContaining({ route: "/api/v1/brands" }) })
      ])
    );
    const serializedAuditRecords = JSON.stringify(requestAuditRecords);
    expect(serializedAuditRecords).not.toContain("api_key");
    expect(serializedAuditRecords).not.toContain("access_token");
    expect(serializedAuditRecords).not.toContain("leak");
  });

  it("returns generic 500 responses for internal backend errors", async () => {
    const store = openStore();
    const { secret } = createApiCredential(store, ["brands.read"]);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const res = await request(appWithStore(store, new ThrowingSnapshotBackend()))
        .get("/api/v1/brands")
        .set("Authorization", `Bearer ${secret}`);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({
        error: { code: "internal_error", message: "Internal gateway API error" }
      });
      expect(JSON.stringify(res.body)).not.toContain("backend snapshot exploded");
      expect(JSON.stringify(res.body)).not.toContain("access_token");
      expect(consoleError).toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
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
