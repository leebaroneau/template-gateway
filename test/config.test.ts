import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("loads defaults", () => {
    expect(loadConfig({})).toEqual({
      port: 3000,
      apiBaseUrl: "http://localhost:3000",
      allowedEmailDomains: ["example.com"],
      tokenStorePath: "./data/tokens.json",
      auditLogPath: "./data/audit.jsonl",
      apiBearerTokens: []
    });
  });

  it("parses comma-separated domains and bearer tokens", () => {
    const config = loadConfig({
      PORT: "4100",
      API_BASE_URL: "https://gateway.example.com",
      ALLOWED_EMAIL_DOMAINS: "genvest.com.au, haverford.au",
      TOKEN_STORE_PATH: "/data/tokens.json",
      AUDIT_LOG_PATH: "/data/audit.jsonl",
      API_BEARER_TOKENS: "abcdefghijklmnopqrstuvwxyz123456,ZYXWVUTSRQPONMLKJIHGFEDCBA654321"
    });

    expect(config.port).toBe(4100);
    expect(config.allowedEmailDomains).toEqual(["genvest.com.au", "haverford.au"]);
    expect(config.apiBearerTokens).toHaveLength(2);
  });
});
