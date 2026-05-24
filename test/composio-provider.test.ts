import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ComposioBindingStore } from "../src/providers/composio/binding-store.js";
import { ComposioSdkSessionClient } from "../src/providers/composio/factory.js";
import { composioUserIdForActor, ComposioProviderService } from "../src/providers/composio/service.js";
import type { ComposioSessionClient } from "../src/providers/composio/types.js";

describe("Composio provider", () => {
  it("maps gateway actors to deterministic non-default Composio user ids", () => {
    expect(composioUserIdForActor("genvest", { actorId: "genvest-head-of-sales", actorEmail: "bot@genvest.com.au" }))
      .toBe("genvest:actor:genvest-head-of-sales");
    expect(composioUserIdForActor("genvest", { actorEmail: "Lee@Genvest.com.au" }))
      .toBe("genvest:actor:lee@genvest.com.au");
    expect(composioUserIdForActor("default", { actorEmail: "lee@example.com" }))
      .toBe("default:actor:lee@example.com");
  });

  it("returns a hosted connect URL and stores an actor/provider binding when disconnected", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "template-gateway-composio-"));
    const client = createClient({
      toolkits: [{ slug: "outlook", isActive: false }]
    });

    try {
      const service = createService(tempDir, client);

      const result = await service.createConnectUrl("microsoft-composio", {
        actorId: "genvest-head-of-sales",
        actorEmail: "Sales_Bot@Genvest.com.au",
        actorName: "@sales_bot"
      });

      expect(result).toMatchObject({
        provider: "microsoft-composio",
        backend: "composio",
        status: "authorization_required",
        authorizeUrl: "https://connect.composio.dev/link/ln_123",
        composioUserId: "genvest:actor:genvest-head-of-sales",
        sessionId: "session-1"
      });
      expect(client.createSession).toHaveBeenCalledWith({
        userId: "genvest:actor:genvest-head-of-sales",
        toolkits: ["outlook", "calendar", "onedrive"],
        authConfigs: { outlook: "ac_outlook" },
        connectedAccounts: undefined,
        workbenchEnabled: false
      });
      expect(client.authorize).toHaveBeenCalledWith({
        sessionId: "session-1",
        toolkit: "outlook",
        callbackUrl: undefined
      });

      await expect(service.status("microsoft-composio", "genvest-head-of-sales")).resolves.toMatchObject({
        provider: "microsoft-composio",
        backend: "composio",
        status: "authorization_required",
        actorId: "genvest-head-of-sales",
        actorEmail: "sales_bot@genvest.com.au",
        composioUserId: "genvest:actor:genvest-head-of-sales"
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("stores connected account ids and returns an MCP URL pinned to the account", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "template-gateway-composio-"));
    const client = createClient({
      sessionId: "session-connected",
      mcpUrl: "https://platform.composio.dev/v3/mcp/mcp_123?user_id=genvest%3Aactor%3Alee",
      toolkits: [{ slug: "gmail", isActive: true, connectedAccountId: "ca_gmail_1" }]
    });

    try {
      const service = createService(tempDir, client);

      await expect(service.refreshStatus("google-composio", {
        actorId: "lee",
        actorEmail: "lee@genvest.com.au"
      })).resolves.toMatchObject({
        provider: "google-composio",
        status: "connected",
        connectedAccountIds: ["ca_gmail_1"]
      });

      const mcp = await service.mcpUrl("google-composio", "lee");

      expect(mcp).toMatchObject({
        provider: "google-composio",
        status: "connected",
        connectedAccountId: "ca_gmail_1",
        mcpUrl: "https://platform.composio.dev/v3/mcp/mcp_123?connected_account_id=ca_gmail_1"
      });
      expect(mcp.mcpUrl).not.toContain("user_id=default");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("adapts Composio SDK sessions to the gateway session client interface", async () => {
    const sdkSession = {
      sessionId: "session-sdk",
      mcp: { url: "https://platform.composio.dev/v3/mcp/mcp_sdk" },
      authorize: vi.fn(async () => ({ redirectUrl: "https://connect.composio.dev/link/ln_sdk" })),
      toolkits: vi.fn(async () => ({
        items: [
          {
            slug: "outlook",
            connection: {
              isActive: true,
              connectedAccount: { id: "ca_outlook_1" }
            }
          },
          {
            slug: "calendar",
            connection: {
              isActive: false
            }
          }
        ]
      }))
    };
    const sdk = {
      create: vi.fn(async () => sdkSession),
      use: vi.fn(async () => sdkSession)
    };
    const client = new ComposioSdkSessionClient("cmp_test", sdk as any);

    await expect(client.createSession({
      userId: "genvest:actor:bot",
      toolkits: ["outlook", "calendar"],
      authConfigs: { outlook: "ac_outlook" },
      connectedAccounts: undefined,
      workbenchEnabled: false
    })).resolves.toEqual({
      id: "session-sdk",
      mcpUrl: "https://platform.composio.dev/v3/mcp/mcp_sdk"
    });

    expect(sdk.create).toHaveBeenCalledWith("genvest:actor:bot", {
      toolkits: ["outlook", "calendar"],
      authConfigs: { outlook: "ac_outlook" },
      connectedAccounts: undefined,
      workbench: { enable: false }
    });

    await expect(client.authorize({
      sessionId: "session-sdk",
      toolkit: "outlook",
      callbackUrl: "https://gateway.example.com/callback"
    })).resolves.toEqual({
      redirectUrl: "https://connect.composio.dev/link/ln_sdk"
    });
    expect(sdkSession.authorize).toHaveBeenCalledWith("outlook", {
      callbackUrl: "https://gateway.example.com/callback"
    });

    await expect(client.listToolkits("session-sdk")).resolves.toEqual([
      { slug: "outlook", isActive: true, connectedAccountId: "ca_outlook_1" },
      { slug: "calendar", isActive: false, connectedAccountId: undefined }
    ]);
  });
});

function createService(tempDir: string, client: ComposioSessionClient): ComposioProviderService {
  return new ComposioProviderService({
    config: {
      apiKey: "cmp_test",
      bindingStorePath: join(tempDir, "composio-bindings.json"),
      clientSlug: "genvest",
      authConfigs: { outlook: "ac_outlook" },
      providers: {
        microsoft: {
          toolkits: ["outlook", "calendar", "onedrive"],
          primaryToolkit: "outlook"
        },
        google: {
          toolkits: ["gmail", "googlecalendar", "googledrive"],
          primaryToolkit: "gmail"
        }
      }
    },
    bindingStore: new ComposioBindingStore(join(tempDir, "composio-bindings.json")),
    client
  });
}

function createClient(options: {
  sessionId?: string;
  mcpUrl?: string;
  toolkits: Array<{ slug: string; isActive: boolean; connectedAccountId?: string }>;
}): ComposioSessionClient {
  return {
    createSession: vi.fn(async () => ({
      id: options.sessionId ?? "session-1",
      mcpUrl: options.mcpUrl ?? "https://platform.composio.dev/v3/mcp/mcp_123"
    })),
    authorize: vi.fn(async () => ({
      redirectUrl: "https://connect.composio.dev/link/ln_123"
    })),
    listToolkits: vi.fn(async () => options.toolkits)
  };
}
