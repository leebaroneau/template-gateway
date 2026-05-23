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
