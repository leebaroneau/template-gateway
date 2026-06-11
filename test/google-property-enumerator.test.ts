import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GatewayAccountStore } from "../src/account-credentials/store.js";
import { GatewayGoogleStore } from "../src/google-oauth/store.js";
import { GoogleOAuthAdapter, type GoogleOAuthConfig } from "../src/google-oauth/adapter.js";
import { GooglePropertyEnumerator } from "../src/google-oauth/enumerator.js";

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
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-enum-"));
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
  allStores.push(accountStore, googleStore);
  return { accountStore, googleStore };
}

function makeEnumerator(googleAdsDevToken?: string) {
  const { accountStore, googleStore } = openStores();
  const adapter = new GoogleOAuthAdapter(GOOGLE_CONFIG, googleStore);
  vi.spyOn(adapter, "getAccountAccessToken").mockResolvedValue("ya29.mock");
  const enumerator = new GooglePropertyEnumerator(adapter, accountStore, googleStore, googleAdsDevToken);
  return { enumerator, accountStore };
}

describe("GooglePropertyEnumerator.listProperties", () => {
  it("returns GA4 properties from analyticsadmin API", async () => {
    const { enumerator } = makeEnumerator();
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        properties: [
          { name: "properties/111", displayName: "Brand AU", websiteUri: "https://brand.com.au" },
          { name: "properties/222", displayName: "Brand US", websiteUri: "https://brand.com" }
        ]
      })
    } as unknown as Response);

    const results = await enumerator.listProperties("acct_1", "ga4", new Map(), mockFetch);

    expect(results).toHaveLength(2);
    expect(results[0].id).toBe("properties/111");
    expect(results[0].displayName).toBe("Brand AU");
    expect(results[0].url).toBe("https://brand.com.au");
    expect(results[0].alreadyClaimed).toBe(false);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("analyticsadmin.googleapis.com"),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer ya29.mock" }) })
    );
  });

  it("marks GA4 property as alreadyClaimed when in claimedMap", async () => {
    const { enumerator } = makeEnumerator();
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        properties: [{ name: "properties/111", displayName: "Brand AU", websiteUri: "https://brand.com.au" }]
      })
    } as unknown as Response);

    const claimed = new Map([["properties/111", "conn_other"]]);
    const results = await enumerator.listProperties("acct_1", "ga4", claimed, mockFetch);

    expect(results[0].alreadyClaimed).toBe(true);
    expect(results[0].claimedByConnectionId).toBe("conn_other");
  });

  it("returns GSC sites from webmasters API", async () => {
    const { enumerator } = makeEnumerator();
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        siteEntry: [
          { siteUrl: "https://brand.com.au/", permissionLevel: "siteOwner" },
          { siteUrl: "sc-domain:brand.com", permissionLevel: "siteOwner" }
        ]
      })
    } as unknown as Response);

    const results = await enumerator.listProperties("acct_1", "gsc", new Map(), mockFetch);

    expect(results).toHaveLength(2);
    expect(results[0].id).toBe("https://brand.com.au/");
    expect(results[0].url).toBe("https://brand.com.au/");
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("webmasters"),
      expect.anything()
    );
  });

  it("returns Ads customers using developer-token header", async () => {
    const { enumerator } = makeEnumerator("dev-token-abc");
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ resourceNames: ["customers/123", "customers/456"] })
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [{ customer: { id: "123", descriptiveName: "Brand AU Ads" } }] })
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [{ customer: { id: "456", descriptiveName: "Brand US Ads" } }] })
      } as unknown as Response);

    const results = await enumerator.listProperties("acct_1", "google_ads", new Map(), mockFetch);

    expect(results).toHaveLength(2);
    expect(results[0].id).toBe("123");
    // developer-token header must be present
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("googleads.googleapis.com"),
      expect.objectContaining({ headers: expect.objectContaining({ "developer-token": "dev-token-abc" }) })
    );
  });

  it("returns empty array for google_ads when no developer token configured", async () => {
    const { enumerator } = makeEnumerator(undefined); // no token
    const mockFetch = vi.fn();
    const results = await enumerator.listProperties("acct_1", "google_ads", new Map(), mockFetch);
    expect(results).toHaveLength(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns GBP locations from mybusiness API (two calls: accounts then locations)", async () => {
    const { enumerator } = makeEnumerator();
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ accounts: [{ name: "accounts/999" }] })
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          locations: [
            { name: "accounts/999/locations/1", title: "Brand AU Store", websiteUri: "https://brand.com.au" }
          ]
        })
      } as unknown as Response);

    const results = await enumerator.listProperties("acct_1", "google_business", new Map(), mockFetch);

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("accounts/999/locations/1");
    expect(results[0].displayName).toBe("Brand AU Store");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("returns Merchant Center accounts (authinfo + per-account fetch)", async () => {
    const { enumerator } = makeEnumerator();
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ accountIdentifiers: [{ merchantId: "111" }] })
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "111", name: "Brand AU MC", websiteUrl: "https://brand.com.au" })
      } as unknown as Response);

    const results = await enumerator.listProperties("acct_1", "merchant_center", new Map(), mockFetch);

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("111");
    expect(results[0].displayName).toBe("Brand AU MC");
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("shoppingcontent.googleapis.com/content/v2.1/accounts/authinfo"),
      expect.anything()
    );
  });

  it("throws upstream error when Google API returns non-ok", async () => {
    const { enumerator } = makeEnumerator();
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => "Forbidden"
    } as unknown as Response);

    await expect(
      enumerator.listProperties("acct_1", "ga4", new Map(), mockFetch)
    ).rejects.toThrow("403");
  });
});
