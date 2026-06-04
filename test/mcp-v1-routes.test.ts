import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
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

  it("allows tools/list with granular read scopes so clients can discover allowed tools", async () => {
    const store = openStore();
    const { secret } = credential(store, ["brands.read"]);

    const res = await request(appWithStore(store))
      .post("/mcp/v1")
      .set("Authorization", `Bearer ${secret}`)
      .send(rpc("tools/list"));

    expect(res.status).toBe(200);
    expect(res.body.result.tools.map((tool: { name: string }) => tool.name)).toContain("gateway_list_brands");
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

  it("returns JSON-RPC errors for bad protocol shape, unknown methods, and invalid params", async () => {
    const store = openStore();
    const { secret } = credential(store, ["mcp.read"]);
    const app = appWithStore(store);

    const invalid = await request(app).post("/mcp/v1").set("Authorization", `Bearer ${secret}`).send({ method: 1 });
    const missing = await request(app).post("/mcp/v1").set("Authorization", `Bearer ${secret}`).send(rpc("missing"));
    const invalidParams = await request(app)
      .post("/mcp/v1")
      .set("Authorization", `Bearer ${secret}`)
      .send(rpc("tools/call", { name: 1 }));

    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toMatchObject({ code: -32600 });
    expect(missing.status).toBe(200);
    expect(missing.body.error).toMatchObject({ code: -32601 });
    expect(invalidParams.status).toBe(200);
    expect(invalidParams.body.error).toMatchObject({ code: -32602 });
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
    expect(res.body.result).toMatchObject({
      isError: true,
      content: [{ type: "text", text: "Connection not found: missing" }]
    });
    expect(store.listAuditEvents()).toEqual(
      expect.arrayContaining([expect.objectContaining({ action: "mcp_tool.failed" })])
    );
  });
});
