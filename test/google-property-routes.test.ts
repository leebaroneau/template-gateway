import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import supertest from "supertest";
import express from "express";
import { GatewayAccountStore } from "../src/account-credentials/store.js";
import { GatewayGoogleStore } from "../src/google-oauth/store.js";
import { GatewayAccessStore } from "../src/access/store.js";
import { GoogleOAuthAdapter, type GoogleOAuthConfig } from "../src/google-oauth/adapter.js";
import { GoogleAccountLinker } from "../src/google-oauth/linker.js";
import { GooglePropertyEnumerator } from "../src/google-oauth/enumerator.js";
import { createAdminRouter } from "../src/admin/routes.js";
import type { GatewayConnectionBackend, GatewayState, Connector, Connection } from "../src/admin/types.js";

const TEST_KEY = Buffer.alloc(32, 0x42).toString("base64url");
const GOOGLE_CONFIG: GoogleOAuthConfig = {
  clientId: "test-client",
  clientSecret: "test-secret",
  redirectUri: "http://localhost/callback",
  encryptionKey: TEST_KEY
};

let tempDir: string;
let dbPath: string;
let allStores: Array<{ close(): void }>;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-prop-routes-"));
  dbPath = path.join(tempDir, "gateway.sqlite");
  allStores = [];
  vi.restoreAllMocks();
});

afterEach(() => {
  while (allStores.length > 0) allStores.pop()?.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function openStores() {
  const accountStore = new GatewayAccountStore(dbPath);
  const googleStore = new GatewayGoogleStore(dbPath);
  const accessStore = new GatewayAccessStore(dbPath);
  allStores.push(accountStore, googleStore, accessStore);
  return { accountStore, googleStore, accessStore };
}

function makeConnector(slug: string): Connector {
  return {
    id: `connector_${slug.replace(/-/g, "_")}`,
    slug,
    name: slug,
    category: "analytics",
    authMode: "oauth",
    backendOptions: ["native"],
    requiredFields: [],
    scopes: [],
    description: ""
  };
}

function makeConnection(slug: string, brandId: string, regionId: string, configSummary: Record<string, string>): Connection {
  return {
    id: `devapi_${brandId}_${regionId}_${slug.replace(/-/g, "_")}`,
    brandId,
    regionId,
    connectorId: `connector_${slug.replace(/-/g, "_")}`,
    backendType: "native",
    displayName: `${brandId} ${slug}`,
    status: "connected",
    configSummary
  };
}

function makeBackend(connections: Connection[] = []): GatewayConnectionBackend {
  const connectors = [
    "google-analytics-4",
    "google-search-console",
    "google-ads",
    "merchant-center",
    "google-business-profile"
  ].map(makeConnector);
  const state: GatewayState = { brands: [], regions: [], connectors, connections, apiClients: [], auditEvents: [] };
  return { snapshot: () => state } as unknown as GatewayConnectionBackend;
}

function buildApp(connections: Connection[] = []) {
  const { accountStore, googleStore, accessStore } = openStores();
  const adapter = new GoogleOAuthAdapter(GOOGLE_CONFIG, googleStore);
  const backend = makeBackend(connections);
  const linker = new GoogleAccountLinker(backend, accountStore, googleStore, adapter, accessStore);
  const enumerator = new GooglePropertyEnumerator(adapter, accountStore, googleStore);

  // Stub enumerator to avoid real Google API calls
  vi.spyOn(enumerator, "listProperties").mockResolvedValue([
    { id: "properties/111", displayName: "Brand AU", url: "https://brand.com.au", alreadyClaimed: false }
  ]);

  const app = express();
  app.use("/admin", createAdminRouter(backend, accessStore, undefined, undefined, accountStore, linker, enumerator));
  return { app, accountStore, enumerator };
}

describe("GET /admin/api/google-properties", () => {
  it("returns 400 for unknown connectorSlug", async () => {
    const { app } = buildApp();
    const res = await supertest(app)
      .get("/admin/api/google-properties?accountId=acct_1&connectorSlug=unknown-connector");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("unknown_connector");
  });

  it("returns 501 when enumerator not configured", async () => {
    const { accountStore, googleStore, accessStore } = openStores();
    const backend = makeBackend();
    const adapter = new GoogleOAuthAdapter(GOOGLE_CONFIG, googleStore);
    const linker = new GoogleAccountLinker(backend, accountStore, googleStore, adapter, accessStore);
    const app = express();
    // No enumerator passed
    app.use("/admin", createAdminRouter(backend, accessStore, undefined, undefined, accountStore, linker, undefined));
    const res = await supertest(app)
      .get("/admin/api/google-properties?accountId=acct_1&connectorSlug=google-analytics-4");
    expect(res.status).toBe(501);
  });

  it("returns property list from enumerator", async () => {
    const { app } = buildApp();
    const res = await supertest(app)
      .get("/admin/api/google-properties?accountId=acct_1&connectorSlug=google-analytics-4");
    expect(res.status).toBe(200);
    expect(res.body.properties).toHaveLength(1);
    expect(res.body.properties[0].id).toBe("properties/111");
  });

  it("passes claimedMap built from linked connections", async () => {
    const conn = makeConnection("google-analytics-4", "brand_hav", "au", { property_id: "properties/999" });
    const { app, accountStore, enumerator } = buildApp([conn]);

    // Seed a link for that connection
    accountStore.upsertAccount({
      service: "google",
      externalAccountId: "a@b.com",
      displayName: "A",
      encryptedPayload: Buffer.alloc(64).toString("base64"),
      scope: "analytics",
      status: "connected"
    });
    const accountId = accountStore.listAccounts("google")[0].id;
    accountStore.linkAccount({
      accountId,
      brandId: conn.brandId,
      regionId: conn.regionId,
      connectorSlug: "google-analytics-4",
      connectionId: conn.id
    });

    await supertest(app)
      .get(`/admin/api/google-properties?accountId=${accountId}&connectorSlug=google-analytics-4`);

    expect(enumerator.listProperties).toHaveBeenCalledWith(
      accountId,
      "ga4",
      expect.any(Map),
      expect.anything()
    );
    // The claimed map should include properties/999 mapped to the connection id
    const callArgs = (enumerator.listProperties as any).mock.calls[0];
    const passedMap = callArgs[2] as Map<string, string>;
    expect(passedMap.has("properties/999")).toBe(true);
  });

  it("excludes the current connectionId from the claimed map", async () => {
    const conn = makeConnection("google-analytics-4", "brand_hav", "au", { property_id: "properties/999" });
    const { app, accountStore, enumerator } = buildApp([conn]);

    accountStore.upsertAccount({
      service: "google",
      externalAccountId: "a@b.com",
      displayName: "A",
      encryptedPayload: Buffer.alloc(64).toString("base64"),
      scope: "analytics",
      status: "connected"
    });
    const accountId = accountStore.listAccounts("google")[0].id;
    accountStore.linkAccount({
      accountId,
      brandId: conn.brandId,
      regionId: conn.regionId,
      connectorSlug: "google-analytics-4",
      connectionId: conn.id
    });

    await supertest(app)
      .get(`/admin/api/google-properties?accountId=${accountId}&connectorSlug=google-analytics-4&connectionId=${conn.id}`);

    const callArgs = (enumerator.listProperties as any).mock.calls[0];
    const passedMap = callArgs[2] as Map<string, string>;
    // Current connection's property must NOT be in claimed map
    expect(passedMap.has("properties/999")).toBe(false);
  });

  it("returns 502 when enumerator throws", async () => {
    const { app, enumerator } = buildApp();
    vi.spyOn(enumerator, "listProperties").mockRejectedValue(new Error("Google API error 403: Forbidden"));
    const res = await supertest(app)
      .get("/admin/api/google-properties?accountId=acct_1&connectorSlug=google-analytics-4");
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("upstream_error");
  });
});
