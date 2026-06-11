import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  const ORIG = { ...process.env };

  beforeEach(() => {
    delete process.env.COMPOSIO_API_KEY;
    delete process.env.COMPOSIO_PROJECT_ID;
    delete process.env.BRAND_SLUG;
    delete process.env.GATEWAY_BEARER;
    delete process.env.TOOLKIT_ALLOWLIST;
    delete process.env.AUTH_CONFIGS;
    delete process.env.PORT;
    delete process.env.SESSION_TTL_SECONDS;
    delete process.env.NODE_ENV;
    delete process.env.ADMIN_DATA_SOURCE;
    delete process.env.GATEWAY_STORE_PATH;
    delete process.env.HAVERFORD_DEV_API_BASE_URL;
    delete process.env.HAVERFORD_DEV_API_CLIENT_ID;
    delete process.env.HAVERFORD_DEV_API_CLIENT_SECRET;
    delete process.env.MCP_AUTH_GATE_ALLOWED_DOMAINS;
    delete process.env.MCP_AUTH_GATE_ALLOWED_USERS;
    delete process.env.PIPEDRIVE_API_TOKEN;
    delete process.env.PIPEDRIVE_COMPANY_DOMAIN;
    delete process.env.PIPEDRIVE_FACADE_ALLOW_WRITES;
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    delete process.env.GOOGLE_OAUTH_REDIRECT_URI;
    delete process.env.GOOGLE_OAUTH_ENCRYPTION_KEY;
    delete process.env.SHOPIFY_OAUTH_API_KEY;
    delete process.env.SHOPIFY_OAUTH_API_SECRET;
    delete process.env.SHOPIFY_OAUTH_REDIRECT_URI;
    delete process.env.SHOPIFY_OAUTH_ENCRYPTION_KEY;
    delete process.env.SHOPIFY_OAUTH_SCOPES;
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(ORIG)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("requires the two core env vars", () => {
    expect(() => loadConfig()).toThrow(/BRAND_SLUG/);
    process.env.BRAND_SLUG = "genvest";
    expect(() => loadConfig()).toThrow(/GATEWAY_BEARER/);
  });

  it("uses sensible defaults for optional fields", () => {
    process.env.COMPOSIO_API_KEY = "ak_test";
    process.env.BRAND_SLUG = "genvest";
    process.env.GATEWAY_BEARER = "a_secret_thats_long_enough";
    const cfg = loadConfig();
    expect(cfg.port).toBe(3000);
    expect(cfg.sessionTtlSeconds).toBe(3600);
    expect(cfg.toolkitAllowlist).toBeUndefined();
    expect(cfg.adminDataSource).toBe("fixture");
    expect(cfg.gatewayStorePath).toBe("./data/gateway.sqlite");
    expect(cfg.mcpAuthGateAllowedDomains).toBeUndefined();
    expect(cfg.mcpAuthGateAllowedUsers).toBeUndefined();
    expect(cfg.pipedriveFacade).toEqual({
      apiToken: undefined,
      companyDomain: undefined,
      allowWrites: false
    });
  });

  it("leaves MCP Auth Gate allowlists disabled by default", () => {
    const cfg = loadConfig({
      COMPOSIO_API_KEY: "ak_test",
      BRAND_SLUG: "haverford",
      GATEWAY_BEARER: "a_secret_thats_long_enough"
    });

    expect(cfg.mcpAuthGateAllowedDomains).toBeUndefined();
    expect(cfg.mcpAuthGateAllowedUsers).toBeUndefined();
  });

  it("parses MCP Auth Gate allowlists as lowercased arrays", () => {
    const cfg = loadConfig({
      COMPOSIO_API_KEY: "ak_test",
      BRAND_SLUG: "haverford",
      GATEWAY_BEARER: "a_secret_thats_long_enough",
      MCP_AUTH_GATE_ALLOWED_DOMAINS: " Haverford.au, haverford.COM.AU ,, ",
      MCP_AUTH_GATE_ALLOWED_USERS: " Lee@Haverford.au, Ops@Haverford.com.au "
    });

    expect(cfg.mcpAuthGateAllowedDomains).toEqual(["haverford.au", "haverford.com.au"]);
    expect(cfg.mcpAuthGateAllowedUsers).toEqual(["lee@haverford.au", "ops@haverford.com.au"]);
  });

  it("parses Dev API admin data source settings", () => {
    process.env.COMPOSIO_API_KEY = "ak_test";
    process.env.BRAND_SLUG = "genvest";
    process.env.GATEWAY_BEARER = "a_secret_thats_long_enough";
    process.env.ADMIN_DATA_SOURCE = "dev-api";
    process.env.HAVERFORD_DEV_API_BASE_URL = " https://dev-api.haverford.au ";
    process.env.HAVERFORD_DEV_API_CLIENT_ID = " gateway-admin ";
    process.env.HAVERFORD_DEV_API_CLIENT_SECRET = " secret ";

    const cfg = loadConfig();

    expect(cfg.adminDataSource).toBe("dev-api");
    expect(cfg.haverfordDevApiBaseUrl).toBe("https://dev-api.haverford.au");
    expect(cfg.haverfordDevApiClientId).toBe("gateway-admin");
    expect(cfg.haverfordDevApiClientSecret).toBe("secret");
  });

  it("parses Dev API admin data source settings from a custom env object", () => {
    const cfg = loadConfig({
      COMPOSIO_API_KEY: "ak_test",
      BRAND_SLUG: "genvest",
      GATEWAY_BEARER: "a_secret_thats_long_enough",
      ADMIN_DATA_SOURCE: "dev-api",
      HAVERFORD_DEV_API_BASE_URL: " https://dev-api.haverford.au ",
      HAVERFORD_DEV_API_CLIENT_ID: " gateway-admin ",
      HAVERFORD_DEV_API_CLIENT_SECRET: " secret "
    });

    expect(cfg.adminDataSource).toBe("dev-api");
    expect(cfg.haverfordDevApiBaseUrl).toBe("https://dev-api.haverford.au");
    expect(cfg.haverfordDevApiClientId).toBe("gateway-admin");
    expect(cfg.haverfordDevApiClientSecret).toBe("secret");
  });

  it("parses overlay admin data source settings with a store path", () => {
    const cfg = loadConfig({
      COMPOSIO_API_KEY: "ak_test",
      BRAND_SLUG: "haverford",
      GATEWAY_BEARER: "a_secret_thats_long_enough",
      ADMIN_DATA_SOURCE: "dev-api-overlay",
      GATEWAY_STORE_PATH: " ./data/test-gateway.sqlite ",
      HAVERFORD_DEV_API_BASE_URL: "https://dev-api.haverford.au",
      HAVERFORD_DEV_API_CLIENT_ID: "gateway-admin",
      HAVERFORD_DEV_API_CLIENT_SECRET: "secret"
    });

    expect(cfg.adminDataSource).toBe("dev-api-overlay");
    expect(cfg.gatewayStorePath).toBe("./data/test-gateway.sqlite");
  });

  it("uses a local gateway store path default for overlay modes", () => {
    const cfg = loadConfig({
      COMPOSIO_API_KEY: "ak_test",
      BRAND_SLUG: "haverford",
      GATEWAY_BEARER: "a_secret_thats_long_enough",
      ADMIN_DATA_SOURCE: "fixture-overlay"
    });

    expect(cfg.adminDataSource).toBe("fixture-overlay");
    expect(cfg.gatewayStorePath).toBe("./data/gateway.sqlite");
  });

  it("uses the deployment data volume as the production store default", () => {
    const cfg = loadConfig({
      COMPOSIO_API_KEY: "ak_test",
      BRAND_SLUG: "haverford",
      GATEWAY_BEARER: "a_secret_thats_long_enough",
      NODE_ENV: "production"
    });

    expect(cfg.adminDataSource).toBe("fixture");
    expect(cfg.gatewayStorePath).toBe("/data/gateway.sqlite");
  });

  it("uses the deployment data volume as the production overlay store default", () => {
    const cfg = loadConfig({
      COMPOSIO_API_KEY: "ak_test",
      BRAND_SLUG: "haverford",
      GATEWAY_BEARER: "a_secret_thats_long_enough",
      ADMIN_DATA_SOURCE: "fixture-overlay",
      NODE_ENV: "production"
    });

    expect(cfg.adminDataSource).toBe("fixture-overlay");
    expect(cfg.gatewayStorePath).toBe("/data/gateway.sqlite");
  });

  it("rejects invalid admin data sources", () => {
    process.env.COMPOSIO_API_KEY = "ak_test";
    process.env.BRAND_SLUG = "genvest";
    process.env.GATEWAY_BEARER = "a_secret_thats_long_enough";
    process.env.ADMIN_DATA_SOURCE = "sqlite";

    expect(() => loadConfig()).toThrow(/ADMIN_DATA_SOURCE/);
  });

  it("parses the toolkit allowlist as a normalised array", () => {
    process.env.COMPOSIO_API_KEY = "ak_test";
    process.env.BRAND_SLUG = "genvest";
    process.env.GATEWAY_BEARER = "a_secret_thats_long_enough";
    process.env.TOOLKIT_ALLOWLIST = "outlook, ONE_drive ,pipedrive";
    const cfg = loadConfig();
    expect(cfg.toolkitAllowlist).toEqual(["outlook", "one_drive", "pipedrive"]);
  });

  it("rejects invalid PORT values", () => {
    process.env.COMPOSIO_API_KEY = "ak_test";
    process.env.BRAND_SLUG = "genvest";
    process.env.GATEWAY_BEARER = "a_secret_thats_long_enough";
    process.env.PORT = "abc";
    expect(() => loadConfig()).toThrow(/Invalid PORT/);
  });

  it("rejects SESSION_TTL_SECONDS below 60", () => {
    process.env.COMPOSIO_API_KEY = "ak_test";
    process.env.BRAND_SLUG = "genvest";
    process.env.GATEWAY_BEARER = "a_secret_thats_long_enough";
    process.env.SESSION_TTL_SECONDS = "10";
    expect(() => loadConfig()).toThrow(/at least 60/);
  });

  it("parses AUTH_CONFIGS as a toolkit→ac_id map", () => {
    process.env.COMPOSIO_API_KEY = "ak_test";
    process.env.BRAND_SLUG = "genvest";
    process.env.GATEWAY_BEARER = "a_secret_thats_long_enough";
    process.env.AUTH_CONFIGS = "docusign:ac_doc, MICROSOFT_clarity : ac_clar,pipedrive:ac_pipe";
    const cfg = loadConfig();
    expect(cfg.authConfigs).toEqual({
      docusign: "ac_doc",
      microsoft_clarity: "ac_clar",
      pipedrive: "ac_pipe"
    });
  });

  it("parses the optional deterministic Pipedrive facade config", () => {
    const cfg = loadConfig({
      COMPOSIO_API_KEY: "ak_test",
      BRAND_SLUG: "genvest",
      GATEWAY_BEARER: "a_secret_thats_long_enough",
      PIPEDRIVE_API_TOKEN: " pd_token ",
      PIPEDRIVE_COMPANY_DOMAIN: " genvestpropertyptyltd ",
      PIPEDRIVE_FACADE_ALLOW_WRITES: "true"
    });

    expect(cfg.pipedriveFacade).toEqual({
      apiToken: "pd_token",
      companyDomain: "genvestpropertyptyltd",
      allowWrites: true
    });
  });

  it("rejects invalid Pipedrive facade boolean values", () => {
    expect(() => loadConfig({
      COMPOSIO_API_KEY: "ak_test",
      BRAND_SLUG: "genvest",
      GATEWAY_BEARER: "a_secret_thats_long_enough",
      PIPEDRIVE_FACADE_ALLOW_WRITES: "maybe"
    })).toThrow(/Boolean env var/);
  });

  it("rejects malformed AUTH_CONFIGS entries", () => {
    process.env.COMPOSIO_API_KEY = "ak_test";
    process.env.BRAND_SLUG = "genvest";
    process.env.GATEWAY_BEARER = "a_secret_thats_long_enough";
    process.env.AUTH_CONFIGS = "outlook";
    expect(() => loadConfig()).toThrow(/toolkit:ac_xxx/);
  });

  describe("Google OAuth config", () => {
    it("is undefined when no GOOGLE_OAUTH_* vars are set", () => {
      process.env.COMPOSIO_API_KEY = "ak_test";
      process.env.BRAND_SLUG = "haverford";
      process.env.GATEWAY_BEARER = "bearer_test";
      const config = loadConfig();
      expect(config.googleOAuth).toBeUndefined();
    });

    it("is populated when all GOOGLE_OAUTH_* vars are set", () => {
      process.env.COMPOSIO_API_KEY = "ak_test";
      process.env.BRAND_SLUG = "haverford";
      process.env.GATEWAY_BEARER = "bearer_test";
      process.env.GOOGLE_OAUTH_CLIENT_ID = "client_id.apps.googleusercontent.com";
      process.env.GOOGLE_OAUTH_CLIENT_SECRET = "client_secret";
      process.env.GOOGLE_OAUTH_REDIRECT_URI = "http://localhost:3000/oauth/google/callback";
      process.env.GOOGLE_OAUTH_ENCRYPTION_KEY = Buffer.alloc(32, 0x42).toString("base64url");
      const config = loadConfig();
      expect(config.googleOAuth).toMatchObject({
        clientId: "client_id.apps.googleusercontent.com",
        clientSecret: "client_secret",
        redirectUri: "http://localhost:3000/oauth/google/callback"
      });
      delete process.env.GOOGLE_OAUTH_CLIENT_ID;
      delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
      delete process.env.GOOGLE_OAUTH_REDIRECT_URI;
      delete process.env.GOOGLE_OAUTH_ENCRYPTION_KEY;
    });

    it("throws if only some GOOGLE_OAUTH_* vars are set", () => {
      process.env.COMPOSIO_API_KEY = "ak_test";
      process.env.BRAND_SLUG = "haverford";
      process.env.GATEWAY_BEARER = "bearer_test";
      process.env.GOOGLE_OAUTH_CLIENT_ID = "partial";
      expect(() => loadConfig()).toThrow(/GOOGLE_OAUTH_CLIENT_SECRET/);
      delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    });
  });

  describe("Shopify OAuth config", () => {
    it("returns undefined when no SHOPIFY_OAUTH_* vars set", () => {
      process.env.COMPOSIO_API_KEY = "ak_test";
      process.env.BRAND_SLUG = "haverford";
      process.env.GATEWAY_BEARER = "bearer_test";
      const config = loadConfig();
      expect(config.shopifyOAuth).toBeUndefined();
    });

    it("returns populated config when all vars set", () => {
      const config = loadConfig({
        COMPOSIO_API_KEY: "ak_test",
        BRAND_SLUG: "haverford",
        GATEWAY_BEARER: "bearer_test",
        SHOPIFY_OAUTH_API_KEY: "test_key",
        SHOPIFY_OAUTH_API_SECRET: "test_secret",
        SHOPIFY_OAUTH_REDIRECT_URI: "https://example.com/callback",
        SHOPIFY_OAUTH_ENCRYPTION_KEY: "test_enc_key",
        SHOPIFY_OAUTH_SCOPES: "read_products,read_orders",
      });
      expect(config.shopifyOAuth).toMatchObject({
        apiKey: "test_key",
        apiSecret: "test_secret",
        redirectUri: "https://example.com/callback",
        encryptionKey: "test_enc_key",
        scopes: ["read_products", "read_orders"],
      });
    });

    it("throws when only API_KEY is set", () => {
      expect(() =>
        loadConfig({
          COMPOSIO_API_KEY: "ak_test",
          BRAND_SLUG: "haverford",
          GATEWAY_BEARER: "bearer_test",
          SHOPIFY_OAUTH_API_KEY: "test_key",
        })
      ).toThrow(/SHOPIFY_OAUTH_API_SECRET/);
    });
  });

  it("reads GOOGLE_ADS_DEVELOPER_TOKEN when set", () => {
    const cfg = loadConfig({
      BRAND_SLUG: "test",
      GATEWAY_BEARER: "test-bearer",
      GOOGLE_ADS_DEVELOPER_TOKEN: "dev-token-abc"
    });
    expect(cfg.googleAdsDevToken).toBe("dev-token-abc");
  });

  it("googleAdsDevToken is undefined when not set", () => {
    const cfg = loadConfig({ BRAND_SLUG: "test", GATEWAY_BEARER: "test-bearer" });
    expect(cfg.googleAdsDevToken).toBeUndefined();
  });
});
