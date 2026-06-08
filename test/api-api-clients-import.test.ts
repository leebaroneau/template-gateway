import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GatewayAccessStore } from "../src/access/store.js";
import type { GatewayApiScope } from "../src/access/types.js";
import { FixtureGatewayBackend } from "../src/admin/fixture-backend.js";
import { createGatewayApiRouter } from "../src/api/routes.js";

let tempDir: string;
let store: GatewayAccessStore;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-api-clients-import-"));
  store = new GatewayAccessStore(path.join(tempDir, "gateway.sqlite"));
});

afterEach(() => {
  store.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function app() {
  const expressApp = express();
  expressApp.use("/api/v1", createGatewayApiRouter({ backend: new FixtureGatewayBackend(), accessStore: store }));
  return expressApp;
}

function credential(scopes: GatewayApiScope[]) {
  const client = store.createClient({ name: "Caller", type: "service", owner: "test", scopes }, "test");
  return store.createKey(client.id, { label: scopes.join("-") }, "test").secret;
}

function body() {
  return {
    apps: [
      {
        key: "quatra-ops",
        name: "Quatra Ops Sync",
        type: "service",
        owner: "quatra-ops",
        scopes: ["brands.read", "connections.read"]
      }
    ]
  };
}

describe("/api/v1/api-clients import routes", () => {
  it("enforces auth and write scope on import", async () => {
    const readOnly = credential(["api_clients.read"]);
    const client = app();

    await request(client).post("/api/v1/api-clients/import").send(body()).expect(401);
    await request(client)
      .post("/api/v1/api-clients/import")
      .set("Authorization", `Bearer ${readOnly}`)
      .send(body())
      .expect(403);
  });

  it("creates imported clients and skips idempotent re-imports", async () => {
    const secret = credential(["api_clients.write"]);
    const client = app();

    const created = await request(client)
      .post("/api/v1/api-clients/import")
      .set("Authorization", `Bearer ${secret}`)
      .send(body())
      .expect(201);

    expect(created.body.imported).toHaveLength(1);
    expect(created.body.imported[0]).toMatchObject({
      manifestKey: "quatra-ops",
      action: "created",
      client: { owner: "dev-api:quatra-ops", scopes: ["brands.read", "connections.read"] },
      key: { label: expect.stringMatching(/^dev-api-import-\d{4}-\d{2}-\d{2}$/) },
      secret: expect.stringMatching(/^gw_live_/)
    });

    const skipped = await request(client)
      .post("/api/v1/api-clients/import")
      .set("Authorization", `Bearer ${secret}`)
      .send(body())
      .expect(201);

    expect(skipped.body.imported).toEqual([]);
    expect(skipped.body.skipped).toEqual([{ manifestKey: "quatra-ops", reason: "exists" }]);
    expect(store.listApiClients().filter((apiClient) => apiClient.owner === "dev-api:quatra-ops")).toHaveLength(1);
  });

  it("rotates existing imported clients by issuing a new key", async () => {
    const secret = credential(["api_clients.write"]);
    const client = app();

    await request(client).post("/api/v1/api-clients/import").set("Authorization", `Bearer ${secret}`).send(body()).expect(201);
    const rotated = await request(client)
      .post("/api/v1/api-clients/import")
      .set("Authorization", `Bearer ${secret}`)
      .send({ ...body(), rotate: true })
      .expect(201);

    expect(rotated.body.imported[0]).toMatchObject({ manifestKey: "quatra-ops", action: "rotated" });
    expect(rotated.body.imported[0].secret).toMatch(/^gw_live_/);
    expect(store.listApiClients().find((apiClient) => apiClient.owner === "dev-api:quatra-ops")?.keys).toHaveLength(2);
  });

  it("wraps revoked-client rotation conflicts as gateway api errors", async () => {
    const secret = credential(["api_clients.write"]);
    const imported = store.createClient(
      { name: "Quatra Ops Sync", type: "service", owner: "dev-api:quatra-ops", scopes: ["brands.read"] },
      "test"
    );
    store.updateClient(imported.id, { status: "revoked" }, "test");

    const res = await request(app())
      .post("/api/v1/api-clients/import")
      .set("Authorization", `Bearer ${secret}`)
      .send({ ...body(), rotate: true })
      .expect(409);

    expect(res.body.error.code).toBe("invalid_request");
  });

  it("rejects invalid scopes before writing clients", async () => {
    const secret = credential(["api_clients.write"]);

    await request(app())
      .post("/api/v1/api-clients/import")
      .set("Authorization", `Bearer ${secret}`)
      .send({ apps: [{ key: "bad", name: "Bad", type: "service", owner: "bad", scopes: ["apps.delete"] }] })
      .expect(400);

    expect(store.listApiClients().filter((apiClient) => apiClient.owner === "dev-api:bad")).toHaveLength(0);
  });

  it("lists api clients with an optional owner prefix filter", async () => {
    const secret = credential(["api_clients.read"]);
    store.createClient(
      { name: "Quatra Ops Sync", type: "service", owner: "dev-api:quatra-ops", scopes: ["brands.read"] },
      "test"
    );
    store.createClient({ name: "Unrelated", type: "service", owner: "ops", scopes: ["brands.read"] }, "test");

    await request(app()).get("/api/v1/api-clients?owner_prefix=dev-api:").expect(401);
    const res = await request(app())
      .get("/api/v1/api-clients?owner_prefix=dev-api:")
      .set("Authorization", `Bearer ${secret}`)
      .expect(200);

    expect(res.body.apiClients).toHaveLength(1);
    expect(res.body.apiClients[0]).toMatchObject({ owner: "dev-api:quatra-ops" });
  });
});
