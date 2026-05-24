import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { createHttpApp } from "../src/http.js";
import { loadConfig } from "../src/config.js";
import { MicrosoftProviderService } from "../src/providers/microsoft/service.js";
import { MicrosoftOAuthStateStore } from "../src/providers/microsoft/state-store.js";
import { MicrosoftTokenStore } from "../src/providers/microsoft/token-store.js";

describe("HTTP app", () => {
  it("returns health", async () => {
    const app = createHttpApp({ config: baseConfig() });
    const response = await request(app).get("/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok", service: "template-gateway" });
  });

  it("returns provider directory", async () => {
    const app = createHttpApp({ config: baseConfig() });
    const response = await request(app).get("/providers");
    expect(response.status).toBe(200);
    expect(response.body.providers).toEqual([
      {
        slug: "microsoft",
        name: "Microsoft 365",
        description: "Microsoft Graph access for Outlook mail, Calendar, and selected Graph operations.",
        auth: "oauth",
        mcpPath: "/mcp/microsoft",
        scopesSummary: "Delegated Microsoft Graph access for the connected Microsoft login.",
        backend: "native",
        url: "http://localhost:3000/mcp/microsoft"
      },
      {
        slug: "pipedrive",
        name: "Pipedrive CRM",
        description: "Pipedrive CRM access for deals, persons, organizations, and activities.",
        auth: "oauth",
        mcpPath: "/mcp/pipedrive",
        scopesSummary: "Delegated Pipedrive access for the connected Pipedrive user.",
        backend: "native",
        url: "http://localhost:3000/mcp/pipedrive"
      }
    ]);
  });

  it("returns configured providers from directory endpoints", async () => {
    const app = createHttpApp({
      config: baseConfig(),
      providers: [
        {
          slug: "PIPEDRIVE",
          name: "Pipedrive",
          description: "CRM",
          auth: "oauth",
          mcpPath: "/mcp/pipedrive",
          scopesSummary: "Read and write CRM data."
        },
        {
          slug: " microsoft ",
          name: "Microsoft 365",
          description: "Outlook, Calendar, OneDrive",
          auth: "oauth",
          mcpPath: "/mcp/microsoft",
          scopesSummary: "Read and write Microsoft 365 data."
        }
      ]
    });

    const providersResponse = await request(app).get("/providers");
    const mcpResponse = await request(app).get("/mcp");

    expect(providersResponse.status).toBe(200);
    expect(mcpResponse.status).toBe(200);
    expect(providersResponse.body).toEqual(mcpResponse.body);
    expect(providersResponse.body.providers).toEqual([
      {
        slug: "microsoft",
        name: "Microsoft 365",
        description: "Outlook, Calendar, OneDrive",
        auth: "oauth",
        mcpPath: "/mcp/microsoft",
        scopesSummary: "Read and write Microsoft 365 data.",
        url: "http://localhost:3000/mcp/microsoft"
      },
      {
        slug: "pipedrive",
        name: "Pipedrive",
        description: "CRM",
        auth: "oauth",
        mcpPath: "/mcp/pipedrive",
        scopesSummary: "Read and write CRM data.",
        url: "http://localhost:3000/mcp/pipedrive"
      }
    ]);
  });

  it("exposes Microsoft connect, callback, status, and tool metadata endpoints", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "template-gateway-http-ms-"));
    const fetch = async (url: string) => {
      if (url.includes("/token")) {
        return jsonResponse({
          access_token: "access-token",
          refresh_token: "refresh-token",
          token_type: "Bearer",
          scope: "offline_access User.Read Mail.Read Calendars.Read",
          expires_in: 3600
        });
      }
      return jsonResponse({
        id: "account-1",
        mail: "bot@genvest.com.au",
        userPrincipalName: "bot@genvest.com.au"
      });
    };
    const microsoftProvider = createMicrosoftProvider(tempDir, fetch as typeof globalThis.fetch);
    const app = createHttpApp({
      config: {
        ...baseConfig(),
        allowedEmailDomains: ["genvest.com.au"],
        microsoft: {
          ...baseConfig().microsoft,
          allowedDomains: ["genvest.com.au"],
          clientId: "client-1",
          clientSecret: "secret-1",
          tenantId: "tenant-1",
          tokenStoreKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
        }
      },
      microsoftProvider
    });

    try {
      const connect = await request(app)
        .get("/auth/microsoft/connect")
        .query({ actor: "bot@genvest.com.au", actorId: "genvest-head-of-sales", actorName: "@sales_bot" });
      expect(connect.status).toBe(200);
      expect(connect.body.provider).toBe("microsoft");
      expect(connect.body.authorizeUrl).toContain("https://login.microsoftonline.com/tenant-1/oauth2/v2.0/authorize");
      const state = new URL(connect.body.authorizeUrl).searchParams.get("state");

      const callback = await request(app).get("/auth/microsoft/callback").query({ state, code: "auth-code" });
      expect(callback.status).toBe(200);
      expect(callback.body).toMatchObject({
        provider: "microsoft",
        status: "connected",
        upstreamLogin: "bot@genvest.com.au"
      });

      const status = await request(app)
        .get("/providers/microsoft/status")
        .query({ actor: "genvest-head-of-sales" });
      expect(status.status).toBe(200);
      expect(status.body).toMatchObject({
        provider: "microsoft",
        status: "connected",
        actorId: "genvest-head-of-sales",
        upstreamLogin: "bot@genvest.com.au"
      });

      const tools = await request(app).get("/providers/microsoft/tools");
      expect(tools.status).toBe(200);
      expect(tools.body.tools.map((tool: { name: string }) => tool.name)).toEqual([
        "outlook_list_messages",
        "calendar_list_events",
        "graph_request"
      ]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

function baseConfig() {
  return {
    port: 3000,
    apiBaseUrl: "http://localhost:3000",
    allowedEmailDomains: ["example.com"],
    tokenStorePath: "./data/tokens.json",
    auditLogPath: "./data/audit.jsonl",
    apiBearerTokens: [],
    enabledProviders: ["microsoft", "pipedrive"],
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
    },
    pipedrive: {
      clientId: undefined,
      clientSecret: undefined,
      redirectUri: "http://localhost:3000/auth/pipedrive/callback",
      companyDomain: undefined,
      allowedDomains: ["example.com"],
      tokenStorePath: "./data/pipedrive-tokens.json",
      tokenStoreKey: undefined,
      scopes: [],
      authorizeUrl: "https://oauth.pipedrive.com/oauth/authorize",
      tokenUrl: "https://oauth.pipedrive.com/oauth/token"
    }
  };
}

function createMicrosoftProvider(tempDir: string, fetch: typeof globalThis.fetch): MicrosoftProviderService {
  return new MicrosoftProviderService({
    config: {
      clientId: "client-1",
      clientSecret: "secret-1",
      tenantId: "tenant-1",
      redirectUri: "http://localhost:3000/auth/microsoft/callback",
      allowedTenants: ["tenant-1"],
      allowedDomains: ["genvest.com.au"],
      tokenStorePath: join(tempDir, "microsoft-tokens.json"),
      tokenStoreKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      scopes: ["offline_access", "User.Read", "Mail.Read", "Calendars.Read"]
    },
    stateStore: new MicrosoftOAuthStateStore(join(tempDir, "microsoft-states.json")),
    tokenStore: new MicrosoftTokenStore(join(tempDir, "microsoft-tokens.json"), "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="),
    fetch
  });
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body)
  } as Response;
}

describe("HTTP — native Microsoft routes claim /auth/microsoft/*", () => {
  const baseEnv = {
    API_BASE_URL: "http://localhost:3000",
    ALLOWED_EMAIL_DOMAINS: "example.com",
    ENABLED_PROVIDERS: "microsoft",
    MICROSOFT_CLIENT_ID: "test-client",
    MICROSOFT_CLIENT_SECRET: "test-secret",
    MICROSOFT_TENANT_ID: "11111111-1111-1111-1111-111111111111",
    MICROSOFT_TOKEN_STORE_KEY: Buffer.from("0".repeat(32)).toString("base64")
  };

  it("exposes /auth/microsoft/connect", async () => {
    const app = createHttpApp({ config: loadConfig(baseEnv) });
    const res = await request(app).get("/auth/microsoft/connect?actor=test@example.com");
    expect(res.status).not.toBe(404);
  });

  it("does not expose /auth/microsoft-native/connect anymore", async () => {
    const app = createHttpApp({ config: loadConfig(baseEnv) });
    const res = await request(app).get("/auth/microsoft-native/connect?actor=test@example.com");
    expect(res.status).toBe(404);
  });
});

describe("HTTP — composio routes are flag-gated", () => {
  const composioEnv = {
    API_BASE_URL: "http://localhost:3000",
    ALLOWED_EMAIL_DOMAINS: "example.com",
    ENABLED_PROVIDERS: "microsoft,microsoft-composio",
    ENABLE_COMPOSIO_PROVIDERS: "true",
    COMPOSIO_API_KEY: "ck_test",
    MICROSOFT_CLIENT_ID: "test-client",
    MICROSOFT_CLIENT_SECRET: "test-secret",
    MICROSOFT_TENANT_ID: "11111111-1111-1111-1111-111111111111",
    MICROSOFT_TOKEN_STORE_KEY: Buffer.from("0".repeat(32)).toString("base64")
  };

  it("exposes /providers/microsoft-composio/connect when flag is on", async () => {
    const app = createHttpApp({ config: loadConfig(composioEnv) });
    const res = await request(app).get("/providers/microsoft-composio/connect?actor=test@example.com&actorId=p1");
    expect(res.status).not.toBe(404);
  });

  it("does NOT expose /providers/microsoft-composio/connect when flag is off", async () => {
    const offEnv = { ...composioEnv, ENABLE_COMPOSIO_PROVIDERS: "false", ENABLED_PROVIDERS: "microsoft" };
    const app = createHttpApp({ config: loadConfig(offEnv) });
    const res = await request(app).get("/providers/microsoft-composio/connect?actor=test@example.com&actorId=p1");
    expect(res.status).toBe(404);
  });

  it("rejects /providers/microsoft (the native slug) on the generic provider route", async () => {
    const app = createHttpApp({ config: loadConfig(composioEnv) });
    const res = await request(app).get("/providers/microsoft/connect?actor=test@example.com&actorId=p1");
    expect([400, 404]).toContain(res.status);
  });
});
