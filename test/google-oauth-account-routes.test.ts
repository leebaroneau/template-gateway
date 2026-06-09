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
import { createGoogleOAuthRouter } from "../src/google-oauth/routes.js";
import type { GatewayConnectionBackend, GatewayState, Connector, Connection } from "../src/admin/types.js";
import { encryptCredential as encryptAccountCredential } from "../src/account-credentials/crypto.js";
import type { OAuthAccountTokenPayload } from "../src/account-credentials/types.js";

const TEST_KEY = Buffer.alloc(32, 0x42).toString("base64url");
const BEARER = "test-bearer";

const GOOGLE_CONFIG: GoogleOAuthConfig = {
  clientId: "test-client.apps.googleusercontent.com",
  clientSecret: "test-secret",
  redirectUri: "http://localhost:3000/oauth/google/account/callback",
  encryptionKey: TEST_KEY
};

let tempDir: string;
let dbPath: string;
let allStores: Array<{ close(): void }>;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-acct-routes-"));
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
  const idPart = slug.replace(/-/g, "_");
  return {
    id: `devapi_${brandId}_${regionId}_${idPart}`,
    brandId,
    regionId,
    connectorId: `connector_${idPart}`,
    backendType: "native",
    displayName: `${brandId} ${slug}`,
    status: "connected",
    configSummary
  };
}

function makeBackend(connections: Connection[] = []): GatewayConnectionBackend {
  const connectors = ["google-analytics-4", "google-search-console", "google-ads", "merchant-center"].map(makeConnector);
  const state: GatewayState = { brands: [], regions: [], connectors, connections, apiClients: [], auditEvents: [] };
  return { snapshot: () => state } as unknown as GatewayConnectionBackend;
}

function buildApp(
  connections: Connection[] = [],
  customFetch?: typeof fetch
): { app: express.Express; accountStore: GatewayAccountStore; googleStore: GatewayGoogleStore; accessStore: GatewayAccessStore } {
  const { accountStore, googleStore, accessStore } = openStores();
  const adapter = new GoogleOAuthAdapter(GOOGLE_CONFIG, googleStore);
  const backend = makeBackend(connections);
  const linker = new GoogleAccountLinker(backend, accountStore, googleStore, adapter, accessStore);

  // Patch adapter's fetch-dependent methods with our stub if provided
  if (customFetch) {
    vi.spyOn(adapter, "completeAccountFlow").mockImplementation(async (input, aStore) => {
      // Simulate: validate state, then call accountStore.upsertAccount
      const state = googleStore.getOAuthState(input.state);
      if (!state || state.brandId !== "__account__") throw new Error("Invalid or expired OAuth state");
      googleStore.deleteOAuthState(input.state);

      const payload: OAuthAccountTokenPayload = {
        service: "google",
        externalAccountId: "admin@haverford.com.au",
        refreshToken: "rt_test",
        accessToken: "ya29.test",
        scope: "analytics.readonly"
      };
      const ep = encryptAccountCredential(payload, TEST_KEY);
      const accountId = aStore.upsertAccount({
        service: "google",
        externalAccountId: "admin@haverford.com.au",
        displayName: "Haverford Google Admin",
        encryptedPayload: ep,
        scope: "analytics.readonly",
        status: "connected",
        tokenExpiryAt: new Date(Date.now() + 3600 * 1000).toISOString()
      });
      return { account: aStore.getAccount(accountId) };
    });

    vi.spyOn(adapter, "provisionConnectionCredential").mockImplementation(
      async (input, _fetch, aStore) => {
        const account = aStore.getAccount(input.accountId)!;
        return googleStore.upsertCredential({
          brandId: input.brandId,
          regionId: input.regionId,
          connectorSlug: input.connectorSlug,
          accountId: input.accountId,
          googleAccountEmail: account.externalAccountId,
          encryptedPayload: encryptAccountCredential(
            { service: "google", externalAccountId: account.externalAccountId, accessToken: "ya29.fresh", refreshToken: undefined },
            TEST_KEY
          ),
          tokenExpiryAt: new Date(Date.now() + 3600 * 1000).toISOString(),
          products: [input.product],
          status: "connected"
        });
      }
    );
  }

  const app = express();
  app.use(
    "/oauth/google",
    createGoogleOAuthRouter({ config: GOOGLE_CONFIG, adapter, store: googleStore, bearer: BEARER, accessStore, accountStore, linker })
  );

  return { app, accountStore, googleStore, accessStore };
}

// Simulate starting account flow and returning the state token
function startAccountFlow(googleStore: GatewayGoogleStore): string {
  // Create a state manually (simulating POST /account/start)
  const state = `acct_teststate_${Date.now()}`;
  googleStore.saveOAuthState({
    state,
    brandId: "__account__",
    regionId: "__account__",
    products: [],
    bindings: [],
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
  });
  return state;
}

describe("POST /oauth/google/account/start", () => {
  it("returns 401 without bearer", async () => {
    const { app } = buildApp();
    const res = await supertest(app).post("/oauth/google/account/start");
    expect(res.status).toBe(401);
  });

  it("returns redirectUrl and state with acct_ prefix", async () => {
    const { app } = buildApp();
    const res = await supertest(app)
      .post("/oauth/google/account/start")
      .set("Authorization", `Bearer ${BEARER}`);
    expect(res.status).toBe(200);
    expect(res.body.redirectUrl).toContain("accounts.google.com");
    expect(res.body.state).toMatch(/^acct_/);
  });
});

describe("GET /oauth/google/account/callback (account flow)", () => {
  it("creates one gateway_oauth_accounts row with no encryptedPayload in response", async () => {
    const { app, accountStore, googleStore } = buildApp([], vi.fn() as unknown as typeof fetch);
    const state = startAccountFlow(googleStore);

    const res = await supertest(app)
      .get(`/oauth/google/callback?code=authcode&state=${state}`);
    expect(res.status).toBe(200);
    expect(res.body.account).toBeDefined();
    expect(res.body.account.encryptedPayload).toBeUndefined();
    expect(res.body.account.service).toBe("google");
    expect(accountStore.listAccounts("google")).toHaveLength(1);
  });

  it("second callback for same email upserts (same account id returned)", async () => {
    const { app, accountStore, googleStore } = buildApp([], vi.fn() as unknown as typeof fetch);

    const state1 = startAccountFlow(googleStore);
    const r1 = await supertest(app)
      .get(`/oauth/google/callback?code=authcode&state=${state1}`);
    const id1 = r1.body.account?.id;

    const state2 = startAccountFlow(googleStore);
    const r2 = await supertest(app)
      .get(`/oauth/google/callback?code=authcode&state=${state2}`);
    const id2 = r2.body.account?.id;

    expect(id1).toBe(id2);
    expect(accountStore.listAccounts("google")).toHaveLength(1);
  });

  it("account callback writes NO gateway_google_credentials row", async () => {
    const { app, googleStore } = buildApp([], vi.fn() as unknown as typeof fetch);
    const state = startAccountFlow(googleStore);
    await supertest(app).get(`/oauth/google/callback?code=authcode&state=${state}`);
    expect(googleStore.listCredentials()).toHaveLength(0);
  });

  it("returns 400 for invalid state", async () => {
    const { app } = buildApp();
    const res = await supertest(app).get("/oauth/google/callback?code=code&state=acct_bad_state");
    expect(res.status).toBe(400);
  });
});

describe("GET /oauth/google/account/link-plan", () => {
  it("returns 401 without bearer", async () => {
    const { app } = buildApp();
    const res = await supertest(app).get("/oauth/google/account/link-plan");
    expect(res.status).toBe(401);
  });

  it("returns 404 when no account exists", async () => {
    const { app } = buildApp();
    const res = await supertest(app)
      .get("/oauth/google/account/link-plan")
      .set("Authorization", `Bearer ${BEARER}`);
    expect(res.status).toBe(404);
  });

  it("returns plan with proposed entries after seeding connections", async () => {
    const connections = [
      makeConnection("google-analytics-4", "brand_hav", "au", { property_id: "properties/1" }),
      makeConnection("merchant-center", "brand_hav", "au", {}) // unmatched
    ];
    const { app, accountStore, googleStore } = buildApp(connections, vi.fn() as unknown as typeof fetch);
    const state = startAccountFlow(googleStore);
    await supertest(app).get(`/oauth/google/callback?code=authcode&state=${state}`);
    const accountId = accountStore.listAccounts("google")[0].id;

    const res = await supertest(app)
      .get(`/oauth/google/account/link-plan?accountId=${accountId}`)
      .set("Authorization", `Bearer ${BEARER}`);
    expect(res.status).toBe(200);
    expect(res.body.counts.proposed).toBe(1);
    expect(res.body.counts.unmatched).toBe(1);
    expect(res.body.entries).toHaveLength(2);
  });

  it("infers accountId when only one google account exists", async () => {
    const { app, accountStore, googleStore } = buildApp([], vi.fn() as unknown as typeof fetch);
    const state = startAccountFlow(googleStore);
    await supertest(app).get(`/oauth/google/callback?code=authcode&state=${state}`);
    expect(accountStore.listAccounts("google")).toHaveLength(1);

    const res = await supertest(app)
      .get("/oauth/google/account/link-plan")
      .set("Authorization", `Bearer ${BEARER}`);
    expect(res.status).toBe(200);
    expect(res.body.counts).toBeDefined();
  });
});

describe("POST /oauth/google/account/link", () => {
  it("returns 401 without bearer", async () => {
    const { app } = buildApp();
    const res = await supertest(app).post("/oauth/google/account/link");
    expect(res.status).toBe(401);
  });

  it("links all proposed, skips unmatched, emits audits", async () => {
    const connections = [
      makeConnection("google-analytics-4", "brand_hav", "au", { property_id: "properties/1" }),
      makeConnection("google-search-console", "brand_hav", "au", { site_url: "https://hav.com" }),
      makeConnection("merchant-center", "brand_hav", "au", {}) // unmatched
    ];
    const { app, accountStore, googleStore, accessStore } = buildApp(connections, vi.fn() as unknown as typeof fetch);
    const state = startAccountFlow(googleStore);
    await supertest(app).get(`/oauth/google/callback?code=authcode&state=${state}`);
    const accountId = accountStore.listAccounts("google")[0].id;

    const res = await supertest(app)
      .post("/oauth/google/account/link")
      .set("Authorization", `Bearer ${BEARER}`)
      .send({ accountId });
    expect(res.status).toBe(200);
    expect(res.body.linked).toHaveLength(2);
    expect(res.body.skipped).toHaveLength(1);
    expect(res.body.skipped[0].reason).toContain("unmatched");

    // Audit events emitted via the access store's internal DB
    const db = accessStore["db"] as import("better-sqlite3").Database;
    const events = db.prepare("SELECT * FROM gateway_audit_events ORDER BY timestamp ASC").all();
    expect(events.length).toBeGreaterThan(0);
  });

  it("re-POST returns empty linked (idempotent)", async () => {
    const connections = [
      makeConnection("google-analytics-4", "brand_hav", "au", { property_id: "properties/1" })
    ];
    const { app, accountStore, googleStore } = buildApp(connections, vi.fn() as unknown as typeof fetch);
    const state = startAccountFlow(googleStore);
    await supertest(app).get(`/oauth/google/callback?code=authcode&state=${state}`);
    const accountId = accountStore.listAccounts("google")[0].id;

    await supertest(app)
      .post("/oauth/google/account/link")
      .set("Authorization", `Bearer ${BEARER}`)
      .send({ accountId });

    const res2 = await supertest(app)
      .post("/oauth/google/account/link")
      .set("Authorization", `Bearer ${BEARER}`)
      .send({ accountId });
    expect(res2.body.linked).toHaveLength(0);
  });

  it("links only specified connectionIds", async () => {
    const conn1 = makeConnection("google-analytics-4", "brand_hav", "au", { property_id: "properties/1" });
    const conn2 = makeConnection("google-search-console", "brand_hav", "au", { site_url: "https://hav.com" });
    const { app, accountStore, googleStore } = buildApp([conn1, conn2], vi.fn() as unknown as typeof fetch);
    const state = startAccountFlow(googleStore);
    await supertest(app).get(`/oauth/google/callback?code=authcode&state=${state}`);
    const accountId = accountStore.listAccounts("google")[0].id;

    const res = await supertest(app)
      .post("/oauth/google/account/link")
      .set("Authorization", `Bearer ${BEARER}`)
      .send({ accountId, connectionIds: [conn1.id] });
    expect(res.status).toBe(200);
    expect(res.body.linked).toHaveLength(1);
    expect(res.body.linked[0].connectionId).toBe(conn1.id);
  });

  it("returns 404 for unknown accountId", async () => {
    const { app } = buildApp();
    const res = await supertest(app)
      .post("/oauth/google/account/link")
      .set("Authorization", `Bearer ${BEARER}`)
      .send({ accountId: "oauth_acct_notfound" });
    expect(res.status).toBe(404);
  });
});

describe("501 when GOOGLE_OAUTH_* unset", () => {
  it("all /account/* routes return 501", async () => {
    const app = express();
    app.use(
      "/oauth/google",
      createGoogleOAuthRouter({ config: undefined, adapter: undefined, store: undefined, bearer: BEARER })
    );
    for (const path of ["/oauth/google/account/start", "/oauth/google/account/link-plan", "/oauth/google/account/link"]) {
      const method = path.includes("start") || path.includes("link") && !path.includes("link-plan") ? "post" : "get";
      const res = await (method === "post"
        ? supertest(app).post(path).set("Authorization", `Bearer ${BEARER}`)
        : supertest(app).get(path).set("Authorization", `Bearer ${BEARER}`));
      expect(res.status).toBe(501);
    }
  });
});
