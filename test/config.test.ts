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
    delete process.env.PORT;
    delete process.env.SESSION_TTL_SECONDS;
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
});
