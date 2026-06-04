import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GatewayShopifyStore } from "../src/shopify-oauth/store.js";

let tempDir: string;
let dbPath: string;
let stores: GatewayShopifyStore[];

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-shopify-store-"));
  dbPath = path.join(tempDir, "gateway.sqlite");
  stores = [];
});

afterEach(() => {
  while (stores.length > 0) stores.pop()?.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function openStore(pathname = dbPath): GatewayShopifyStore {
  const store = new GatewayShopifyStore(pathname);
  stores.push(store);
  return store;
}

describe("GatewayShopifyStore", () => {
  describe("OAuth states", () => {
    it("saves and retrieves a state with correct shape", () => {
      const store = openStore();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      store.saveOAuthState({
        state: "nonce_abc123",
        shop: "my-shop.myshopify.com",
        scopes: ["read_products", "write_orders"],
        expiresAt
      });
      const retrieved = store.getOAuthState("nonce_abc123");
      expect(retrieved).not.toBeUndefined();
      expect(retrieved?.state).toBe("nonce_abc123");
      expect(retrieved?.shop).toBe("my-shop.myshopify.com");
      expect(retrieved?.scopes).toEqual(["read_products", "write_orders"]);
      expect(retrieved?.expiresAt).toBe(expiresAt);
      expect(typeof retrieved?.createdAt).toBe("string");
    });

    it("returns undefined for missing state", () => {
      const store = openStore();
      expect(store.getOAuthState("nonexistent")).toBeUndefined();
    });

    it("deletes a state", () => {
      const store = openStore();
      store.saveOAuthState({
        state: "nonce_del",
        shop: "my-shop.myshopify.com",
        scopes: ["read_products"],
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
      });
      store.deleteOAuthState("nonce_del");
      expect(store.getOAuthState("nonce_del")).toBeUndefined();
    });

    it("pruneExpiredStates removes expired but not future states", () => {
      const store = openStore();
      // expired state
      store.saveOAuthState({
        state: "expired_nonce",
        shop: "expired.myshopify.com",
        scopes: ["read_products"],
        expiresAt: new Date(Date.now() - 1000).toISOString()
      });
      // future state
      store.saveOAuthState({
        state: "future_nonce",
        shop: "future.myshopify.com",
        scopes: ["read_products"],
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
      });
      store.pruneExpiredStates();
      expect(store.getOAuthState("expired_nonce")).toBeUndefined();
      expect(store.getOAuthState("future_nonce")).not.toBeUndefined();
    });
  });

  describe("credentials", () => {
    it("saveCredential returns an id", () => {
      const store = openStore();
      const id = store.saveCredential({
        shop: "my-shop.myshopify.com",
        encryptedPayload: "iv:tag:cipher",
        scope: "read_products,write_orders",
        status: "connected"
      });
      expect(typeof id).toBe("string");
      expect(id.startsWith("shopify_cred_")).toBe(true);
    });

    it("getCredential returns correct shape including encryptedPayload", () => {
      const store = openStore();
      const id = store.saveCredential({
        shop: "my-shop.myshopify.com",
        encryptedPayload: "iv:tag:cipher",
        scope: "read_products,write_orders",
        status: "connected"
      });
      const cred = store.getCredential(id);
      expect(cred).not.toBeUndefined();
      expect(cred?.id).toBe(id);
      expect(cred?.shop).toBe("my-shop.myshopify.com");
      expect(cred?.encryptedPayload).toBe("iv:tag:cipher");
      expect(cred?.scope).toBe("read_products,write_orders");
      expect(cred?.status).toBe("connected");
      expect(typeof cred?.createdAt).toBe("string");
      expect(typeof cred?.updatedAt).toBe("string");
    });

    it("listCredentials returns array of credentials", () => {
      const store = openStore();
      store.saveCredential({
        shop: "shop-a.myshopify.com",
        encryptedPayload: "a",
        scope: "read_products",
        status: "connected"
      });
      store.saveCredential({
        shop: "shop-b.myshopify.com",
        encryptedPayload: "b",
        scope: "write_orders",
        status: "needs_reconnect"
      });
      const list = store.listCredentials();
      expect(list).toHaveLength(2);
      expect(list.map((c) => c.shop).sort()).toEqual([
        "shop-a.myshopify.com",
        "shop-b.myshopify.com"
      ]);
    });

    it("updateCredentialStatus by id", () => {
      const store = openStore();
      const id = store.saveCredential({
        shop: "my-shop.myshopify.com",
        encryptedPayload: "x",
        scope: "read_products",
        status: "connected"
      });
      store.updateCredentialStatus(id, "error", "token revoked");
      const cred = store.getCredential(id);
      expect(cred?.status).toBe("error");
      expect(cred?.errorDetail).toBe("token revoked");
    });

    it("deleteCredential removes the credential", () => {
      const store = openStore();
      const id = store.saveCredential({
        shop: "my-shop.myshopify.com",
        encryptedPayload: "x",
        scope: "read_products",
        status: "connected"
      });
      store.deleteCredential(id);
      expect(store.getCredential(id)).toBeUndefined();
    });

    it("survives close and reopen (data persists)", () => {
      let store = openStore();
      const id = store.saveCredential({
        shop: "persist.myshopify.com",
        encryptedPayload: "persistent_payload",
        scope: "read_products",
        status: "connected"
      });
      store.close();
      stores = stores.filter((s) => s !== store);

      store = openStore();
      const cred = store.getCredential(id);
      expect(cred?.shop).toBe("persist.myshopify.com");
      expect(cred?.encryptedPayload).toBe("persistent_payload");
    });
  });

  describe("UNIQUE(shop) reinstall semantics", () => {
    it("second save for same shop produces different id and only one credential in list", () => {
      const store = openStore();
      const id1 = store.saveCredential({
        shop: "reinstall.myshopify.com",
        encryptedPayload: "first_payload",
        scope: "read_products",
        status: "connected"
      });
      const id2 = store.saveCredential({
        shop: "reinstall.myshopify.com",
        encryptedPayload: "second_payload",
        scope: "read_products,write_orders",
        status: "connected"
      });
      expect(id2).not.toBe(id1);
      const list = store.listCredentials();
      expect(list).toHaveLength(1);
      expect(list[0].shop).toBe("reinstall.myshopify.com");
      expect(list[0].encryptedPayload).toBe("second_payload");
    });
  });

  describe("getCredentialByShop", () => {
    it("returns credential for known shop", () => {
      const store = openStore();
      const id = store.saveCredential({
        shop: "lookup.myshopify.com",
        encryptedPayload: "payload",
        scope: "read_products",
        status: "connected"
      });
      const cred = store.getCredentialByShop("lookup.myshopify.com");
      expect(cred).not.toBeUndefined();
      expect(cred?.id).toBe(id);
      expect(cred?.shop).toBe("lookup.myshopify.com");
    });

    it("returns undefined for unknown shop", () => {
      const store = openStore();
      expect(store.getCredentialByShop("unknown.myshopify.com")).toBeUndefined();
    });
  });

  describe("updateCredentialStatus by shop", () => {
    it("updates status when only shop is known (not id)", () => {
      const store = openStore();
      store.saveCredential({
        shop: "update-by-shop.myshopify.com",
        encryptedPayload: "payload",
        scope: "read_products",
        status: "connected"
      });
      store.updateCredentialStatus("update-by-shop.myshopify.com", "needs_reconnect", "access revoked");
      const cred = store.getCredentialByShop("update-by-shop.myshopify.com");
      expect(cred?.status).toBe("needs_reconnect");
      expect(cred?.errorDetail).toBe("access revoked");
    });
  });

  describe("deleteCredentialByShop", () => {
    it("removes credential by shop", () => {
      const store = openStore();
      store.saveCredential({
        shop: "delete-by-shop.myshopify.com",
        encryptedPayload: "payload",
        scope: "read_products",
        status: "connected"
      });
      store.deleteCredentialByShop("delete-by-shop.myshopify.com");
      expect(store.getCredentialByShop("delete-by-shop.myshopify.com")).toBeUndefined();
      expect(store.listCredentials()).toHaveLength(0);
    });
  });
});
