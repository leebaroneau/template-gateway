import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { GatewayConnectionContext } from "../src/access/connection-tokens.js";
import { createInitialGatewayState } from "../src/admin/fixtures.js";
import { GatewayAppInstallStore } from "../src/apps/store.js";
import { callConnectionScopedTool, filterStateToConnection } from "../src/mcp-v1/connection-tools.js";

const context: GatewayConnectionContext = {
  connectionId: "connection_haverford_au_shopify",
  brandId: "brand_haverford",
  regionId: "region_haverford_au",
  connectorSlug: "shopify"
};

const tempDirs: string[] = [];
const stores: GatewayAppInstallStore[] = [];

function appInstallStore(): GatewayAppInstallStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-connection-tools-"));
  tempDirs.push(dir);
  const store = new GatewayAppInstallStore(path.join(dir, "gateway.sqlite"));
  stores.push(store);
  return store;
}

afterEach(() => {
  while (stores.length > 0) stores.pop()?.close();
  while (tempDirs.length > 0) fs.rmSync(tempDirs.pop() ?? "", { recursive: true, force: true });
});

describe("connection-scoped MCP tools", () => {
  it("filters gateway state to the target connection tuple", () => {
    const scoped = filterStateToConnection(createInitialGatewayState(), context);

    expect(scoped.connections).toEqual([expect.objectContaining({ id: context.connectionId })]);
    expect(scoped.brands).toEqual([expect.objectContaining({ id: context.brandId })]);
    expect(scoped.regions).toEqual([expect.objectContaining({ id: context.regionId })]);
    expect(scoped.connectors).toEqual([expect.objectContaining({ slug: context.connectorSlug })]);
  });

  it("returns redacted connection metadata and raw/resource status fields", async () => {
    const state = createInitialGatewayState();
    state.connections[0].lastUsedAt = "2026-06-01T00:00:00.000Z";
    state.connections[0].lastError = "connected errors are visible";

    const got = await callConnectionScopedTool("connection_get", {}, context, state);
    expect(got.isError).toBe(false);
    expect(got.structuredContent.connection).toMatchObject({
      id: context.connectionId,
      configSummary: { shop_domain: "haverford-au.myshopify.com" }
    });
    expect(JSON.stringify(got.structuredContent)).not.toContain("access_token_ref");

    const status = await callConnectionScopedTool("connection_status", {}, context, state);
    expect(status.structuredContent.status).toMatchObject({
      connectionId: context.connectionId,
      status: "connected",
      runtimeStatus: "metadata_only",
      migrationStatus: "not_started",
      lastTestedAt: "2026-05-29T05:00:00.000Z",
      lastUsedAt: "2026-06-01T00:00:00.000Z",
      lastError: "connected errors are visible"
    });
  });

  it("omits lastError for non-connected status as a defense-in-depth rule", async () => {
    const state = createInitialGatewayState();
    const errorConnection = state.connections.find((connection) => connection.id === "connection_catnets_us_meta_ads")!;
    const result = await callConnectionScopedTool(
      "connection_status",
      {},
      {
        connectionId: errorConnection.id,
        brandId: errorConnection.brandId,
        regionId: errorConnection.regionId,
        connectorSlug: "meta-ads"
      },
      state
    );

    expect(result.structuredContent.status).toMatchObject({ status: "needs_reconnect" });
    expect(result.structuredContent.status).not.toHaveProperty("lastError");
  });

  it("lists app installs only for the bound brand and region", async () => {
    const store = appInstallStore();
    const included = store.createInstall({
      appSlug: "daily-sales",
      brandId: context.brandId,
      regionId: context.regionId,
      connectionId: context.connectionId,
      status: "enabled"
    });
    store.createInstall({ appSlug: "other", brandId: "brand_catnets", regionId: "region_catnets_au", status: "enabled" });

    const result = await callConnectionScopedTool(
      "connection_list_app_installs",
      { status: "enabled" },
      context,
      createInitialGatewayState(),
      store
    );

    expect(result.structuredContent.installs).toEqual([expect.objectContaining({ id: included.id })]);
  });

  it("rejects unknown tools before touching state", async () => {
    const result = await callConnectionScopedTool("connection_write", {}, context, createInitialGatewayState());

    expect(result).toMatchObject({ isError: true, structuredContent: {} });
  });
});
