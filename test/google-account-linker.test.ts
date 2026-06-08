import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GatewayAccountStore } from "../src/account-credentials/store.js";
import { encryptCredential as encryptAccountCredential } from "../src/account-credentials/crypto.js";
import { GatewayGoogleStore } from "../src/google-oauth/store.js";
import { GoogleOAuthAdapter, type GoogleOAuthConfig } from "../src/google-oauth/adapter.js";
import { GoogleAccountLinker } from "../src/google-oauth/linker.js";
import type { GatewayConnectionBackend, GatewayState, Connector, Connection } from "../src/admin/types.js";
import type { OAuthAccountTokenPayload } from "../src/account-credentials/types.js";

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
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-linker-"));
  dbPath = path.join(tempDir, "gateway.sqlite");
  allStores = [];
});

afterEach(() => {
  while (allStores.length > 0) allStores.pop()?.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function openAccountStore(): GatewayAccountStore {
  const s = new GatewayAccountStore(dbPath);
  allStores.push(s);
  return s;
}

function openGoogleStore(): GatewayGoogleStore {
  const s = new GatewayGoogleStore(dbPath);
  allStores.push(s);
  return s;
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

function makeConnection(
  connectorSlug: string,
  brandId: string,
  regionId: string,
  configSummary: Record<string, string>
): Connection {
  const idPart = connectorSlug.replace(/-/g, "_");
  const brandPart = brandId.replace(/^brand_/, "");
  const regionPart = regionId.replace(/^region_[^_]+_/, "");
  return {
    id: `devapi_${brandPart}_${regionPart}_${idPart}`,
    brandId,
    regionId,
    connectorId: `connector_${idPart}`,
    backendType: "native",
    displayName: `${brandPart} ${regionPart} ${connectorSlug}`,
    status: "connected",
    configSummary
  };
}

function makeBackend(connections: Connection[], extraConnectors: Connector[] = []): GatewayConnectionBackend {
  const baseConnectors: Connector[] = [
    makeConnector("google-analytics-4"),
    makeConnector("google-search-console"),
    makeConnector("google-ads"),
    makeConnector("merchant-center"),
    ...extraConnectors
  ];
  const state: GatewayState = {
    brands: [],
    regions: [],
    connectors: baseConnectors,
    connections,
    apiClients: [],
    auditEvents: []
  };
  return { snapshot: () => state } as unknown as GatewayConnectionBackend;
}

function seedAccount(accountStore: GatewayAccountStore): string {
  const payload: OAuthAccountTokenPayload = {
    service: "google",
    externalAccountId: "admin@haverford.com.au",
    refreshToken: "rt_test_secret",
    accessToken: "ya29.test",
    scope: "analytics.readonly"
  };
  const ep = encryptAccountCredential(payload, TEST_KEY);
  return accountStore.upsertAccount({
    service: "google",
    externalAccountId: "admin@haverford.com.au",
    encryptedPayload: ep,
    status: "connected"
  });
}

function makeStubFetch(accessToken = "ya29.fresh", expiresIn = 3600): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ access_token: accessToken, expires_in: expiresIn, scope: "analytics.readonly", token_type: "Bearer" })
  }) as unknown as typeof fetch;
}

describe("GoogleAccountLinker", () => {
  describe("buildPlan — id derivation per product", () => {
    it("derives resourceId from the correct configSummary key per connector slug", async () => {
      const accountStore = openAccountStore();
      const googleStore = openGoogleStore();
      const adapter = new GoogleOAuthAdapter(GOOGLE_CONFIG, googleStore);
      const accountId = seedAccount(accountStore);

      const connections: Connection[] = [
        makeConnection("google-analytics-4", "brand_hav", "region_hav_au", { property_id: "properties/123" }),
        makeConnection("google-search-console", "brand_hav", "region_hav_au", { site_url: "https://hav.com" }),
        makeConnection("google-ads", "brand_hav", "region_hav_au", { customer_id: "123-456-7890" }),
        makeConnection("merchant-center", "brand_hav", "region_hav_au", { merchant_center_id: "9876543" })
      ];

      const linker = new GoogleAccountLinker(makeBackend(connections), accountStore, googleStore, adapter);
      const plan = await linker.buildPlan(accountId);

      expect(plan.entries).toHaveLength(4);
      const ga4 = plan.entries.find((e) => e.connectorSlug === "google-analytics-4")!;
      expect(ga4.product).toBe("ga4");
      expect(ga4.resourceId).toBe("properties/123");
      expect(ga4.status).toBe("proposed");

      const gsc = plan.entries.find((e) => e.connectorSlug === "google-search-console")!;
      expect(gsc.product).toBe("gsc");
      expect(gsc.resourceId).toBe("https://hav.com");

      const ads = plan.entries.find((e) => e.connectorSlug === "google-ads")!;
      expect(ads.product).toBe("google_ads");
      // Dashes stripped from customer_id
      expect(ads.resourceId).toBe("1234567890");

      const mc = plan.entries.find((e) => e.connectorSlug === "merchant-center")!;
      expect(mc.product).toBe("merchant_center");
      expect(mc.resourceId).toBe("9876543");
    });

    it("connectorSlug comes from connector.slug, not from connection id", async () => {
      const accountStore = openAccountStore();
      const googleStore = openGoogleStore();
      const adapter = new GoogleOAuthAdapter(GOOGLE_CONFIG, googleStore);
      const accountId = seedAccount(accountStore);
      const conn = makeConnection("google-analytics-4", "brand_hav", "region_hav_au", { property_id: "properties/1" });
      const linker = new GoogleAccountLinker(makeBackend([conn]), accountStore, googleStore, adapter);
      const plan = await linker.buildPlan(accountId);
      expect(plan.entries[0].connectorSlug).toBe("google-analytics-4");
    });
  });

  describe("unmatched classification", () => {
    it("marks entry as unmatched when configSummary lacks the required key", async () => {
      const accountStore = openAccountStore();
      const googleStore = openGoogleStore();
      const adapter = new GoogleOAuthAdapter(GOOGLE_CONFIG, googleStore);
      const accountId = seedAccount(accountStore);
      const conn = makeConnection("google-analytics-4", "brand_hav", "region_hav_au", {});
      const linker = new GoogleAccountLinker(makeBackend([conn]), accountStore, googleStore, adapter);
      const plan = await linker.buildPlan(accountId);
      expect(plan.entries[0].status).toBe("unmatched");
      expect(plan.entries[0].reason).toContain("property_id");
      expect(plan.counts.unmatched).toBe(1);
      expect(plan.counts.proposed).toBe(0);
    });
  });

  describe("proposed → linked idempotency", () => {
    it("applyLinks links all proposed; second call produces no new links", async () => {
      const accountStore = openAccountStore();
      const googleStore = openGoogleStore();
      const adapter = new GoogleOAuthAdapter(GOOGLE_CONFIG, googleStore);
      const accountId = seedAccount(accountStore);
      const stubFetch = makeStubFetch();

      const connections: Connection[] = [
        makeConnection("google-analytics-4", "brand_hav", "region_hav_au", { property_id: "properties/1" }),
        makeConnection("google-search-console", "brand_hav", "region_hav_au", { site_url: "https://hav.com" })
      ];
      const linker = new GoogleAccountLinker(makeBackend(connections), accountStore, googleStore, adapter);

      const result1 = await linker.applyLinks(accountId, {}, stubFetch);
      expect(result1.linked).toHaveLength(2);
      expect(result1.skipped).toHaveLength(0);

      const links = accountStore.listLinksForAccount(accountId);
      expect(links).toHaveLength(2);

      // Stable link ids on second call
      const result2 = await linker.applyLinks(accountId, {}, stubFetch);
      expect(result2.linked).toHaveLength(0);
      expect(accountStore.listLinksForAccount(accountId)).toHaveLength(2);
    });

    it("gateway_google_credentials has exactly one row per connection (upsert stable id)", async () => {
      const accountStore = openAccountStore();
      const googleStore = openGoogleStore();
      const adapter = new GoogleOAuthAdapter(GOOGLE_CONFIG, googleStore);
      const accountId = seedAccount(accountStore);
      const stubFetch = makeStubFetch();

      const conn = makeConnection("google-analytics-4", "brand_hav", "region_hav_au", { property_id: "properties/1" });
      const linker = new GoogleAccountLinker(makeBackend([conn]), accountStore, googleStore, adapter);

      const r1 = await linker.applyLinks(accountId, {}, stubFetch);
      const r2 = await linker.applyLinks(accountId, {}, makeStubFetch("ya29.new_token"));

      expect(r2.linked).toHaveLength(0);
      expect(googleStore.listCredentials()).toHaveLength(1);
      // Credential id is stable across re-applies
      expect(r1.linked[0]?.credentialId).toBeDefined();
    });
  });

  describe("already_linked detection", () => {
    it("after applyLinks, buildPlan shows connections as already_linked", async () => {
      const accountStore = openAccountStore();
      const googleStore = openGoogleStore();
      const adapter = new GoogleOAuthAdapter(GOOGLE_CONFIG, googleStore);
      const accountId = seedAccount(accountStore);
      const stubFetch = makeStubFetch();

      const conn = makeConnection("google-analytics-4", "brand_hav", "region_hav_au", { property_id: "properties/1" });
      const linker = new GoogleAccountLinker(makeBackend([conn]), accountStore, googleStore, adapter);

      await linker.applyLinks(accountId, {}, stubFetch);
      const plan = await linker.buildPlan(accountId);
      expect(plan.entries[0].status).toBe("already_linked");
      expect(plan.entries[0].existingLinkId).toBeDefined();
      expect(plan.counts.alreadyLinked).toBe(1);
      expect(plan.counts.proposed).toBe(0);
    });
  });

  describe("re-link of new connection", () => {
    it("adding a new connection after initial link shows only it as proposed", async () => {
      const accountStore = openAccountStore();
      const googleStore = openGoogleStore();
      const adapter = new GoogleOAuthAdapter(GOOGLE_CONFIG, googleStore);
      const accountId = seedAccount(accountStore);
      const stubFetch = makeStubFetch();

      const conn1 = makeConnection("google-analytics-4", "brand_hav", "region_hav_au", { property_id: "properties/1" });
      const linker1 = new GoogleAccountLinker(makeBackend([conn1]), accountStore, googleStore, adapter);
      await linker1.applyLinks(accountId, {}, stubFetch);

      const conn2 = makeConnection("google-ads", "brand_hav", "region_hav_au", { customer_id: "9999999999" });
      const linker2 = new GoogleAccountLinker(makeBackend([conn1, conn2]), accountStore, googleStore, adapter);
      const plan = await linker2.buildPlan(accountId);
      expect(plan.counts.alreadyLinked).toBe(1);
      expect(plan.counts.proposed).toBe(1);
      expect(plan.entries.find((e) => e.connectorSlug === "google-ads")?.status).toBe("proposed");

      const r2 = await linker2.applyLinks(accountId, {}, stubFetch);
      expect(r2.linked).toHaveLength(1);
      expect(accountStore.listLinksForAccount(accountId)).toHaveLength(2);
    });
  });

  describe("connection_id binding", () => {
    it("every created link has connection_id set", async () => {
      const accountStore = openAccountStore();
      const googleStore = openGoogleStore();
      const adapter = new GoogleOAuthAdapter(GOOGLE_CONFIG, googleStore);
      const accountId = seedAccount(accountStore);
      const stubFetch = makeStubFetch();

      const conn = makeConnection("google-analytics-4", "brand_hav", "region_hav_au", { property_id: "properties/1" });
      const linker = new GoogleAccountLinker(makeBackend([conn]), accountStore, googleStore, adapter);
      const result = await linker.applyLinks(accountId, {}, stubFetch);

      const link = accountStore.getLinkForScope({
        service: "google",
        brandId: "brand_hav",
        regionId: "region_hav_au",
        connectorSlug: "google-analytics-4"
      });
      expect(link?.connectionId).toBe(conn.id);
      expect(result.linked[0].linkId).toBe(link?.id);
    });
  });

  describe("multi-brand fan-out", () => {
    it("one account, 3 brands × 2 regions × 2 products = 12 links and 12 credentials", async () => {
      const accountStore = openAccountStore();
      const googleStore = openGoogleStore();
      const adapter = new GoogleOAuthAdapter(GOOGLE_CONFIG, googleStore);
      const accountId = seedAccount(accountStore);
      const stubFetch = makeStubFetch();

      const connections: Connection[] = [];
      const brands = ["brand_a", "brand_b", "brand_c"];
      const regions = ["region_a_au", "region_a_us"];
      const slugConfigs: Array<[string, Record<string, string>]> = [
        ["google-analytics-4", { property_id: "properties/1" }],
        ["google-search-console", { site_url: "https://example.com" }]
      ];
      for (const brand of brands) {
        for (const region of regions) {
          for (const [slug, config] of slugConfigs) {
            connections.push(makeConnection(slug, brand, region, config));
          }
        }
      }

      const linker = new GoogleAccountLinker(makeBackend(connections), accountStore, googleStore, adapter);
      const result = await linker.applyLinks(accountId, {}, stubFetch);
      expect(result.linked).toHaveLength(12);
      expect(accountStore.listLinksForAccount(accountId)).toHaveLength(12);
      expect(googleStore.listCredentials()).toHaveLength(12);
      // All link to the same account
      for (const link of accountStore.listLinksForAccount(accountId)) {
        expect(link.accountId).toBe(accountId);
      }
    });
  });

  describe("dedup/backfill migration", () => {
    it("backfills connector_slug for single-product rows and deduplicates on runMigrations", () => {
      // Seed a Phase-4-style DB directly with duplicates and null connector_slug
      const seedStore = openGoogleStore();
      const rawDb = seedStore["db"] as import("better-sqlite3").Database;

      // Insert two credentials for the same (brand, region, ga4) without connector_slug
      const now = new Date().toISOString();
      rawDb.prepare(`
        INSERT INTO gateway_google_credentials
          (id, brand_id, region_id, google_account_email, encrypted_payload, products_json, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run("cred_old", "brand_a", "region_a", "admin@x", "ep1", '["ga4"]', "connected", now, now);
      rawDb.prepare(`
        INSERT INTO gateway_google_credentials
          (id, brand_id, region_id, google_account_email, encrypted_payload, products_json, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run("cred_new", "brand_a", "region_a", "admin@x", "ep2", '["ga4"]', "connected", now, now);

      // Also insert a multi-product legacy row that must be preserved
      rawDb.prepare(`
        INSERT INTO gateway_google_credentials
          (id, brand_id, region_id, google_account_email, encrypted_payload, products_json, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run("cred_multi", "brand_b", "region_b", "admin@x", "ep3", '["ga4","gsc"]', "connected", now, now);

      seedStore.close();
      allStores.pop();

      // Re-open triggers runMigrations which does backfill + dedup
      const store2 = openGoogleStore();
      const rawDb2 = store2["db"] as import("better-sqlite3").Database;

      const all = rawDb2.prepare("SELECT id, connector_slug FROM gateway_google_credentials ORDER BY id").all() as Array<{ id: string; connector_slug: string | null }>;

      // Only one ga4 row for brand_a/region_a survives (dedup)
      const ga4Rows = all.filter((r) => r.connector_slug === "google-analytics-4");
      expect(ga4Rows).toHaveLength(1);

      // Multi-product row kept with null connector_slug
      const multiRow = all.find((r) => r.id === "cred_multi");
      expect(multiRow).toBeDefined();
      expect(multiRow?.connector_slug).toBeNull();

      // The unique index exists
      const idx = rawDb2.prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_google_cred_scope'"
      ).get();
      expect(idx).toBeDefined();
    });
  });
});
