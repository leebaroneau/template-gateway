import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShopifyOAuthAdapter } from "../src/shopify-oauth/adapter.js";
import { GatewayShopifyStore } from "../src/shopify-oauth/store.js";

const TEST_KEY = Buffer.alloc(32, 0x42).toString("base64url");
const TEST_SHOP = "test-store.myshopify.com";
const API_SECRET = "test-api-secret";

const SHOPIFY_CONFIG = {
  apiKey: "test-api-key",
  apiSecret: API_SECRET,
  redirectUri: "http://localhost:3000/shopify/callback",
  encryptionKey: TEST_KEY,
  scopes: ["read_products", "write_orders"],
};

let tempDir: string;
let dbPath: string;
let stores: GatewayShopifyStore[];

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-shopify-adapter-"));
  dbPath = path.join(tempDir, "gateway.sqlite");
  stores = [];
});

afterEach(() => {
  while (stores.length > 0) stores.pop()?.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function openStore(): GatewayShopifyStore {
  const store = new GatewayShopifyStore(dbPath);
  stores.push(store);
  return store;
}

// Helper: mock fetch returning sequential responses
function mockFetch(responses: Array<{ ok: boolean; json: unknown; text?: string }>) {
  let callCount = 0;
  return vi.fn().mockImplementation(() => {
    const r = responses[callCount++] ?? responses[responses.length - 1];
    return Promise.resolve({
      ok: r.ok,
      status: r.ok ? 200 : 400,
      json: () => Promise.resolve(r.json),
      text: () => Promise.resolve(r.text ?? JSON.stringify(r.json)),
    });
  });
}

// Helper: compute a valid callback HMAC the same way Shopify would
function computeCallbackHmac(params: Record<string, string>, secret: string): string {
  const message = Object.entries(params)
    .filter(([k]) => k !== "hmac" && k !== "signature")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  return crypto.createHmac("sha256", secret).update(message).digest("hex");
}

describe("ShopifyOAuthAdapter.startFlow", () => {
  it("returns a Shopify authorization URL with required params and no grant_options[]", () => {
    const store = openStore();
    const adapter = new ShopifyOAuthAdapter(SHOPIFY_CONFIG, store);

    const result = adapter.startFlow({ shop: TEST_SHOP });

    const url = new URL(result.redirectUrl);
    expect(url.origin).toBe(`https://${TEST_SHOP}`);
    expect(url.pathname).toBe("/admin/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe(SHOPIFY_CONFIG.apiKey);
    expect(url.searchParams.get("scope")).toBe("read_products,write_orders");
    expect(url.searchParams.get("redirect_uri")).toBe(SHOPIFY_CONFIG.redirectUri);
    expect(url.searchParams.get("state")).toBe(result.state);
    // No grant_options[] (offline token — must NOT be present)
    expect(url.searchParams.has("grant_options[]")).toBe(false);
  });

  it("saves the oauth state to the store", () => {
    const store = openStore();
    const adapter = new ShopifyOAuthAdapter(SHOPIFY_CONFIG, store);

    const result = adapter.startFlow({ shop: TEST_SHOP });

    const saved = store.getOAuthState(result.state);
    expect(saved).not.toBeUndefined();
    expect(saved?.shop).toBe(TEST_SHOP);
    expect(saved?.scopes).toEqual(["read_products", "write_orders"]);
  });

  it("throws for an invalid shop domain", () => {
    const store = openStore();
    const adapter = new ShopifyOAuthAdapter(SHOPIFY_CONFIG, store);

    expect(() => adapter.startFlow({ shop: "not-a-valid-shop.com" })).toThrow(
      /Invalid shop domain/
    );
  });
});

describe("ShopifyOAuthAdapter.completeFlow", () => {
  it("happy path: exchanges code for token and returns stripped credential", async () => {
    const store = openStore();
    const adapter = new ShopifyOAuthAdapter(SHOPIFY_CONFIG, store);

    // Start flow to get a valid state
    const { state } = adapter.startFlow({ shop: TEST_SHOP });

    // Build query params that Shopify would send in the callback
    const baseParams: Record<string, string> = {
      code: "auth_code_xyz",
      shop: TEST_SHOP,
      state,
      timestamp: "1234567890",
    };
    const hmac = computeCallbackHmac(baseParams, API_SECRET);
    const queryParams = { ...baseParams, hmac };

    const fetch = mockFetch([
      { ok: true, json: { access_token: "tok_abc123", scope: "read_products,write_orders" } },
    ]);

    const result = await adapter.completeFlow(
      { code: "auth_code_xyz", state, shop: TEST_SHOP, hmac, queryParams },
      fetch as unknown as typeof globalThis.fetch
    );

    // Returned credential should NOT have encryptedPayload
    expect(result.credential).not.toHaveProperty("encryptedPayload");
    expect(result.credential.id).toBeTruthy();
    expect(result.credential.shop).toBe(TEST_SHOP);
    expect(result.credential.status).toBe("connected");
    expect(result.credential.scope).toBe("read_products,write_orders");

    // Should be retrievable by shop
    const byShop = store.getCredentialByShop(TEST_SHOP);
    expect(byShop?.shop).toBe(TEST_SHOP);
  });

  it("throws for a bad HMAC", async () => {
    const store = openStore();
    const adapter = new ShopifyOAuthAdapter(SHOPIFY_CONFIG, store);

    const { state } = adapter.startFlow({ shop: TEST_SHOP });

    const queryParams = {
      code: "auth_code",
      shop: TEST_SHOP,
      state,
      timestamp: "1234567890",
      hmac: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    };

    await expect(
      adapter.completeFlow(
        { code: "auth_code", state, shop: TEST_SHOP, hmac: queryParams.hmac, queryParams },
        mockFetch([]) as unknown as typeof globalThis.fetch
      )
    ).rejects.toThrow("Invalid HMAC");
  });

  it("throws for a missing or expired state", async () => {
    const store = openStore();
    const adapter = new ShopifyOAuthAdapter(SHOPIFY_CONFIG, store);

    const nonexistentState = "nonexistent_state_token";
    const baseParams: Record<string, string> = {
      code: "code",
      shop: TEST_SHOP,
      state: nonexistentState,
      timestamp: "1234567890",
    };
    const hmac = computeCallbackHmac(baseParams, API_SECRET);
    const queryParams = { ...baseParams, hmac };

    await expect(
      adapter.completeFlow(
        { code: "code", state: nonexistentState, shop: TEST_SHOP, hmac, queryParams },
        mockFetch([]) as unknown as typeof globalThis.fetch
      )
    ).rejects.toThrow(/Invalid or expired/);
  });

  it("throws when state.shop does not match input.shop", async () => {
    const store = openStore();
    const adapter = new ShopifyOAuthAdapter(SHOPIFY_CONFIG, store);

    // Start flow for the correct shop
    const { state } = adapter.startFlow({ shop: TEST_SHOP });

    // Callback arrives claiming a different shop
    const differentShop = "different-store.myshopify.com";
    const baseParams: Record<string, string> = {
      code: "code",
      shop: differentShop,
      state,
      timestamp: "1234567890",
    };
    const hmac = computeCallbackHmac(baseParams, API_SECRET);
    const queryParams = { ...baseParams, hmac };

    await expect(
      adapter.completeFlow(
        { code: "code", state, shop: differentShop, hmac, queryParams },
        mockFetch([]) as unknown as typeof globalThis.fetch
      )
    ).rejects.toThrow(/Invalid or expired/);
  });

  it("throws when token exchange HTTP response is not ok", async () => {
    const store = openStore();
    const adapter = new ShopifyOAuthAdapter(SHOPIFY_CONFIG, store);

    const { state } = adapter.startFlow({ shop: TEST_SHOP });
    const baseParams: Record<string, string> = {
      code: "bad_code",
      shop: TEST_SHOP,
      state,
      timestamp: "1234567890",
    };
    const hmac = computeCallbackHmac(baseParams, API_SECRET);
    const queryParams = { ...baseParams, hmac };

    const fetch = mockFetch([{ ok: false, json: { error: "invalid_request" } }]);

    await expect(
      adapter.completeFlow(
        { code: "bad_code", state, shop: TEST_SHOP, hmac, queryParams },
        fetch as unknown as typeof globalThis.fetch
      )
    ).rejects.toThrow(/Token exchange failed/);
  });
});

describe("ShopifyOAuthAdapter.handleUninstall", () => {
  it("sets credential status to needs_reconnect for the given shop", async () => {
    const store = openStore();
    const adapter = new ShopifyOAuthAdapter(SHOPIFY_CONFIG, store);

    // Create a credential directly in the store
    store.saveCredential({
      shop: TEST_SHOP,
      encryptedPayload: "iv:tag:cipher",
      scope: "read_products",
      status: "connected",
    });

    adapter.handleUninstall(TEST_SHOP);

    const cred = store.getCredentialByShop(TEST_SHOP);
    expect(cred?.status).toBe("needs_reconnect");
  });
});

describe("ShopifyOAuthAdapter.handleShopRedact", () => {
  it("deletes the credential for the given shop", () => {
    const store = openStore();
    const adapter = new ShopifyOAuthAdapter(SHOPIFY_CONFIG, store);

    store.saveCredential({
      shop: TEST_SHOP,
      encryptedPayload: "iv:tag:cipher",
      scope: "read_products",
      status: "connected",
    });

    adapter.handleShopRedact(TEST_SHOP);

    expect(store.getCredentialByShop(TEST_SHOP)).toBeUndefined();
  });
});
