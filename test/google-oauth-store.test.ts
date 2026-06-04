import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GatewayGoogleStore } from "../src/google-oauth/store.js";
import type { GoogleOAuthState } from "../src/google-oauth/types.js";

let tempDir: string;
let dbPath: string;
let stores: GatewayGoogleStore[];

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-google-store-"));
  dbPath = path.join(tempDir, "gateway.sqlite");
  stores = [];
});

afterEach(() => {
  while (stores.length > 0) stores.pop()?.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function openStore(pathname = dbPath): GatewayGoogleStore {
  const store = new GatewayGoogleStore(pathname);
  stores.push(store);
  return store;
}

describe("GatewayGoogleStore", () => {
  describe("OAuth states", () => {
    it("saves and retrieves a state", () => {
      const store = openStore();
      const oauthState: GoogleOAuthState = {
        state: "nonce_abc123",
        brandId: "brand_haverford",
        regionId: "region_haverford_au",
        products: ["ga4", "gsc"],
        bindings: [
          { product: "ga4", resourceId: "properties/12345", resourceName: "Haverford AU" },
          { product: "gsc", resourceId: "https://haverford.au/" }
        ],
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
      };
      store.saveOAuthState(oauthState);
      const retrieved = store.getOAuthState("nonce_abc123");
      expect(retrieved).toEqual(oauthState);
    });

    it("returns undefined for missing state", () => {
      const store = openStore();
      expect(store.getOAuthState("nonexistent")).toBeUndefined();
    });

    it("deletes a state after retrieval", () => {
      const store = openStore();
      const oauthState: GoogleOAuthState = {
        state: "nonce_del",
        brandId: "b",
        regionId: "r",
        products: ["ga4"],
        bindings: [],
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
      };
      store.saveOAuthState(oauthState);
      store.deleteOAuthState("nonce_del");
      expect(store.getOAuthState("nonce_del")).toBeUndefined();
    });
  });

  describe("credentials", () => {
    it("saves and retrieves a credential", () => {
      const store = openStore();
      const id = store.saveCredential({
        brandId: "brand_haverford",
        regionId: "region_haverford_au",
        googleAccountEmail: "admin@example.com",
        encryptedPayload: "iv:tag:cipher",
        tokenExpiryAt: "2026-06-05T00:00:00.000Z",
        products: ["ga4", "gsc"],
        status: "connected"
      });
      const cred = store.getCredential(id);
      expect(cred).not.toBeUndefined();
      expect(cred?.googleAccountEmail).toBe("admin@example.com");
      expect(cred?.products).toEqual(["ga4", "gsc"]);
      expect(cred?.status).toBe("connected");
    });

    it("lists all credentials", () => {
      const store = openStore();
      store.saveCredential({
        brandId: "brand_haverford",
        regionId: "region_haverford_au",
        googleAccountEmail: "a@example.com",
        encryptedPayload: "a",
        products: ["ga4"],
        status: "connected"
      });
      store.saveCredential({
        brandId: "brand_catnets",
        regionId: "region_catnets_au",
        googleAccountEmail: "b@example.com",
        encryptedPayload: "b",
        products: ["gsc"],
        status: "needs_reconnect"
      });
      expect(store.listCredentials()).toHaveLength(2);
    });

    it("updates credential status", () => {
      const store = openStore();
      const id = store.saveCredential({
        brandId: "b",
        regionId: "r",
        googleAccountEmail: "x@example.com",
        encryptedPayload: "x",
        products: ["ga4"],
        status: "connected"
      });
      store.updateCredentialStatus(id, "needs_reconnect", "token expired");
      expect(store.getCredential(id)?.status).toBe("needs_reconnect");
      expect(store.getCredential(id)?.errorDetail).toBe("token expired");
    });

    it("updates encrypted payload on refresh", () => {
      const store = openStore();
      const id = store.saveCredential({
        brandId: "b",
        regionId: "r",
        googleAccountEmail: "x@example.com",
        encryptedPayload: "old",
        products: ["ga4"],
        status: "connected"
      });
      store.updateCredentialPayload(id, "new_encrypted", "2026-06-06T00:00:00.000Z");
      const cred = store.getCredential(id);
      expect(cred?.encryptedPayload).toBe("new_encrypted");
      expect(cred?.tokenExpiryAt).toBe("2026-06-06T00:00:00.000Z");
    });

    it("deletes a credential and its bindings", () => {
      const store = openStore();
      const credId = store.saveCredential({
        brandId: "b",
        regionId: "r",
        googleAccountEmail: "x@example.com",
        encryptedPayload: "x",
        products: ["ga4"],
        status: "connected"
      });
      store.saveBinding({ credentialId: credId, connectionId: "conn_1", product: "ga4", resourceId: "properties/1" });
      store.deleteCredential(credId);
      expect(store.getCredential(credId)).toBeUndefined();
      expect(store.listBindingsForCredential(credId)).toHaveLength(0);
    });

    it("survives close and reopen", () => {
      let store = openStore();
      const id = store.saveCredential({
        brandId: "b",
        regionId: "r",
        googleAccountEmail: "persist@example.com",
        encryptedPayload: "payload",
        products: ["ga4"],
        status: "connected"
      });
      store.close();
      stores = stores.filter((s) => s !== store);

      store = openStore();
      expect(store.getCredential(id)?.googleAccountEmail).toBe("persist@example.com");
    });
  });

  describe("bindings", () => {
    it("saves and lists bindings for a credential", () => {
      const store = openStore();
      const credId = store.saveCredential({
        brandId: "b",
        regionId: "r",
        googleAccountEmail: "x@example.com",
        encryptedPayload: "x",
        products: ["ga4", "gsc"],
        status: "connected"
      });
      store.saveBinding({ credentialId: credId, connectionId: "conn_1", product: "ga4", resourceId: "properties/111", resourceName: "Haverford AU" });
      store.saveBinding({ credentialId: credId, connectionId: "conn_2", product: "gsc", resourceId: "https://haverford.au/" });
      const bindings = store.listBindingsForCredential(credId);
      expect(bindings).toHaveLength(2);
      expect(bindings.map((b) => b.product).sort()).toEqual(["ga4", "gsc"]);
    });
  });
});
