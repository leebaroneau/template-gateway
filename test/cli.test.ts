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
    expect(output.join("\n")).toContain("No providers configured");
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
        apiBearerTokens: []
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
});
