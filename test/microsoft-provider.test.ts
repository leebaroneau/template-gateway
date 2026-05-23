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
      scopes: ["offline_access", "User.Read", "Mail.Read", "Calendars.Read"]
    },
    stateStore: new MicrosoftOAuthStateStore(join(tempDir, "microsoft-states.json")),
    tokenStore: new MicrosoftTokenStore(join(tempDir, "microsoft-tokens.json"), TOKEN_KEY),
    fetch: fetchImpl
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
