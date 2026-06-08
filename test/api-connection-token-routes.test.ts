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
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-api-connection-token-routes-"));
  store = new GatewayAccessStore(path.join(tempDir, "gateway.sqlite"));
});

afterEach(() => {
  store.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function app() {
  const expressApp = express();
  expressApp.use(
    "/api/v1",
    createGatewayApiRouter({
      backend: new FixtureGatewayBackend(),
      accessStore: store,
      mcpConnectionBaseUrl: "https://Gateway.Haverford.au"
    })
  );
  return expressApp;
}

function credential(scopes: GatewayApiScope[]) {
  const client = store.createClient({ name: "API Client", type: "service", owner: "test", scopes }, "test");
  return store.createKey(client.id, { label: scopes.join("-") }, "test").secret;
}

describe("/api/v1 connection token routes", () => {
  it("mints, lists, rotates, and revokes connection MCP tokens", async () => {
    const secret = credential(["api_clients.write"]);
    const client = app();

    const minted = await request(client)
      .post("/api/v1/connections/connection_haverford_au_shopify/mcp-tokens")
      .set("Authorization", `Bearer ${secret}`)
      .send({ label: "agent" })
      .expect(200);

    expect(minted.body.secret).toMatch(/^gw_live_/);
    expect(minted.body.mcpUrl).toBe("https://Gateway.Haverford.au/mcp/v1/connections/connection_haverford_au_shopify");
    expect(minted.body.token).toMatchObject({ connectorSlug: "shopify", status: "active" });

    const listed = await request(client)
      .get("/api/v1/connections/connection_haverford_au_shopify/mcp-tokens")
      .set("Authorization", `Bearer ${secret}`)
      .expect(200);
    expect(listed.body.tokens).toHaveLength(1);
    expect(JSON.stringify(listed.body)).not.toContain(minted.body.secret);

    const rotated = await request(client)
      .post(`/api/v1/connections/connection_haverford_au_shopify/mcp-tokens/${minted.body.token.id}/rotate`)
      .set("Authorization", `Bearer ${secret}`)
      .expect(200);
    expect(rotated.body.secret).toMatch(/^gw_live_/);
    expect(rotated.body.secret).not.toBe(minted.body.secret);

    await request(client)
      .delete(`/api/v1/connections/connection_haverford_au_shopify/mcp-tokens/${minted.body.token.id}`)
      .set("Authorization", `Bearer ${secret}`)
      .expect(200)
      .expect((res) => expect(res.body.token.status).toBe("revoked"));
    await request(client)
      .delete(`/api/v1/connections/connection_haverford_au_shopify/mcp-tokens/${minted.body.token.id}`)
      .set("Authorization", `Bearer ${secret}`)
      .expect(200);
  });

  it("enforces auth and scopes on token-management endpoints", async () => {
    const readOnly = credential(["api_clients.read"]);
    const client = app();

    await request(client)
      .post("/api/v1/connections/connection_haverford_au_shopify/mcp-tokens")
      .send({ label: "agent" })
      .expect(401);
    await request(client)
      .post("/api/v1/connections/connection_haverford_au_shopify/mcp-tokens")
      .set("Authorization", `Bearer ${readOnly}`)
      .send({ label: "agent" })
      .expect(403);
  });

  it("rejects missing and unavailable connections", async () => {
    const secret = credential(["api_clients.write"]);
    const client = app();

    await request(client)
      .post("/api/v1/connections/missing/mcp-tokens")
      .set("Authorization", `Bearer ${secret}`)
      .send({ label: "agent" })
      .expect(404);
    await request(client)
      .post("/api/v1/connections/connection_haverford_au_outlook/mcp-tokens")
      .set("Authorization", `Bearer ${secret}`)
      .send({ label: "agent" })
      .expect(403)
      .expect((res) => expect(res.body.error.code).toBe("forbidden"));
  });
});
