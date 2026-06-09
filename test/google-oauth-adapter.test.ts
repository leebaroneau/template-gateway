import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GoogleOAuthAdapter } from "../src/google-oauth/adapter.js";
import { GatewayGoogleStore } from "../src/google-oauth/store.js";

const TEST_KEY = Buffer.alloc(32, 0x42).toString("base64url");

const GOOGLE_CONFIG = {
  clientId: "test-client-id.apps.googleusercontent.com",
  clientSecret: "test-client-secret",
  redirectUri: "http://localhost:3000/oauth/google/callback",
  encryptionKey: TEST_KEY
};

let tempDir: string;
let dbPath: string;
let stores: GatewayGoogleStore[];

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-adapter-"));
  dbPath = path.join(tempDir, "gateway.sqlite");
  stores = [];
});

afterEach(() => {
  while (stores.length > 0) stores.pop()?.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function openStore(): GatewayGoogleStore {
  const store = new GatewayGoogleStore(dbPath);
  stores.push(store);
  return store;
}

describe("GoogleOAuthAdapter.startFlow", () => {
  it("returns a Google authorization URL with required params", () => {
    const store = openStore();
    const adapter = new GoogleOAuthAdapter(GOOGLE_CONFIG, store);
    const result = adapter.startFlow({
      brandId: "brand_haverford",
      regionId: "region_haverford_au",
      products: ["ga4", "gsc"],
      bindings: [
        { product: "ga4", resourceId: "properties/111" },
        { product: "gsc", resourceId: "https://haverford.au/" }
      ]
    });
    const url = new URL(result.redirectUrl);
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.pathname).toBe("/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe(GOOGLE_CONFIG.clientId);
    expect(url.searchParams.get("redirect_uri")).toBe(GOOGLE_CONFIG.redirectUri);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("state")).toBe(result.state);
    const scope = url.searchParams.get("scope") ?? "";
    expect(scope).toContain("openid");
    expect(scope).toContain("email");
    expect(scope).toContain("analytics.readonly");
    expect(scope).toContain("webmasters.readonly");
  });

  it("saves the state to the store", () => {
    const store = openStore();
    const adapter = new GoogleOAuthAdapter(GOOGLE_CONFIG, store);
    const result = adapter.startFlow({
      brandId: "brand_haverford",
      regionId: "region_haverford_au",
      products: ["ga4"],
      bindings: [{ product: "ga4", resourceId: "properties/111" }]
    });
    const saved = store.getOAuthState(result.state);
    expect(saved).not.toBeUndefined();
    expect(saved?.brandId).toBe("brand_haverford");
    expect(saved?.products).toEqual(["ga4"]);
  });
});

describe("GoogleOAuthAdapter.completeFlow", () => {
  function mockFetch(responses: Array<{ ok: boolean; json: unknown }>): typeof fetch {
    let callIndex = 0;
    return vi.fn().mockImplementation(() => {
      const response = responses[callIndex++];
      return Promise.resolve({
        ok: response.ok,
        json: () => Promise.resolve(response.json),
        text: () => Promise.resolve(JSON.stringify(response.json))
      });
    }) as unknown as typeof fetch;
  }

  it("exchanges code for tokens and stores an encrypted credential", async () => {
    const store = openStore();
    const adapter = new GoogleOAuthAdapter(GOOGLE_CONFIG, store);

    const { state } = adapter.startFlow({
      brandId: "brand_haverford",
      regionId: "region_haverford_au",
      products: ["ga4"],
      bindings: [{ product: "ga4", resourceId: "properties/111", resourceName: "Haverford AU" }]
    });

    const fetchFn = mockFetch([
      {
        ok: true,
        json: {
          access_token: "ya29.test_access",
          refresh_token: "1//test_refresh",
          expires_in: 3600,
          token_type: "Bearer",
          scope: "openid email https://www.googleapis.com/auth/analytics.readonly"
        }
      },
      {
        ok: true,
        json: { email: "admin@example.com", sub: "123456789" }
      }
    ]);

    const result = await adapter.completeFlow({ code: "auth_code_xyz", state }, fetchFn);
    expect(result.credential.googleAccountEmail).toBe("admin@example.com");
    expect(result.credential.status).toBe("connected");
    expect(result.credential.products).toEqual(["ga4"]);
    expect(result.bindings).toHaveLength(1);
    expect(result.bindings[0].product).toBe("ga4");
    expect(result.bindings[0].resourceId).toBe("properties/111");
  });

  it("throws if state is missing or expired", async () => {
    const store = openStore();
    const adapter = new GoogleOAuthAdapter(GOOGLE_CONFIG, store);
    await expect(adapter.completeFlow({ code: "code", state: "nonexistent" }, fetch)).rejects.toThrow(/Invalid or expired OAuth state/);
  });

  it("throws if token exchange fails", async () => {
    const store = openStore();
    const adapter = new GoogleOAuthAdapter(GOOGLE_CONFIG, store);
    const { state } = adapter.startFlow({
      brandId: "b",
      regionId: "r",
      products: ["ga4"],
      bindings: []
    });
    const fetchFn = mockFetch([{ ok: false, json: { error: "invalid_grant" } }]);
    await expect(adapter.completeFlow({ code: "bad_code", state }, fetchFn)).rejects.toThrow(/Token exchange failed/);
  });
});

describe("GoogleOAuthAdapter.refreshTokenIfNeeded", () => {
  it("returns false (no refresh needed) when token is not close to expiry", async () => {
    const store = openStore();
    const adapter = new GoogleOAuthAdapter(GOOGLE_CONFIG, store);
    const farFuture = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const credId = store.saveCredential({
      brandId: "b", regionId: "r",
      googleAccountEmail: "x@example.com",
      encryptedPayload: "iv:tag:cipher",
      tokenExpiryAt: farFuture,
      products: ["ga4"],
      status: "connected"
    });
    const refreshed = await adapter.refreshTokenIfNeeded(credId, vi.fn() as unknown as typeof fetch);
    expect(refreshed).toBe(false);
  });

  it("returns true and updates payload when token is about to expire", async () => {
    const store = openStore();
    const adapter = new GoogleOAuthAdapter(GOOGLE_CONFIG, store);
    const { encryptCredential: enc } = await import("../src/google-oauth/crypto.js");
    const encryptedPayload = enc({
      accessToken: "ya29.old",
      refreshToken: "1//refresh_token",
      tokenExpiryAt: new Date(Date.now() + 60 * 1000).toISOString(),
      scope: "openid email",
      googleAccountEmail: "x@example.com"
    }, TEST_KEY);
    const credId = store.saveCredential({
      brandId: "b", regionId: "r",
      googleAccountEmail: "x@example.com",
      encryptedPayload,
      tokenExpiryAt: new Date(Date.now() + 60 * 1000).toISOString(),
      products: ["ga4"],
      status: "connected"
    });
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        access_token: "ya29.new",
        expires_in: 3600,
        token_type: "Bearer",
        scope: "openid email"
      })
    }) as unknown as typeof fetch;
    const refreshed = await adapter.refreshTokenIfNeeded(credId, fetchFn);
    expect(refreshed).toBe(true);
    expect(vi.mocked(fetchFn)).toHaveBeenCalledOnce();
  });
});
