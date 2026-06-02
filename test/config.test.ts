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
    delete process.env.ADMIN_DATA_SOURCE;
    delete process.env.HAVERFORD_DEV_API_BASE_URL;
    delete process.env.HAVERFORD_DEV_API_CLIENT_ID;
    delete process.env.HAVERFORD_DEV_API_CLIENT_SECRET;
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(ORIG)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("requires the three core env vars", () => {
    expect(() => loadConfig()).toThrow(/COMPOSIO_API_KEY/);
    process.env.COMPOSIO_API_KEY = "ak_test";
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

  it("rejects malformed AUTH_CONFIGS entries", () => {
    process.env.COMPOSIO_API_KEY = "ak_test";
    process.env.BRAND_SLUG = "genvest";
    process.env.GATEWAY_BEARER = "a_secret_thats_long_enough";
    process.env.AUTH_CONFIGS = "outlook";
    expect(() => loadConfig()).toThrow(/toolkit:ac_xxx/);
  });
});
