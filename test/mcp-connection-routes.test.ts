import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GatewayConnectionContext } from "../src/access/connection-tokens.js";
import { GatewayAccessStore } from "../src/access/store.js";
import { FixtureGatewayBackend } from "../src/admin/fixture-backend.js";
import { GatewayAppInstallStore } from "../src/apps/store.js";
import { createGatewayConnectionMcpRouter } from "../src/mcp-v1/connection-routes.js";
import { createGatewayMcpV1Router } from "../src/mcp-v1/routes.js";

let tempDir: string;
let store: GatewayAccessStore;
let appInstallStore: GatewayAppInstallStore;

const context: GatewayConnectionContext = {
  connectionId: "connection_haverford_au_shopify",
  brandId: "brand_haverford",
  regionId: "region_haverford_au",
  connectorSlug: "shopify"
};

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-connection-routes-"));
  const dbPath = path.join(tempDir, "gateway.sqlite");
  store = new GatewayAccessStore(dbPath);
  appInstallStore = new GatewayAppInstallStore(dbPath);
});

afterEach(() => {
  appInstallStore.close();
  store.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function app() {
  const expressApp = express();
  const backend = new FixtureGatewayBackend();
  expressApp.use(
    "/mcp/v1/connections/:connectionId",
    createGatewayConnectionMcpRouter({ backend, accessStore: store, appInstallStore })
  );
  expressApp.use("/mcp/v1", createGatewayMcpV1Router({ backend, accessStore: store, appInstallStore }));
  return expressApp;
}

function rpc(method: string, params?: unknown, id: number | string | null = 1) {
  return { jsonrpc: "2.0", id, method, params };
}

describe("connection MCP routes", () => {
  it("lists only connection-scoped tools and calls connection_get for the bound connection", async () => {
    const minted = store.mintConnectionToken({ connectionId: context.connectionId, context, label: "agent", actor: "test" });
    const client = app();

    const listed = await request(client)
      .post(`/mcp/v1/connections/${context.connectionId}`)
      .set("Authorization", `Bearer ${minted.secret}`)
      .send(rpc("tools/list"));

    expect(listed.status).toBe(200);
    expect(listed.body.result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "connection_get",
      "connection_status",
      "connection_list_app_installs"
    ]);

    const called = await request(client)
      .post(`/mcp/v1/connections/${context.connectionId}`)
      .set("Authorization", `Bearer ${minted.secret}`)
      .send(rpc("tools/call", { name: "connection_get", arguments: {} }));

    expect(called.status).toBe(200);
    expect(called.body.result.structuredContent.connection).toMatchObject({ id: context.connectionId });
    expect(store.listAuditEvents()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "connection_mcp_auth.succeeded" }),
        expect.objectContaining({ action: "connection_mcp_tool.called" })
      ])
    );
  });

  it("rejects wrong-connection and revoked tokens", async () => {
    const minted = store.mintConnectionToken({ connectionId: context.connectionId, context, label: "agent", actor: "test" });
    const client = app();

    await request(client)
      .post("/mcp/v1/connections/connection_catnets_au_klaviyo")
      .set("Authorization", `Bearer ${minted.secret}`)
      .send(rpc("tools/list"))
      .expect(401);

    store.revokeConnectionToken(context.connectionId, minted.token.id, "test");
    await request(client)
      .post(`/mcp/v1/connections/${context.connectionId}`)
      .set("Authorization", `Bearer ${minted.secret}`)
      .send(rpc("tools/list"))
      .expect(401);
  });

  it("rejects connection tokens on the gateway-wide MCP surface", async () => {
    const minted = store.mintConnectionToken({ connectionId: context.connectionId, context, label: "agent", actor: "test" });
    const client = app();

    const list = await request(client).post("/mcp/v1").set("Authorization", `Bearer ${minted.secret}`).send(rpc("tools/list"));
    const call = await request(client)
      .post("/mcp/v1")
      .set("Authorization", `Bearer ${minted.secret}`)
      .send(rpc("tools/call", { name: "gateway_list_connections", arguments: {} }));

    expect(list.status).toBe(403);
    expect(call.status).toBe(403);
  });

  it("handles initialize, ping, invalid JSON-RPC, unknown methods, and unavailable connections", async () => {
    const minted = store.mintConnectionToken({ connectionId: context.connectionId, context, label: "agent", actor: "test" });
    const client = app();

    await request(client)
      .post(`/mcp/v1/connections/${context.connectionId}`)
      .set("Authorization", `Bearer ${minted.secret}`)
      .send(rpc("initialize"))
      .expect(200)
      .expect((res) => expect(res.body.result.serverInfo.name).toBe("haverford-gateway-connection"));
    await request(client)
      .post(`/mcp/v1/connections/${context.connectionId}`)
      .set("Authorization", `Bearer ${minted.secret}`)
      .send(rpc("ping"))
      .expect(200)
      .expect((res) => expect(res.body.result).toEqual({}));
    await request(client)
      .post(`/mcp/v1/connections/${context.connectionId}`)
      .set("Authorization", `Bearer ${minted.secret}`)
      .send({ method: 1 })
      .expect(400)
      .expect((res) => expect(res.body.error.code).toBe(-32600));
    await request(client)
      .post(`/mcp/v1/connections/${context.connectionId}`)
      .set("Authorization", `Bearer ${minted.secret}`)
      .send(rpc("missing"))
      .expect(200)
      .expect((res) => expect(res.body.error.code).toBe(-32601));
    await request(client)
      .post("/mcp/v1/connections/connection_haverford_au_outlook")
      .set("x-auth-gate-email", "lee@haverford.au")
      .send(rpc("tools/list"))
      .expect(403)
      .expect((res) => expect(res.body.error).toBe("connection_unavailable"));
  });
});
