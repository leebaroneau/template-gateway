import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { MicrosoftProviderService } from "../src/providers/microsoft/service.js";
import { MicrosoftOAuthStateStore } from "../src/providers/microsoft/state-store.js";
import { MicrosoftTokenStore } from "../src/providers/microsoft/token-store.js";

const TOKEN_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

describe("Microsoft provider", () => {
  it("creates a connect URL with actor state and configured scopes", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "template-gateway-ms-"));
    try {
      const service = createService(tempDir);

      const result = await service.createConnectUrl({
        actorId: "genvest-head-of-sales",
        actorEmail: "bot@genvest.com.au",
        actorName: "@sales_bot"
      });

      const url = new URL(result.authorizeUrl);
      expect(url.origin + url.pathname).toBe("https://login.microsoftonline.com/tenant-1/oauth2/v2.0/authorize");
      expect(url.searchParams.get("client_id")).toBe("client-1");
      expect(url.searchParams.get("redirect_uri")).toBe("https://gateway.example.com/auth/microsoft/callback");
      expect(url.searchParams.get("scope")).toBe("offline_access User.Read Mail.Read Calendars.Read");
      expect(url.searchParams.get("state")).toMatch(/[0-9a-f-]{36}/);
      expect(result.actor).toEqual({
        actorId: "genvest-head-of-sales",
        actorEmail: "bot@genvest.com.au",
        actorName: "@sales_bot"
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects connect requests for actor email domains outside the Microsoft gate", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "template-gateway-ms-"));
    try {
      const service = createService(tempDir);

      await expect(service.createConnectUrl({ actorEmail: "bot@example.com" })).rejects.toThrow(
        "Microsoft actor email domain is not allowed: bot@example.com"
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("completes callback, stores encrypted token material, and reports connected status", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "template-gateway-ms-"));
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/token")) {
        expect(init?.method).toBe("POST");
        return jsonResponse({
          access_token: "access-token",
          refresh_token: "refresh-token",
          token_type: "Bearer",
          scope: "offline_access User.Read Mail.Read Calendars.Read",
          expires_in: 3600
        });
      }
      if (url.includes("graph.microsoft.com")) {
        expect(init?.headers).toEqual({ Authorization: "Bearer access-token" });
        return jsonResponse({
          id: "account-1",
          mail: "Bot@Genvest.com.au",
          userPrincipalName: "bot@genvest.com.au",
          displayName: "Sales Bot"
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    try {
      const service = createService(tempDir, fetchMock);
      const connect = await service.createConnectUrl({
        actorId: "genvest-head-of-sales",
        actorEmail: "bot@genvest.com.au",
        actorName: "@sales_bot"
      });
      const state = new URL(connect.authorizeUrl).searchParams.get("state")!;

      const callback = await service.completeCallback({ state, code: "auth-code" });

      expect(callback).toMatchObject({
        provider: "microsoft",
        actor: {
          actorId: "genvest-head-of-sales",
          actorEmail: "bot@genvest.com.au",
          actorName: "@sales_bot"
        },
        upstreamLogin: "bot@genvest.com.au",
        tenantId: "tenant-1",
        status: "connected"
      });
      await expect(service.completeCallback({ state, code: "auth-code" })).rejects.toThrow(
        "Unknown or expired Microsoft OAuth state."
      );
      await expect(service.status("genvest-head-of-sales")).resolves.toMatchObject({
        provider: "microsoft",
        status: "connected",
        actorId: "genvest-head-of-sales",
        actorEmail: "bot@genvest.com.au",
        upstreamLogin: "bot@genvest.com.au",
        scopes: ["offline_access", "User.Read", "Mail.Read", "Calendars.Read"]
      });

      const stored = readFileSync(join(tempDir, "microsoft-tokens.json"), "utf8");
      expect(stored).not.toContain("access-token");
      expect(stored).not.toContain("refresh-token");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects callback when Microsoft login is outside the allowed domain", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "template-gateway-ms-"));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/token")) {
        return jsonResponse({
          access_token: "access-token",
          refresh_token: "refresh-token",
          token_type: "Bearer",
          scope: "offline_access User.Read",
          expires_in: 3600
        });
      }
      return jsonResponse({
        id: "account-1",
        mail: "person@example.com",
        userPrincipalName: "person@example.com"
      });
    });

    try {
      const service = createService(tempDir, fetchMock);
      const connect = await service.createConnectUrl({ actorEmail: "bot@genvest.com.au" });
      const state = new URL(connect.authorizeUrl).searchParams.get("state")!;

      await expect(service.completeCallback({ state, code: "auth-code" })).rejects.toThrow(
        "Microsoft login domain is not allowed: person@example.com"
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

function createService(tempDir: string, fetchImpl: typeof fetch = vi.fn() as any): MicrosoftProviderService {
  return new MicrosoftProviderService({
    config: {
      clientId: "client-1",
      clientSecret: "secret-1",
      tenantId: "tenant-1",
      redirectUri: "https://gateway.example.com/auth/microsoft/callback",
      allowedTenants: ["tenant-1"],
      allowedDomains: ["genvest.com.au"],
      tokenStorePath: join(tempDir, "microsoft-tokens.json"),
      tokenStoreKey: TOKEN_KEY,
      scopes: ["offline_access", "User.Read", "Mail.Read", "Calendars.Read"],
      graphRequestPathAllowlist: ["/me", "/me/messages", "/me/calendar"],
      sendEmailEnabled: false
    },
    stateStore: new MicrosoftOAuthStateStore(join(tempDir, "microsoft-states.json")),
    tokenStore: new MicrosoftTokenStore(join(tempDir, "microsoft-tokens.json"), TOKEN_KEY),
    fetch: fetchImpl
  });
}

// ---------------------------------------------------------------------------
// requireValidAccessToken helpers
// ---------------------------------------------------------------------------

async function setupBoundService(
  opts: { scope: string; expiresInSec: number },
  fetchImpl: typeof fetch = vi.fn() as any
): Promise<{ service: MicrosoftProviderService; cleanup: () => void }> {
  const tempDir = mkdtempSync(join(tmpdir(), "template-gateway-ms-bound-"));
  const tokenStore = new MicrosoftTokenStore(join(tempDir, "microsoft-tokens.json"), TOKEN_KEY);
  const expiresAt =
    opts.expiresInSec <= 0
      ? new Date(Date.now() - 1000).toISOString()
      : new Date(Date.now() + opts.expiresInSec * 1000).toISOString();

  await tokenStore.saveConnectedBinding({
    actorId: "bot@example.com",
    actorEmail: "bot@example.com",
    actorName: "Test Bot",
    upstreamLogin: "bot@example.com",
    tenantId: "tenant-1",
    scope: opts.scope,
    expiresAt,
    payload: {
      accessToken: "bound-access-token",
      refreshToken: "bound-refresh-token",
      tokenType: "Bearer",
      scope: opts.scope,
      expiresAt
    }
  });

  const service = new MicrosoftProviderService({
    config: {
      clientId: "client-1",
      clientSecret: "secret-1",
      tenantId: "tenant-1",
      redirectUri: "https://gateway.example.com/auth/microsoft/callback",
      allowedTenants: ["tenant-1"],
      allowedDomains: ["example.com"],
      tokenStorePath: join(tempDir, "microsoft-tokens.json"),
      tokenStoreKey: TOKEN_KEY,
      scopes: ["offline_access", "User.Read", "Mail.Read", "Calendars.Read"],
      graphRequestPathAllowlist: ["/me", "/me/messages", "/me/calendar"],
      sendEmailEnabled: false
    },
    stateStore: new MicrosoftOAuthStateStore(join(tempDir, "microsoft-states.json")),
    tokenStore,
    fetch: fetchImpl
  });

  return { service, cleanup: () => rmSync(tempDir, { recursive: true, force: true }) };
}

async function setupUnboundService(
  fetchImpl: typeof fetch = vi.fn() as any
): Promise<{ service: MicrosoftProviderService; cleanup: () => void }> {
  const tempDir = mkdtempSync(join(tmpdir(), "template-gateway-ms-unbound-"));
  const service = new MicrosoftProviderService({
    config: {
      clientId: "client-1",
      clientSecret: "secret-1",
      tenantId: "tenant-1",
      redirectUri: "https://gateway.example.com/auth/microsoft/callback",
      allowedTenants: ["tenant-1"],
      allowedDomains: ["example.com"],
      tokenStorePath: join(tempDir, "microsoft-tokens.json"),
      tokenStoreKey: TOKEN_KEY,
      scopes: ["offline_access", "User.Read", "Mail.Read", "Calendars.Read"],
      graphRequestPathAllowlist: ["/me", "/me/messages", "/me/calendar"],
      sendEmailEnabled: false
    },
    stateStore: new MicrosoftOAuthStateStore(join(tempDir, "microsoft-states.json")),
    tokenStore: new MicrosoftTokenStore(join(tempDir, "microsoft-tokens.json"), TOKEN_KEY),
    fetch: fetchImpl
  });
  return { service, cleanup: () => rmSync(tempDir, { recursive: true, force: true }) };
}

// ---------------------------------------------------------------------------
// requireValidAccessToken tests
// ---------------------------------------------------------------------------

describe("MicrosoftProviderService.requireValidAccessToken", () => {
  it("returns bound access token when not expired", async () => {
    const { service, cleanup } = await setupBoundService({ scope: "offline_access User.Read Mail.Read", expiresInSec: 3600 });
    try {
      const result = await service.requireValidAccessToken("bot@example.com", "Mail.Read");
      expect(result.accessToken).toBe("bound-access-token");
      expect(result.scopes).toContain("Mail.Read");
    } finally {
      cleanup();
    }
  });

  it("refreshes when expired", async () => {
    let exchanged = false;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/oauth2/v2.0/token") && init?.method === "POST") {
        exchanged = true;
        return jsonResponse({
          access_token: "fresh-access-token",
          refresh_token: "fresh-refresh-token",
          token_type: "Bearer",
          scope: "offline_access User.Read Mail.Read",
          expires_in: 3600
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    const { service, cleanup } = await setupBoundService(
      { scope: "offline_access User.Read Mail.Read", expiresInSec: -1 },
      fetchImpl
    );
    try {
      const result = await service.requireValidAccessToken("bot@example.com", "Mail.Read");
      expect(exchanged).toBe(true);
      expect(result.accessToken).toBe("fresh-access-token");
    } finally {
      cleanup();
    }
  });

  it("marks reconnect_required and throws on invalid_grant", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/oauth2/v2.0/token") && init?.method === "POST") {
        return {
          ok: false,
          status: 400,
          json: async () => ({ error: "invalid_grant", error_description: "Token has expired" }),
          text: async () => JSON.stringify({ error: "invalid_grant" })
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    const { service, cleanup } = await setupBoundService(
      { scope: "offline_access User.Read Mail.Read", expiresInSec: -1 },
      fetchImpl
    );
    try {
      await expect(
        service.requireValidAccessToken("bot@example.com", "Mail.Read")
      ).rejects.toThrow(/reconnect_required/i);

      const statusResult = await service.status("bot@example.com");
      expect(statusResult.status).toBe("reconnect_required");
    } finally {
      cleanup();
    }
  });

  it("rejects when required scope is missing from binding", async () => {
    const { service, cleanup } = await setupBoundService({ scope: "offline_access User.Read Mail.Read", expiresInSec: 3600 });
    try {
      await expect(
        service.requireValidAccessToken("bot@example.com", "Mail.Send")
      ).rejects.toThrow(/required scope.*Mail\.Send/i);
    } finally {
      cleanup();
    }
  });

  it("rejects when actor is not bound", async () => {
    const { service, cleanup } = await setupUnboundService();
    try {
      await expect(
        service.requireValidAccessToken("bot@example.com", "User.Read")
      ).rejects.toThrow(/not connected|no binding/i);
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// listMessages tests
// ---------------------------------------------------------------------------

describe("MicrosoftProviderService.listMessages", () => {
  it("returns Graph messages page for a connected actor", async () => {
    const captured: string[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      captured.push(url);
      if (typeof url === "string" && url.startsWith("https://graph.microsoft.com/v1.0/me/messages")) {
        const headers = init?.headers as Record<string, string>;
        expect(headers.Authorization).toBe("Bearer bound-access-token");
        return new Response(JSON.stringify({
          value: [{ id: "AAA", subject: "Hello", from: { emailAddress: { address: "x@example.com" } } }],
          "@odata.nextLink": null
        }), { status: 200 });
      }
      throw new Error(`Unexpected URL: ${url}`);
    }) as typeof fetch;
    const ctx = await setupBoundService({ scope: "offline_access User.Read Mail.Read", expiresInSec: 3600 }, fetchImpl);
    const result = await ctx.service.listMessages("bot@example.com", { top: 5, query: "from:x@example.com" });
    expect((result.messages[0] as { id: string }).id).toBe("AAA");
    expect(captured[0]).toContain("$top=5");
    expect(captured[0]).toContain("$search=");
    ctx.cleanup();
  });

  it("rejects when Mail.Read is not bound", async () => {
    const ctx = await setupBoundService({ scope: "offline_access User.Read", expiresInSec: 3600 });
    await expect(ctx.service.listMessages("bot@example.com", {})).rejects.toThrow(/Mail\.Read/);
    ctx.cleanup();
  });
});

// ---------------------------------------------------------------------------
// listEvents tests
// ---------------------------------------------------------------------------

describe("MicrosoftProviderService.listEvents", () => {
  it("returns Graph events for a connected actor with Calendars.Read", async () => {
    const captured: string[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      captured.push(url);
      if (typeof url === "string" && url.startsWith("https://graph.microsoft.com/v1.0/me/calendar/events")) {
        const headers = init?.headers as Record<string, string>;
        expect(headers.Authorization).toBe("Bearer bound-access-token");
        return new Response(JSON.stringify({
          value: [{ id: "EVT1", subject: "Standup", start: { dateTime: "2026-05-25T09:00:00", timeZone: "UTC" } }],
          "@odata.nextLink": null
        }), { status: 200 });
      }
      throw new Error(`Unexpected URL: ${url}`);
    }) as typeof fetch;
    const ctx = await setupBoundService({ scope: "offline_access User.Read Calendars.Read", expiresInSec: 3600 }, fetchImpl);
    const result = await ctx.service.listEvents("bot@example.com", { top: 10 });
    expect((result.events[0] as { subject: string }).subject).toBe("Standup");
    expect(captured[0]).toContain("$top=10");
    ctx.cleanup();
  });

  it("rejects when Calendars.Read is not bound", async () => {
    const ctx = await setupBoundService({ scope: "offline_access User.Read", expiresInSec: 3600 });
    await expect(ctx.service.listEvents("bot@example.com", {})).rejects.toThrow(/Calendars\.Read/);
    ctx.cleanup();
  });

  it("includes encoded $filter with start/dateTime ge and end/dateTime le when timeMin and timeMax are supplied", async () => {
    const captured: string[] = [];
    const fetchImpl = (async (url: string) => {
      captured.push(url);
      if (typeof url === "string" && url.startsWith("https://graph.microsoft.com/v1.0/me/calendar/events")) {
        return new Response(JSON.stringify({ value: [], "@odata.nextLink": null }), { status: 200 });
      }
      throw new Error(`Unexpected URL: ${url}`);
    }) as typeof fetch;
    const ctx = await setupBoundService({ scope: "offline_access User.Read Calendars.Read", expiresInSec: 3600 }, fetchImpl);
    await ctx.service.listEvents("bot@example.com", {
      top: 25,
      timeMin: "2026-05-25T00:00:00Z",
      timeMax: "2026-05-26T00:00:00Z"
    });
    // $filter must be present and URL-encoded
    expect(captured[0]).toContain("$filter=");
    // single-side filter parts should be visible after decoding
    expect(decodeURIComponent(captured[0])).toContain("start/dateTime ge '2026-05-25T00:00:00Z'");
    expect(decodeURIComponent(captured[0])).toContain("end/dateTime le '2026-05-26T00:00:00Z'");
    expect(decodeURIComponent(captured[0])).toContain(" and ");
    ctx.cleanup();
  });
});

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body)
  } as Response;
}
