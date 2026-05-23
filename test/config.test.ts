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
      apiBearerTokens: [],
      enabledProviders: ["microsoft"],
      microsoft: {
        clientId: undefined,
        clientSecret: undefined,
        tenantId: undefined,
        redirectUri: "http://localhost:3000/auth/microsoft/callback",
        allowedTenants: [],
        allowedDomains: ["example.com"],
        tokenStorePath: "./data/microsoft-tokens.json",
        tokenStoreKey: undefined,
        scopes: ["offline_access", "User.Read", "Mail.Read", "Calendars.Read"]
      }
    });
  });

  it("parses comma-separated domains and bearer tokens", () => {
    const config = loadConfig({
      PORT: "4100",
      API_BASE_URL: "https://gateway.example.com",
      ALLOWED_EMAIL_DOMAINS: "genvest.com.au, haverford.au",
      TOKEN_STORE_PATH: "/data/tokens.json",
      AUDIT_LOG_PATH: "/data/audit.jsonl",
      API_BEARER_TOKENS: "abcdefghijklmnopqrstuvwxyz123456,ZYXWVUTSRQPONMLKJIHGFEDCBA654321",
      ENABLED_PROVIDERS: "microsoft,pipedrive",
      MICROSOFT_CLIENT_ID: "client-id",
      MICROSOFT_CLIENT_SECRET: "client-secret",
      MICROSOFT_TENANT_ID: "tenant-id",
      MICROSOFT_REDIRECT_URI: "https://gateway.example.com/auth/microsoft/callback",
      MICROSOFT_ALLOWED_TENANTS: "tenant-id,other-tenant",
      MICROSOFT_ALLOWED_DOMAINS: "genvest.com.au",
      MICROSOFT_TOKEN_STORE_PATH: "/data/microsoft.json",
      MICROSOFT_TOKEN_STORE_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      MICROSOFT_SCOPES: "offline_access User.Read Mail.Read Mail.Send"
    });

    expect(config.port).toBe(4100);
    expect(config.allowedEmailDomains).toEqual(["genvest.com.au", "haverford.au"]);
    expect(config.apiBearerTokens).toHaveLength(2);
    expect(config.enabledProviders).toEqual(["microsoft", "pipedrive"]);
    expect(config.microsoft).toEqual({
      clientId: "client-id",
      clientSecret: "client-secret",
      tenantId: "tenant-id",
      redirectUri: "https://gateway.example.com/auth/microsoft/callback",
      allowedTenants: ["tenant-id", "other-tenant"],
      allowedDomains: ["genvest.com.au"],
      tokenStorePath: "/data/microsoft.json",
      tokenStoreKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      scopes: ["offline_access", "User.Read", "Mail.Read", "Mail.Send"]
    });
  });

  it("rejects malformed port values", () => {
    expect(() => loadConfig({ PORT: "3000abc" })).toThrow();
    expect(() => loadConfig({ PORT: "1.5" })).toThrow();
    expect(() => loadConfig({ PORT: "abc" })).toThrow();
  });
});
