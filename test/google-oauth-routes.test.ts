import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import supertest from "supertest";
import express from "express";
import { createGoogleOAuthRouter } from "../src/google-oauth/routes.js";
import { GatewayGoogleStore } from "../src/google-oauth/store.js";
import { GoogleOAuthAdapter } from "../src/google-oauth/adapter.js";
import { encryptCredential } from "../src/google-oauth/crypto.js";

const TEST_KEY = Buffer.alloc(32, 0x42).toString("base64url");
const BEARER = "test-bearer";

const GOOGLE_CONFIG = {
  clientId: "test-client.apps.googleusercontent.com",
  clientSecret: "test-secret",
  redirectUri: "http://localhost:3000/oauth/google/callback",
  encryptionKey: TEST_KEY
};

let tempDir: string;
let dbPath: string;
let stores: GatewayGoogleStore[];

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-google-routes-"));
  dbPath = path.join(tempDir, "gateway.sqlite");
  stores = [];
  vi.restoreAllMocks();
});

afterEach(() => {
  while (stores.length > 0) stores.pop()?.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function openStore(): GatewayGoogleStore {
  const store = new GatewayGoogleStore(dbPath);
  stores.push(store);
  return store;
}

function buildApp(store: GatewayGoogleStore): express.Express {
  const adapter = new GoogleOAuthAdapter(GOOGLE_CONFIG, store);
  const app = express();
  app.use("/oauth/google", createGoogleOAuthRouter({ config: GOOGLE_CONFIG, adapter, store, bearer: BEARER }));
  return app;
}

function buildDisabledApp(): express.Express {
  const app = express();
  app.use("/oauth/google", createGoogleOAuthRouter({ config: undefined, adapter: undefined, store: undefined, bearer: BEARER }));
  return app;
}

describe("GET /oauth/google/credentials", () => {
  it("returns 401 without auth", async () => {
    const app = buildApp(openStore());
    const res = await supertest(app).get("/oauth/google/credentials");
    expect(res.status).toBe(401);
  });

  it("returns empty array when no credentials exist", async () => {
    const app = buildApp(openStore());
    const res = await supertest(app)
      .get("/oauth/google/credentials")
      .set("Authorization", `Bearer ${BEARER}`);
    expect(res.status).toBe(200);
    expect(res.body.credentials).toEqual([]);
  });

  it("returns saved credentials without encrypted payload", async () => {
    const store = openStore();
    const app = buildApp(store);
    store.saveCredential({
      brandId: "brand_haverford",
      regionId: "region_haverford_au",
      googleAccountEmail: "admin@example.com",
      encryptedPayload: "iv:tag:cipher",
      products: ["ga4"],
      status: "connected"
    });
    const res = await supertest(app)
      .get("/oauth/google/credentials")
      .set("Authorization", `Bearer ${BEARER}`);
    expect(res.status).toBe(200);
    expect(res.body.credentials).toHaveLength(1);
    expect(res.body.credentials[0].googleAccountEmail).toBe("admin@example.com");
    expect(res.body.credentials[0]).not.toHaveProperty("encryptedPayload");
  });
});

describe("POST /oauth/google/start", () => {
  it("returns 400 when products is missing", async () => {
    const app = buildApp(openStore());
    const res = await supertest(app)
      .post("/oauth/google/start")
      .set("Authorization", `Bearer ${BEARER}`)
      .send({ brandId: "b", regionId: "r", bindings: [] });
    expect(res.status).toBe(400);
  });

  it("returns 400 for unknown product", async () => {
    const app = buildApp(openStore());
    const res = await supertest(app)
      .post("/oauth/google/start")
      .set("Authorization", `Bearer ${BEARER}`)
      .send({ brandId: "b", regionId: "r", products: ["bad_product"], bindings: [] });
    expect(res.status).toBe(400);
  });

  it("returns redirectUrl and state for valid input", async () => {
    const app = buildApp(openStore());
    const res = await supertest(app)
      .post("/oauth/google/start")
      .set("Authorization", `Bearer ${BEARER}`)
      .send({
        brandId: "brand_haverford",
        regionId: "region_haverford_au",
        products: ["ga4"],
        bindings: [{ product: "ga4", resourceId: "properties/111" }]
      });
    expect(res.status).toBe(200);
    expect(res.body.redirectUrl).toContain("accounts.google.com");
    expect(typeof res.body.state).toBe("string");
  });
});

describe("GET /oauth/google/callback", () => {
  it("returns 400 when state is missing", async () => {
    const app = buildApp(openStore());
    const res = await supertest(app).get("/oauth/google/callback?code=abc");
    expect(res.status).toBe(400);
  });

  it("returns 400 when state is invalid", async () => {
    const app = buildApp(openStore());
    const res = await supertest(app).get("/oauth/google/callback?code=abc&state=badstate");
    expect(res.status).toBe(400);
  });

  it("exchanges code and returns credential summary on success", async () => {
    const store = openStore();
    const adapter = new GoogleOAuthAdapter(GOOGLE_CONFIG, store);
    const { state } = adapter.startFlow({
      brandId: "brand_haverford",
      regionId: "region_haverford_au",
      products: ["ga4"],
      bindings: [{ product: "ga4", resourceId: "properties/111", resourceName: "Haverford AU" }]
    });

    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          access_token: "ya29.test",
          refresh_token: "1//refresh",
          expires_in: 3600,
          token_type: "Bearer",
          scope: "openid email https://www.googleapis.com/auth/analytics.readonly"
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ email: "admin@example.com", sub: "123" })
      })
    );

    const app = buildApp(store);
    const res = await supertest(app).get(`/oauth/google/callback?code=auth_code&state=${state}`);
    expect(res.status).toBe(200);
    expect(res.body.credential.googleAccountEmail).toBe("admin@example.com");
    expect(res.body.credential).not.toHaveProperty("encryptedPayload");
    expect(res.body.bindings).toHaveLength(1);
  });
});

describe("DELETE /oauth/google/credentials/:id", () => {
  it("returns 404 for unknown credential", async () => {
    const app = buildApp(openStore());
    const res = await supertest(app)
      .delete("/oauth/google/credentials/nonexistent")
      .set("Authorization", `Bearer ${BEARER}`);
    expect(res.status).toBe(404);
  });

  it("deletes a credential", async () => {
    const store = openStore();
    const app = buildApp(store);
    const credId = store.saveCredential({
      brandId: "b", regionId: "r",
      googleAccountEmail: "x@example.com",
      encryptedPayload: "x",
      products: ["ga4"],
      status: "connected"
    });
    const res = await supertest(app)
      .delete(`/oauth/google/credentials/${credId}`)
      .set("Authorization", `Bearer ${BEARER}`);
    expect(res.status).toBe(200);
    expect(store.getCredential(credId)).toBeUndefined();
  });
});

describe("501 when Google OAuth not configured", () => {
  it("returns 501 on all routes", async () => {
    const app = buildDisabledApp();
    const routes = [
      ["GET", "/oauth/google/credentials"],
      ["POST", "/oauth/google/start"],
      ["GET", "/oauth/google/callback"],
      ["DELETE", "/oauth/google/credentials/any_id"]
    ] as const;
    for (const [method, url] of routes) {
      const res = await (supertest(app) as any)[method.toLowerCase()](url)
        .set("Authorization", `Bearer ${BEARER}`);
      expect(res.status, `${method} ${url}`).toBe(501);
    }
  });
});
