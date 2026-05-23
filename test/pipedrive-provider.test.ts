import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PipedriveProviderService, pipedriveBaseUrl } from "../src/providers/pipedrive/service.js";
import { PipedriveOAuthStateStore } from "../src/providers/pipedrive/state-store.js";
import { PipedriveTokenStore } from "../src/providers/pipedrive/token-store.js";

const TOKEN_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

describe("Pipedrive provider — pipedriveBaseUrl helper", () => {
  it("uses api_domain verbatim when it is a full URL", () => {
    expect(pipedriveBaseUrl("https://acme.pipedrive.com", undefined)).toBe("https://acme.pipedrive.com");
  });

  it("prepends https:// when api_domain is a bare host", () => {
    expect(pipedriveBaseUrl("acme.pipedrive.com", undefined)).toBe("https://acme.pipedrive.com");
  });

  it("strips trailing slashes from api_domain", () => {
    expect(pipedriveBaseUrl("https://acme.pipedrive.com/", undefined)).toBe("https://acme.pipedrive.com");
  });

  it("falls back to companyDomain when api_domain is missing", () => {
    expect(pipedriveBaseUrl(undefined, "acme")).toBe("https://acme.pipedrive.com");
  });

  it("prefers api_domain over companyDomain when both are present", () => {
    expect(pipedriveBaseUrl("https://realtenant.pipedrive.com", "wrong-fallback")).toBe(
      "https://realtenant.pipedrive.com"
    );
  });

  it("returns undefined when neither api_domain nor companyDomain is available", () => {
    expect(pipedriveBaseUrl(undefined, undefined)).toBeUndefined();
    expect(pipedriveBaseUrl("", "")).toBeUndefined();
  });
});

describe("Pipedrive provider", () => {
  it("creates a connect URL with actor state", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "template-gateway-pd-"));
    try {
      const service = createService(tempDir);

      const result = await service.createConnectUrl({
        actorId: "genvest-head-of-sales",
        actorEmail: "bot@genvest.com.au",
        actorName: "@sales_bot"
      });

      const url = new URL(result.authorizeUrl);
      expect(url.origin + url.pathname).toBe("https://oauth.pipedrive.com/oauth/authorize");
      expect(url.searchParams.get("client_id")).toBe("client-1");
      expect(url.searchParams.get("redirect_uri")).toBe("https://gateway.example.com/auth/pipedrive/callback");
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

  it("rejects connect requests for actor email domains outside the Pipedrive gate", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "template-gateway-pd-"));
    try {
      const service = createService(tempDir);

      await expect(service.createConnectUrl({ actorEmail: "bot@example.com" })).rejects.toThrow(
        "Pipedrive actor email domain is not allowed: bot@example.com"
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("completes callback using api_domain from the token response and stores the binding encrypted", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "template-gateway-pd-"));
    let usersMeUrl: string | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/oauth/token")) {
        expect(init?.method).toBe("POST");
        const headers = init?.headers as Record<string, string> | undefined;
        expect(headers?.Authorization).toMatch(/^Basic /);
        return jsonResponse({
          access_token: "access-token",
          refresh_token: "refresh-token",
          token_type: "Bearer",
          scope: "deals:read deals:full",
          expires_in: 3600,
          api_domain: "https://realtenant.pipedrive.com"
        });
      }
      if (url.endsWith("/v1/users/me")) {
        usersMeUrl = url;
        const headers = init?.headers as Record<string, string> | undefined;
        expect(headers?.Authorization).toBe("Bearer access-token");
        return jsonResponse({
          data: {
            email: "David@Genvest.com.au ",
            name: " David Genvest "
          }
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

      // CRITICAL: users/me must be called against api_domain from the token response,
      // not the configured companyDomain fallback. This is the structural fix for
      // PIPEDRIVE_EMAIL_UNRESOLVED in gateway-genvest and service-api.
      expect(usersMeUrl).toBe("https://realtenant.pipedrive.com/v1/users/me");

      expect(callback).toMatchObject({
        provider: "pipedrive",
        actor: {
          actorId: "genvest-head-of-sales",
          actorEmail: "bot@genvest.com.au",
          actorName: "@sales_bot"
        },
        upstreamLogin: "david@genvest.com.au",
        upstreamName: "David Genvest",
        apiDomain: "https://realtenant.pipedrive.com",
        status: "connected"
      });

      await expect(service.completeCallback({ state, code: "auth-code" })).rejects.toThrow(
        "Unknown or expired Pipedrive OAuth state."
      );

      await expect(service.status("genvest-head-of-sales")).resolves.toMatchObject({
        provider: "pipedrive",
        status: "connected",
        actorId: "genvest-head-of-sales",
        actorEmail: "bot@genvest.com.au",
        upstreamLogin: "david@genvest.com.au",
        apiDomain: "https://realtenant.pipedrive.com",
        scopes: ["deals:read", "deals:full"]
      });

      const stored = readFileSync(join(tempDir, "pipedrive-tokens.json"), "utf8");
      expect(stored).not.toContain("access-token");
      expect(stored).not.toContain("refresh-token");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("falls back to PIPEDRIVE_COMPANY_DOMAIN when the token response omits api_domain", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "template-gateway-pd-"));
    let usersMeUrl: string | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/oauth/token")) {
        return jsonResponse({
          access_token: "access-token",
          token_type: "Bearer"
          // no api_domain
        });
      }
      if (url.endsWith("/v1/users/me")) {
        usersMeUrl = url;
        return jsonResponse({ data: { email: "ops@genvest.com.au", name: "Ops" } });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    try {
      const service = createService(tempDir, fetchMock, { companyDomain: "fallback-acme" });
      const connect = await service.createConnectUrl({ actorEmail: "bot@genvest.com.au" });
      const state = new URL(connect.authorizeUrl).searchParams.get("state")!;

      await service.completeCallback({ state, code: "auth-code" });
      expect(usersMeUrl).toBe("https://fallback-acme.pipedrive.com/v1/users/me");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("surfaces a loud error (not a silent bind) when users/me responds non-OK", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "template-gateway-pd-"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/oauth/token")) {
        return jsonResponse({
          access_token: "access-token",
          token_type: "Bearer",
          api_domain: "https://wrong-tenant.pipedrive.com"
        });
      }
      if (url.endsWith("/v1/users/me")) {
        return {
          ok: false,
          status: 404,
          statusText: "Not Found",
          json: async () => ({ error: "company_not_found" }),
          text: async () => '{"error":"company_not_found"}'
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    try {
      const service = createService(tempDir, fetchMock);
      const connect = await service.createConnectUrl({ actorEmail: "bot@genvest.com.au" });
      const state = new URL(connect.authorizeUrl).searchParams.get("state")!;

      await expect(service.completeCallback({ state, code: "auth-code" })).rejects.toThrow(
        "Could not determine the authorizing Pipedrive user's email."
      );
      expect(warnSpy).toHaveBeenCalled();
      expect((warnSpy.mock.calls[0][0] as string)).toMatch(/404 Not Found/);
    } finally {
      warnSpy.mockRestore();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects callback when the upstream Pipedrive email is outside the allowed domain", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "template-gateway-pd-"));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/oauth/token")) {
        return jsonResponse({
          access_token: "access-token",
          token_type: "Bearer",
          api_domain: "https://realtenant.pipedrive.com"
        });
      }
      return jsonResponse({ data: { email: "person@example.com" } });
    });

    try {
      const service = createService(tempDir, fetchMock);
      const connect = await service.createConnectUrl({ actorEmail: "bot@genvest.com.au" });
      const state = new URL(connect.authorizeUrl).searchParams.get("state")!;

      await expect(service.completeCallback({ state, code: "auth-code" })).rejects.toThrow(
        "Pipedrive login domain is not allowed: person@example.com"
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

function createService(
  tempDir: string,
  fetchImpl: typeof fetch = vi.fn() as any,
  overrides: { companyDomain?: string } = {}
): PipedriveProviderService {
  return new PipedriveProviderService({
    config: {
      clientId: "client-1",
      clientSecret: "secret-1",
      redirectUri: "https://gateway.example.com/auth/pipedrive/callback",
      companyDomain: overrides.companyDomain,
      allowedDomains: ["genvest.com.au"],
      tokenStorePath: join(tempDir, "pipedrive-tokens.json"),
      tokenStoreKey: TOKEN_KEY,
      scopes: [],
      authorizeUrl: "https://oauth.pipedrive.com/oauth/authorize",
      tokenUrl: "https://oauth.pipedrive.com/oauth/token"
    },
    stateStore: new PipedriveOAuthStateStore(join(tempDir, "pipedrive-states.json")),
    tokenStore: new PipedriveTokenStore(join(tempDir, "pipedrive-tokens.json"), TOKEN_KEY),
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
