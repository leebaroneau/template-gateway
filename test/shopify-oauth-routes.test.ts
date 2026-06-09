import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import supertest from "supertest";
import express from "express";
import { createShopifyOAuthRouter } from "../src/shopify-oauth/routes.js";
import { GatewayShopifyStore } from "../src/shopify-oauth/store.js";
import { ShopifyOAuthAdapter } from "../src/shopify-oauth/adapter.js";

const BEARER = "test-bearer";

const SHOPIFY_CONFIG = {
  apiKey: "test_key",
  apiSecret: "test_secret",
  redirectUri: "https://example.com/callback",
  encryptionKey: Buffer.alloc(32, 0x42).toString("base64url"),
  scopes: ["read_products"],
};

const TEST_SHOP = "test-store.myshopify.com";

let tempDir: string;
let dbPath: string;
let stores: GatewayShopifyStore[];

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-shopify-routes-"));
  dbPath = path.join(tempDir, "gateway.sqlite");
  stores = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  while (stores.length > 0) stores.pop()?.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function openStore(): GatewayShopifyStore {
  const store = new GatewayShopifyStore(dbPath);
  stores.push(store);
  return store;
}

function buildApp(store: GatewayShopifyStore): express.Express {
  const adapter = new ShopifyOAuthAdapter(SHOPIFY_CONFIG, store);
  const app = express();
  app.use(
    "/oauth/shopify",
    createShopifyOAuthRouter({ config: SHOPIFY_CONFIG, adapter, store, bearer: BEARER })
  );
  return app;
}

function buildDisabledApp(): express.Express {
  const app = express();
  app.use(
    "/oauth/shopify",
    createShopifyOAuthRouter({
      config: undefined,
      adapter: undefined,
      store: undefined,
      bearer: BEARER,
    })
  );
  return app;
}

// Helper: compute a valid callback HMAC the same way Shopify would (hex, over query params)
function computeCallbackHmac(params: Record<string, string>, secret: string): string {
  const message = Object.entries(params)
    .filter(([k]) => k !== "hmac" && k !== "signature")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  return crypto.createHmac("sha256", secret).update(message).digest("hex");
}

// Helper: compute webhook HMAC (base64, over raw body string/bytes).
// NOTE: supertest serializes Buffer args to JSON, so we always pass the raw JSON string
// and compute HMAC over that same string — the bytes are identical to Buffer.from(str).
function computeWebhookHmac(body: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(body).digest("base64");
}

// ── A) Bearer authentication ─────────────────────────────────────────────────

describe("Bearer authentication", () => {
  it("GET /credentials without auth → 401", async () => {
    const app = buildApp(openStore());
    const res = await supertest(app).get("/oauth/shopify/credentials");
    expect(res.status).toBe(401);
  });

  it("POST /install without auth → 401", async () => {
    const app = buildApp(openStore());
    const res = await supertest(app).post("/oauth/shopify/install").send({ shop: TEST_SHOP });
    expect(res.status).toBe(401);
  });

  it("DELETE /credentials/x without auth → 401", async () => {
    const app = buildApp(openStore());
    const res = await supertest(app).delete("/oauth/shopify/credentials/x");
    expect(res.status).toBe(401);
  });
});

// ── B) POST /install ─────────────────────────────────────────────────────────

describe("POST /oauth/shopify/install", () => {
  it("returns redirectUrl and state for a valid shop", async () => {
    const app = buildApp(openStore());
    const res = await supertest(app)
      .post("/oauth/shopify/install")
      .set("Authorization", `Bearer ${BEARER}`)
      .send({ shop: TEST_SHOP });
    expect(res.status).toBe(200);
    const { redirectUrl, state } = res.body as { redirectUrl: string; state: string };
    expect(typeof state).toBe("string");
    const url = new URL(redirectUrl);
    expect(url.searchParams.get("client_id")).toBe(SHOPIFY_CONFIG.apiKey);
    expect(url.searchParams.get("scope")).toBeTruthy();
    expect(url.searchParams.get("redirect_uri")).toBe(SHOPIFY_CONFIG.redirectUri);
    expect(url.searchParams.get("state")).toBe(state);
    // No grant_options[] — offline token
    expect(url.searchParams.has("grant_options[]")).toBe(false);
  });

  it("returns 400 for an invalid shop domain", async () => {
    const app = buildApp(openStore());
    const res = await supertest(app)
      .post("/oauth/shopify/install")
      .set("Authorization", `Bearer ${BEARER}`)
      .send({ shop: "evil.com" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_input");
  });

  it("returns 400 when shop is missing", async () => {
    const app = buildApp(openStore());
    const res = await supertest(app)
      .post("/oauth/shopify/install")
      .set("Authorization", `Bearer ${BEARER}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_input");
  });
});

// ── C) GET /callback ─────────────────────────────────────────────────────────

describe("GET /oauth/shopify/callback", () => {
  it("returns 400 invalid_hmac for a wrong hmac param", async () => {
    const app = buildApp(openStore());
    const res = await supertest(app).get(
      `/oauth/shopify/callback?shop=${TEST_SHOP}&code=abc&state=somestate&hmac=deadbeef`
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_hmac");
  });

  it("returns 400 invalid_state when state is not in the store", async () => {
    const app = buildApp(openStore());
    // Compute a valid HMAC for these params so HMAC check passes
    const baseParams = {
      code: "abc",
      shop: TEST_SHOP,
      state: "nonexistent_state",
      timestamp: "1234567890",
    };
    const hmac = computeCallbackHmac(baseParams, SHOPIFY_CONFIG.apiSecret);
    const qs = new URLSearchParams({ ...baseParams, hmac }).toString();
    const res = await supertest(app).get(`/oauth/shopify/callback?${qs}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_state");
  });

  it("happy path: exchanges code for token and returns credential without encryptedPayload", async () => {
    const store = openStore();
    const adapter = new ShopifyOAuthAdapter(SHOPIFY_CONFIG, store);
    const { state } = adapter.startFlow({ shop: TEST_SHOP });

    // Build callback query params with valid HMAC
    const baseParams: Record<string, string> = {
      code: "auth_code",
      shop: TEST_SHOP,
      state,
      timestamp: "1234567890",
    };
    const hmac = computeCallbackHmac(baseParams, SHOPIFY_CONFIG.apiSecret);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: "shpat_test_token",
            scope: "read_products",
          }),
      })
    );

    const app = buildApp(store);
    const qs = new URLSearchParams({ ...baseParams, hmac }).toString();
    const res = await supertest(app).get(`/oauth/shopify/callback?${qs}`);
    expect(res.status).toBe(200);
    expect(res.body.credential).toBeDefined();
    expect(res.body.credential.shop).toBe(TEST_SHOP);
    expect(res.body.credential.status).toBe("connected");
    expect(res.body.credential).not.toHaveProperty("encryptedPayload");
  });

  it("returns 400 when missing required callback parameters", async () => {
    const app = buildApp(openStore());
    const res = await supertest(app).get(`/oauth/shopify/callback?shop=${TEST_SHOP}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });
});

// ── D) GET /credentials and GET /credentials/:id ─────────────────────────────

describe("GET /oauth/shopify/credentials", () => {
  it("returns empty array when no credentials exist", async () => {
    const app = buildApp(openStore());
    const res = await supertest(app)
      .get("/oauth/shopify/credentials")
      .set("Authorization", `Bearer ${BEARER}`);
    expect(res.status).toBe(200);
    expect(res.body.credentials).toEqual([]);
  });

  it("returns credentials without encryptedPayload", async () => {
    const store = openStore();
    store.saveCredential({
      shop: TEST_SHOP,
      encryptedPayload: "iv:tag:cipher",
      scope: "read_products",
      status: "connected",
    });
    const app = buildApp(store);
    const res = await supertest(app)
      .get("/oauth/shopify/credentials")
      .set("Authorization", `Bearer ${BEARER}`);
    expect(res.status).toBe(200);
    expect(res.body.credentials).toHaveLength(1);
    expect(res.body.credentials[0].shop).toBe(TEST_SHOP);
    expect(res.body.credentials[0]).not.toHaveProperty("encryptedPayload");
  });
});

describe("GET /oauth/shopify/credentials/:id", () => {
  it("returns 404 for an unknown id", async () => {
    const app = buildApp(openStore());
    const res = await supertest(app)
      .get("/oauth/shopify/credentials/unknown_id")
      .set("Authorization", `Bearer ${BEARER}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("not_found");
  });

  it("returns the credential by id without encryptedPayload", async () => {
    const store = openStore();
    const id = store.saveCredential({
      shop: TEST_SHOP,
      encryptedPayload: "iv:tag:cipher",
      scope: "read_products",
      status: "connected",
    });
    const app = buildApp(store);
    const res = await supertest(app)
      .get(`/oauth/shopify/credentials/${id}`)
      .set("Authorization", `Bearer ${BEARER}`);
    expect(res.status).toBe(200);
    expect(res.body.credential.id).toBe(id);
    expect(res.body.credential.shop).toBe(TEST_SHOP);
    expect(res.body.credential).not.toHaveProperty("encryptedPayload");
  });
});

// ── E) DELETE /credentials/:id ───────────────────────────────────────────────

describe("DELETE /oauth/shopify/credentials/:id", () => {
  it("returns 404 for unknown id", async () => {
    const app = buildApp(openStore());
    const res = await supertest(app)
      .delete("/oauth/shopify/credentials/unknown_id")
      .set("Authorization", `Bearer ${BEARER}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("not_found");
  });

  it("deletes a credential and returns { deleted: true, id }", async () => {
    const store = openStore();
    const adapter = new ShopifyOAuthAdapter(SHOPIFY_CONFIG, store);

    // Install a credential via completeFlow with mocked fetch
    const { state } = adapter.startFlow({ shop: TEST_SHOP });
    const baseParams: Record<string, string> = {
      code: "auth_code",
      shop: TEST_SHOP,
      state,
      timestamp: "1234567890",
    };
    const hmac = computeCallbackHmac(baseParams, SHOPIFY_CONFIG.apiSecret);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ access_token: "shpat_tok", scope: "read_products" }),
      })
    );

    const result = await adapter.completeFlow({
      code: "auth_code",
      state,
      shop: TEST_SHOP,
      hmac,
      queryParams: { ...baseParams, hmac },
    });
    vi.unstubAllGlobals();

    const credId = result.credential.id;
    const app = buildApp(store);
    const res = await supertest(app)
      .delete(`/oauth/shopify/credentials/${credId}`)
      .set("Authorization", `Bearer ${BEARER}`);
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
    expect(res.body.id).toBe(credId);
    expect(store.getCredential(credId)).toBeUndefined();
  });
});

// ── F) POST /webhooks ─────────────────────────────────────────────────────────

describe("POST /oauth/shopify/webhooks", () => {
  it("returns 200 and sets status to needs_reconnect on app/uninstalled", async () => {
    const store = openStore();
    store.saveCredential({
      shop: TEST_SHOP,
      encryptedPayload: "iv:tag:cipher",
      scope: "read_products",
      status: "connected",
    });

    const app = buildApp(store);
    const payload = JSON.stringify({ shop: TEST_SHOP });
    const hmac = computeWebhookHmac(payload, SHOPIFY_CONFIG.apiSecret);

    const res = await supertest(app)
      .post("/oauth/shopify/webhooks")
      .set("Content-Type", "application/json")
      .set("X-Shopify-Hmac-Sha256", hmac)
      .set("X-Shopify-Topic", "app/uninstalled")
      .set("X-Shopify-Shop-Domain", TEST_SHOP)
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const cred = store.getCredentialByShop(TEST_SHOP);
    expect(cred?.status).toBe("needs_reconnect");
  });

  it("returns 200 and deletes credential on shop/redact", async () => {
    const store = openStore();
    store.saveCredential({
      shop: TEST_SHOP,
      encryptedPayload: "iv:tag:cipher",
      scope: "read_products",
      status: "connected",
    });

    const app = buildApp(store);
    const payload = JSON.stringify({ shop: TEST_SHOP });
    const hmac = computeWebhookHmac(payload, SHOPIFY_CONFIG.apiSecret);

    const res = await supertest(app)
      .post("/oauth/shopify/webhooks")
      .set("Content-Type", "application/json")
      .set("X-Shopify-Hmac-Sha256", hmac)
      .set("X-Shopify-Topic", "shop/redact")
      .set("X-Shopify-Shop-Domain", TEST_SHOP)
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(store.getCredentialByShop(TEST_SHOP)).toBeUndefined();
  });

  it("returns 200 ack for an unknown topic", async () => {
    const app = buildApp(openStore());
    const payload = JSON.stringify({});
    const hmac = computeWebhookHmac(payload, SHOPIFY_CONFIG.apiSecret);

    const res = await supertest(app)
      .post("/oauth/shopify/webhooks")
      .set("Content-Type", "application/json")
      .set("X-Shopify-Hmac-Sha256", hmac)
      .set("X-Shopify-Topic", "customers/data_request")
      .set("X-Shopify-Shop-Domain", TEST_SHOP)
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("returns 401 for an invalid webhook HMAC", async () => {
    const app = buildApp(openStore());
    const payload = JSON.stringify({});

    const res = await supertest(app)
      .post("/oauth/shopify/webhooks")
      .set("Content-Type", "application/json")
      .set("X-Shopify-Hmac-Sha256", "aW52YWxpZA==") // wrong base64 HMAC
      .set("X-Shopify-Topic", "app/uninstalled")
      .set("X-Shopify-Shop-Domain", TEST_SHOP)
      .send(payload);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("unauthorized");
  });
});

// ── G) 501 not-configured suite ───────────────────────────────────────────────

describe("501 when Shopify OAuth not configured", () => {
  it("returns 501 on all routes", async () => {
    const app = buildDisabledApp();
    const routes = [
      ["GET", "/oauth/shopify/credentials"],
      ["POST", "/oauth/shopify/install"],
      ["GET", "/oauth/shopify/callback"],
      ["DELETE", "/oauth/shopify/credentials/any_id"],
      ["POST", "/oauth/shopify/webhooks"],
    ] as const;
    for (const [method, url] of routes) {
      const res = await (supertest(app) as ReturnType<typeof supertest>)[
        method.toLowerCase() as "get" | "post" | "delete"
      ](url).set("Authorization", `Bearer ${BEARER}`);
      expect(res.status, `${method} ${url}`).toBe(501);
    }
  });
});
