import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { buildCli } from "../src/cli.js";

describe("buildCli", () => {
  it("prints doctor output", async () => {
    const output: string[] = [];
    const cli = buildCli({ write: (line) => output.push(line) });
    await cli.parseAsync(["node", "gateway", "doctor"], { from: "node" });
    expect(output.join("\n")).toContain("template-gateway: ok");
  });

  it("prints provider output", async () => {
    const output: string[] = [];
    const cli = buildCli({ write: (line) => output.push(line) });
    await cli.parseAsync(["node", "gateway", "providers"], { from: "node" });
    expect(output).toEqual(["microsoft: Microsoft 365 (/mcp/microsoft)"]);
  });

  it("prints injected provider output", async () => {
    const output: string[] = [];
    const cli = buildCli({
      write: (line) => output.push(line),
      providers: [
        {
          slug: "microsoft",
          name: "Microsoft 365",
          description: "Outlook, Calendar, OneDrive",
          auth: "oauth",
          mcpPath: "/mcp/microsoft",
          scopesSummary: "Read and write Microsoft 365 data."
        }
      ]
    });

    await cli.parseAsync(["node", "gateway", "providers"], { from: "node" });

    expect(output).toEqual(["microsoft: Microsoft 365 (/mcp/microsoft)"]);
  });

  it("prints empty sessions output", async () => {
    const output: string[] = [];
    const cli = buildCli({
      write: (line) => output.push(line),
      sessionStore: {
        listSessions: async () => []
      }
    });

    await cli.parseAsync(["node", "gateway", "sessions"], { from: "node" });

    expect(output).toEqual(["No sessions"]);
  });

  it("prints listed sessions output", async () => {
    const output: string[] = [];
    const cli = buildCli({
      write: (line) => output.push(line),
      sessionStore: {
        listSessions: async () => [
          {
            email: "lee@genvest.com.au",
            clientId: "claude",
            scopes: ["mcp:tools", "providers:read"],
            createdAt: "2026-05-23T00:00:00.000Z"
          }
        ]
      }
    });

    await cli.parseAsync(["node", "gateway", "sessions"], { from: "node" });

    expect(output).toEqual(["lee@genvest.com.au: claude [mcp:tools,providers:read] 2026-05-23T00:00:00.000Z"]);
  });

  it("prints Microsoft connect and status output without token material", async () => {
    const output: string[] = [];
    const cli = buildCli({
      write: (line) => output.push(line),
      microsoftProvider: {
        createConnectUrl: async () => ({
          provider: "microsoft",
          authorizeUrl: "https://login.microsoftonline.com/tenant/oauth2/v2.0/authorize?state=state-1",
          actor: { actorId: "genvest-head-of-sales", actorEmail: "bot@genvest.com.au" },
          expiresAt: "2026-05-23T01:00:00.000Z"
        }),
        status: async () => ({
          provider: "microsoft",
          status: "connected",
          actorId: "genvest-head-of-sales",
          actorEmail: "bot@genvest.com.au",
          upstreamLogin: "bot@genvest.com.au",
          scopes: ["User.Read", "Mail.Read"],
          expiresAt: "2026-05-23T02:00:00.000Z"
        })
      }
    });

    await cli.parseAsync(["node", "gateway", "microsoft", "connect", "--actor", "bot@genvest.com.au", "--actor-id", "genvest-head-of-sales"], { from: "node" });
    await cli.parseAsync(["node", "gateway", "microsoft", "status", "--actor", "genvest-head-of-sales"], { from: "node" });

    expect(output).toEqual([
      "https://login.microsoftonline.com/tenant/oauth2/v2.0/authorize?state=state-1",
      "microsoft: connected genvest-head-of-sales -> bot@genvest.com.au [User.Read,Mail.Read] expires 2026-05-23T02:00:00.000Z"
    ]);
    expect(output.join("\n")).not.toContain("access");
    expect(output.join("\n")).not.toContain("refresh");
  });

  it("prints doctor output from injected config", async () => {
    const output: string[] = [];
    const originalApiBaseUrl = process.env.API_BASE_URL;
    process.env.API_BASE_URL = "https://ambient.example.com";
    const cli = buildCli({
      write: (line) => output.push(line),
      loadConfig: () => ({
        port: 3000,
        apiBaseUrl: "https://injected.example.com",
        allowedEmailDomains: ["injected.example.com"],
        tokenStorePath: "./tokens.json",
        auditLogPath: "./audit.jsonl",
        apiBearerTokens: [],
        enableComposioProviders: false,
        enabledProviders: ["microsoft"],
        microsoft: {
          clientId: undefined,
          clientSecret: undefined,
          tenantId: undefined,
          redirectUri: "https://injected.example.com/auth/microsoft/callback",
          allowedTenants: [],
          allowedDomains: ["injected.example.com"],
          tokenStorePath: "./microsoft-tokens.json",
          tokenStoreKey: undefined,
          scopes: ["offline_access", "User.Read", "Mail.Read", "Calendars.Read"]
        },
        pipedrive: {
          clientId: undefined,
          clientSecret: undefined,
          redirectUri: "https://injected.example.com/auth/pipedrive/callback",
          companyDomain: undefined,
          allowedDomains: ["injected.example.com"],
          tokenStorePath: "./pipedrive-tokens.json",
          tokenStoreKey: undefined,
          scopes: [],
          authorizeUrl: "https://oauth.pipedrive.com/oauth/authorize",
          tokenUrl: "https://oauth.pipedrive.com/oauth/token"
        }
      })
    });

    try {
      await cli.parseAsync(["node", "gateway", "doctor"], { from: "node" });
    } finally {
      if (originalApiBaseUrl === undefined) {
        delete process.env.API_BASE_URL;
      } else {
        process.env.API_BASE_URL = originalApiBaseUrl;
      }
    }

    expect(output).toEqual([
      "template-gateway: ok",
      "apiBaseUrl: https://injected.example.com",
      "allowedEmailDomains: injected.example.com"
    ]);
  });

  it("reports invalid config as a concise cli error", async () => {
    const output: string[] = [];
    const errors: string[] = [];
    const cli = buildCli({
      write: (line) => output.push(line),
      writeError: (line) => errors.push(line),
      loadConfig: () => {
        throw new Error("Expected decimal integer value, received: abc");
      }
    });

    await expect(cli.parseAsync(["node", "gateway", "doctor"], { from: "node" })).rejects.toThrow(
      "Configuration error: Expected decimal integer value, received: abc"
    );

    expect(output).toEqual([]);
    expect(errors).toEqual(["Configuration error: Expected decimal integer value, received: abc"]);
  });

  it("does not execute the template cli when imported by a different cli wrapper", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "template-gateway-cli-"));
    const wrapperPath = join(tempDir, "client-cli.js");
    const cliUrl = pathToFileURL(resolve("src/cli.ts")).href;

    writeFileSync(join(tempDir, "package.json"), JSON.stringify({ type: "module" }));
    writeFileSync(
      wrapperPath,
      [
        `import { buildCli } from ${JSON.stringify(cliUrl)};`,
        `const cli = buildCli({ write: (line) => console.log("wrapper:" + line), providers: [] });`,
        `console.log("imported:" + typeof cli.parseAsync);`
      ].join("\n")
    );

    try {
      const result = spawnSync(process.execPath, ["--import", "tsx", wrapperPath, "doctor"], {
        cwd: resolve("."),
        encoding: "utf8"
      });

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("imported:function\n");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Helpers for Composio flag-gate tests
// ---------------------------------------------------------------------------

function baseConfig() {
  return {
    port: 3000,
    apiBaseUrl: "http://localhost:3000",
    allowedEmailDomains: ["example.com"],
    tokenStorePath: "./tokens.json",
    auditLogPath: "./audit.jsonl",
    apiBearerTokens: [] as string[],
    enabledProviders: ["microsoft"],
    microsoft: {
      clientId: undefined,
      clientSecret: undefined,
      tenantId: undefined,
      redirectUri: "http://localhost:3000/auth/microsoft/callback",
      allowedTenants: [] as string[],
      allowedDomains: ["example.com"],
      tokenStorePath: "./microsoft-tokens.json",
      tokenStoreKey: undefined,
      scopes: ["offline_access", "User.Read"]
    },
    pipedrive: {
      clientId: undefined,
      clientSecret: undefined,
      redirectUri: "http://localhost:3000/auth/pipedrive/callback",
      companyDomain: undefined,
      allowedDomains: ["example.com"],
      tokenStorePath: "./pipedrive-tokens.json",
      tokenStoreKey: undefined,
      scopes: [] as string[],
      authorizeUrl: "https://oauth.pipedrive.com/oauth/authorize",
      tokenUrl: "https://oauth.pipedrive.com/oauth/token"
    }
  };
}

function composioConfig() {
  return {
    apiKey: "ck_test",
    bindingStorePath: "./composio-bindings.json",
    clientSlug: "local",
    authConfigs: {} as Record<string, string>,
    providers: {
      microsoft: { toolkits: ["outlook"], primaryToolkit: "outlook" },
      google: { toolkits: ["gmail"], primaryToolkit: "gmail" }
    }
  };
}

describe("CLI — composio commands are flag-gated", () => {
  it("does not register provider command when enableComposioProviders is false", () => {
    const cli = buildCli({
      write: () => {},
      loadConfig: () => ({ ...baseConfig(), enableComposioProviders: false, composio: undefined })
    });
    const commandNames = cli.commands.map((c) => c.name());
    expect(commandNames).not.toContain("provider");
  });

  it("registers provider command when enableComposioProviders is true", () => {
    const cli = buildCli({
      write: () => {},
      loadConfig: () => ({ ...baseConfig(), enableComposioProviders: true, composio: composioConfig() })
    });
    const commandNames = cli.commands.map((c) => c.name());
    expect(commandNames).toContain("provider");
  });

  it("registers provider connect, status, and mcp-url subcommands when flag is on", () => {
    const cli = buildCli({
      write: () => {},
      loadConfig: () => ({ ...baseConfig(), enableComposioProviders: true, composio: composioConfig() })
    });
    const providerCmd = cli.commands.find((c) => c.name() === "provider");
    expect(providerCmd).toBeDefined();
    const subNames = providerCmd!.commands.map((c) => c.name());
    expect(subNames).toContain("connect");
    expect(subNames).toContain("status");
    expect(subNames).toContain("mcp-url");
  });

  it("invokes composioProvider.createConnectUrl with the correct slug and actor", async () => {
    const calls: Array<{ provider: string; actor: unknown }> = [];
    const output: string[] = [];
    const cli = buildCli({
      write: (line) => output.push(line),
      loadConfig: () => ({ ...baseConfig(), enableComposioProviders: true, composio: composioConfig() }),
      composioProvider: {
        createConnectUrl: async (provider, actor) => {
          calls.push({ provider, actor });
          return {
            provider,
            backend: "composio" as const,
            status: "authorization_required" as const,
            actorId: "bot@example.com",
            actorEmail: "bot@example.com",
            connectedAccountIds: [],
            authorizeUrl: "https://composio.example.com/authorize?state=abc"
          };
        },
        status: async () => { throw new Error("unexpected"); },
        mcpUrl: async () => { throw new Error("unexpected"); }
      }
    });

    await cli.parseAsync(["node", "gateway", "provider", "connect", "microsoft-composio", "--actor", "bot@example.com"], { from: "node" });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.provider).toBe("microsoft-composio");
    expect(output).toEqual(["https://composio.example.com/authorize?state=abc"]);
  });

  it("invokes composioProvider.status for the provider status subcommand", async () => {
    const output: string[] = [];
    const cli = buildCli({
      write: (line) => output.push(line),
      loadConfig: () => ({ ...baseConfig(), enableComposioProviders: true, composio: composioConfig() }),
      composioProvider: {
        createConnectUrl: async () => { throw new Error("unexpected"); },
        status: async (provider, actorIdOrEmail) => ({
          provider,
          backend: "composio" as const,
          status: "connected" as const,
          actorId: actorIdOrEmail,
          connectedAccountIds: ["acc_123"]
        }),
        mcpUrl: async () => { throw new Error("unexpected"); }
      }
    });

    await cli.parseAsync(["node", "gateway", "provider", "status", "google-composio", "--actor", "user@example.com"], { from: "node" });

    expect(output).toEqual(["google-composio: connected user@example.com [acc_123]"]);
  });

  it("invokes composioProvider.mcpUrl for the provider mcp-url subcommand", async () => {
    const output: string[] = [];
    const cli = buildCli({
      write: (line) => output.push(line),
      loadConfig: () => ({ ...baseConfig(), enableComposioProviders: true, composio: composioConfig() }),
      composioProvider: {
        createConnectUrl: async () => { throw new Error("unexpected"); },
        status: async () => { throw new Error("unexpected"); },
        mcpUrl: async (provider, actorIdOrEmail) => ({
          provider,
          backend: "composio" as const,
          status: "connected" as const,
          actorId: actorIdOrEmail,
          connectedAccountIds: ["acc_456"],
          mcpUrl: "https://mcp.composio.dev/microsoft?connected_account_id=acc_456"
        })
      }
    });

    await cli.parseAsync(["node", "gateway", "provider", "mcp-url", "microsoft-composio", "--actor", "user@example.com"], { from: "node" });

    expect(output).toEqual(["https://mcp.composio.dev/microsoft?connected_account_id=acc_456"]);
  });
});
