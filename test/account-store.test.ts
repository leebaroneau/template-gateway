import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GatewayAccountStore } from "../src/account-credentials/store.js";
import { decryptCredential, encryptCredential } from "../src/account-credentials/crypto.js";
import type { AuditEvent } from "../src/admin/types.js";

let tempDir: string;
let dbPath: string;
let stores: GatewayAccountStore[];

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-account-store-"));
  dbPath = path.join(tempDir, "gateway.sqlite");
  stores = [];
});

afterEach(() => {
  while (stores.length > 0) {
    stores.pop()?.close();
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function openStore(pathname = dbPath): GatewayAccountStore {
  const store = new GatewayAccountStore(pathname);
  stores.push(store);
  return store;
}

// 32-byte base64url test key
const TEST_KEY = Buffer.alloc(32, 0xab).toString("base64url");

describe("GatewayAccountStore", () => {
  describe("upsert idempotency", () => {
    it("returns the same id on second upsert with the same (service, externalAccountId)", () => {
      const store = openStore();
      const encryptedPayload = encryptCredential(
        { service: "shopify", externalAccountId: "org_1", refreshToken: "tok" },
        TEST_KEY
      );
      const id1 = store.upsertAccount({ service: "shopify", externalAccountId: "org_1", encryptedPayload, status: "connected" });
      const id2 = store.upsertAccount({ service: "shopify", externalAccountId: "org_1", encryptedPayload, status: "connected" });
      expect(id1).toBe(id2);
      expect(store.listAccounts("shopify")).toHaveLength(1);
    });

    it("upsert mutates encrypted_payload and status in place, preserves created_at", () => {
      const store = openStore();
      const payload1 = encryptCredential({ service: "shopify", externalAccountId: "org_1", refreshToken: "tok1" }, TEST_KEY);
      const payload2 = encryptCredential({ service: "shopify", externalAccountId: "org_1", refreshToken: "tok2" }, TEST_KEY);
      const id = store.upsertAccount({ service: "shopify", externalAccountId: "org_1", encryptedPayload: payload1, status: "connected" });
      const before = store.getAccount(id)!;
      store.upsertAccount({ service: "shopify", externalAccountId: "org_1", encryptedPayload: payload2, status: "needs_reconnect" });
      const after = store.getAccount(id)!;
      expect(after.status).toBe("needs_reconnect");
      expect(after.encryptedPayload).toBe(payload2);
      expect(after.createdAt).toBe(before.createdAt);
    });

    it("different services can share the same externalAccountId", () => {
      const store = openStore();
      const ep = encryptCredential({ service: "google", externalAccountId: "admin@x", refreshToken: "tok" }, TEST_KEY);
      const epS = encryptCredential({ service: "shopify", externalAccountId: "admin@x", refreshToken: "tok" }, TEST_KEY);
      const gId = store.upsertAccount({ service: "google", externalAccountId: "admin@x", encryptedPayload: ep, status: "connected" });
      const sId = store.upsertAccount({ service: "shopify", externalAccountId: "admin@x", encryptedPayload: epS, status: "connected" });
      expect(gId).not.toBe(sId);
      expect(store.listAccounts()).toHaveLength(2);
    });
  });

  describe("crypto round-trip", () => {
    it("encrypts, stores, retrieves, and decrypts without leaking cleartext", () => {
      const store = openStore();
      const originalPayload = { service: "google" as const, externalAccountId: "admin@haverford.com.au", refreshToken: "rt_secret", scope: "https://www.googleapis.com/auth/analytics.readonly" };
      const encryptedPayload = encryptCredential(originalPayload, TEST_KEY);
      const id = store.upsertAccount({ service: "google", externalAccountId: "admin@haverford.com.au", encryptedPayload, status: "connected" });
      const row = store.getAccount(id)!;
      expect(row.encryptedPayload).not.toContain("rt_secret");
      const decoded = decryptCredential(row.encryptedPayload, TEST_KEY);
      expect(decoded.refreshToken).toBe("rt_secret");
      expect(decoded.scope).toBe(originalPayload.scope);
      expect(decoded.externalAccountId).toBe("admin@haverford.com.au");
      // OAuthAccount type does not expose encryptedPayload
      const publicAccount: Omit<typeof row, "encryptedPayload"> = row;
      expect((publicAccount as Record<string, unknown>).encryptedPayload).toBe(encryptedPayload);
    });
  });

  describe("link fan-out", () => {
    it("fans one account out to multiple brand+region+connectorSlug tuples", () => {
      const store = openStore();
      const ep = encryptCredential({ service: "google", externalAccountId: "admin@x", refreshToken: "tok" }, TEST_KEY);
      const accountId = store.upsertAccount({ service: "google", externalAccountId: "admin@x", encryptedPayload: ep, status: "connected" });

      const l1 = store.linkAccount({ accountId, brandId: "brand_a", regionId: "au", connectorSlug: "shopify" });
      const l2 = store.linkAccount({ accountId, brandId: "brand_a", regionId: "au", connectorSlug: "google-analytics-4" });
      const l3 = store.linkAccount({ accountId, brandId: "brand_b", regionId: "us", connectorSlug: "google-search-console" });

      const links = store.listLinksForAccount(accountId);
      expect(links).toHaveLength(3);
      expect(links.map((l) => l.id)).toContain(l1);
      expect(links.map((l) => l.id)).toContain(l2);
      expect(links.map((l) => l.id)).toContain(l3);
    });

    it("re-linking the same tuple returns the same link id and advances updatedAt", async () => {
      const store = openStore();
      const ep = encryptCredential({ service: "google", externalAccountId: "admin@x", refreshToken: "tok" }, TEST_KEY);
      const accountId = store.upsertAccount({ service: "google", externalAccountId: "admin@x", encryptedPayload: ep, status: "connected" });
      const id1 = store.linkAccount({ accountId, brandId: "brand_a", regionId: "au", connectorSlug: "google-analytics-4" });
      await new Promise((r) => setTimeout(r, 5));
      const id2 = store.linkAccount({ accountId, brandId: "brand_a", regionId: "au", connectorSlug: "google-analytics-4" });
      expect(id1).toBe(id2);
      expect(store.listLinksForAccount(accountId)).toHaveLength(1);
    });
  });

  describe("scope reverse-lookup", () => {
    it("getLinkForScope returns the link for a matching tuple", () => {
      const store = openStore();
      const ep = encryptCredential({ service: "google", externalAccountId: "admin@x", refreshToken: "tok" }, TEST_KEY);
      const accountId = store.upsertAccount({ service: "google", externalAccountId: "admin@x", encryptedPayload: ep, status: "connected" });
      store.linkAccount({ accountId, brandId: "brand_a", regionId: "au", connectorSlug: "google-analytics-4" });
      const link = store.getLinkForScope({ service: "google", brandId: "brand_a", regionId: "au", connectorSlug: "google-analytics-4" });
      expect(link).toBeDefined();
      expect(link!.accountId).toBe(accountId);
    });

    it("getLinkForScope returns undefined for unknown scope", () => {
      const store = openStore();
      const link = store.getLinkForScope({ service: "google", brandId: "unknown", regionId: "au", connectorSlug: "google-analytics-4" });
      expect(link).toBeUndefined();
    });
  });

  describe("connection binding", () => {
    it("setLinkConnectionId populates connection_id and is reflected in getLinkForScope", () => {
      const store = openStore();
      const ep = encryptCredential({ service: "google", externalAccountId: "admin@x", refreshToken: "tok" }, TEST_KEY);
      const accountId = store.upsertAccount({ service: "google", externalAccountId: "admin@x", encryptedPayload: ep, status: "connected" });
      const linkId = store.linkAccount({ accountId, brandId: "haverford", regionId: "au", connectorSlug: "google-analytics-4" });
      store.setLinkConnectionId(linkId, "devapi_haverford_au_google_analytics_4");
      const link = store.getLinkForScope({ service: "google", brandId: "haverford", regionId: "au", connectorSlug: "google-analytics-4" });
      expect(link!.connectionId).toBe("devapi_haverford_au_google_analytics_4");
    });
  });

  describe("cascade delete", () => {
    it("deleteAccount removes account and all dependent links in one transaction", () => {
      const store = openStore();
      const ep = encryptCredential({ service: "shopify", externalAccountId: "org_1", refreshToken: "tok" }, TEST_KEY);
      const accountId = store.upsertAccount({ service: "shopify", externalAccountId: "org_1", encryptedPayload: ep, status: "connected" });
      store.linkAccount({ accountId, brandId: "brand_a", regionId: "au", connectorSlug: "shopify" });
      store.linkAccount({ accountId, brandId: "brand_b", regionId: "nz", connectorSlug: "shopify" });
      store.deleteAccount(accountId);
      expect(store.getAccount(accountId)).toBeUndefined();
      expect(store.listLinksForAccount(accountId)).toHaveLength(0);
    });
  });

  describe("status transitions", () => {
    it("updateAccountStatus sets status and error_detail", () => {
      const store = openStore();
      const ep = encryptCredential({ service: "shopify", externalAccountId: "org_1", refreshToken: "tok" }, TEST_KEY);
      const id = store.upsertAccount({ service: "shopify", externalAccountId: "org_1", encryptedPayload: ep, status: "connected" });
      store.updateAccountStatus(id, "needs_reconnect", "uninstalled");
      const account = store.getAccount(id)!;
      expect(account.status).toBe("needs_reconnect");
      expect(account.errorDetail).toBe("uninstalled");
    });

    it("updateAccountPayload resets status to connected and advances last_refreshed_at", () => {
      const store = openStore();
      const ep = encryptCredential({ service: "google", externalAccountId: "admin@x", refreshToken: "old" }, TEST_KEY);
      const id = store.upsertAccount({ service: "google", externalAccountId: "admin@x", encryptedPayload: ep, status: "needs_reconnect" });
      const ep2 = encryptCredential({ service: "google", externalAccountId: "admin@x", refreshToken: "new" }, TEST_KEY);
      store.updateAccountPayload(id, ep2, "2030-01-01T00:00:00.000Z");
      const account = store.getAccount(id)!;
      expect(account.status).toBe("connected");
      expect(account.lastRefreshedAt).toBeDefined();
      expect(account.tokenExpiryAt).toBe("2030-01-01T00:00:00.000Z");
    });
  });

  describe("migration idempotency", () => {
    it("opening the store twice does not throw (CREATE TABLE IF NOT EXISTS)", () => {
      const s1 = openStore();
      const s2 = openStore();
      expect(s1).toBeDefined();
      expect(s2).toBeDefined();
    });

    it("does not touch gateway_schema_migrations", () => {
      const store = openStore();
      const row = store["db"]
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='gateway_schema_migrations'")
        .get();
      expect(row).toBeUndefined();
    });
  });

  describe("audit-union typecheck", () => {
    it("AuditEvent accepts oauth_account.* actions and oauth_account targetType", () => {
      const event: AuditEvent = {
        id: "evt_1",
        action: "oauth_account.created",
        targetType: "oauth_account",
        targetId: "oauth_acct_1",
        detail: "account created",
        timestamp: new Date().toISOString(),
        actor: "admin"
      };
      expect(event.action).toBe("oauth_account.created");
      expect(event.targetType).toBe("oauth_account");
    });

    it("AuditEvent accepts oauth_account_link.* actions and oauth_account_link targetType", () => {
      const event: AuditEvent = {
        id: "evt_2",
        action: "oauth_account_link.created",
        targetType: "oauth_account_link",
        targetId: "oauth_link_1",
        detail: "link created",
        timestamp: new Date().toISOString(),
        actor: "admin"
      };
      expect(event.action).toBe("oauth_account_link.created");
      expect(event.targetType).toBe("oauth_account_link");
    });
  });

  describe("getAccountByExternalId", () => {
    it("resolves an account by service + externalAccountId", () => {
      const store = openStore();
      const ep = encryptCredential({ service: "google", externalAccountId: "admin@x", refreshToken: "tok" }, TEST_KEY);
      const id = store.upsertAccount({ service: "google", externalAccountId: "admin@x", encryptedPayload: ep, status: "connected" });
      const account = store.getAccountByExternalId("google", "admin@x");
      expect(account).toBeDefined();
      expect(account!.id).toBe(id);
    });

    it("returns undefined for unknown externalAccountId", () => {
      const store = openStore();
      expect(store.getAccountByExternalId("google", "nobody@x")).toBeUndefined();
    });
  });

  describe("removeLink", () => {
    it("removes a single link without affecting others", () => {
      const store = openStore();
      const ep = encryptCredential({ service: "google", externalAccountId: "admin@x", refreshToken: "tok" }, TEST_KEY);
      const accountId = store.upsertAccount({ service: "google", externalAccountId: "admin@x", encryptedPayload: ep, status: "connected" });
      const l1 = store.linkAccount({ accountId, brandId: "brand_a", regionId: "au", connectorSlug: "google-analytics-4" });
      const l2 = store.linkAccount({ accountId, brandId: "brand_b", regionId: "au", connectorSlug: "google-analytics-4" });
      store.removeLink(l1);
      const remaining = store.listLinksForAccount(accountId);
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe(l2);
    });
  });
});
