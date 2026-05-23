import { describe, expect, it } from "vitest";
import request from "supertest";
import { createHttpApp } from "../src/http.js";

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
    expect(response.body.providers).toEqual([]);
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
});

function baseConfig() {
  return {
    port: 3000,
    apiBaseUrl: "http://localhost:3000",
    allowedEmailDomains: ["example.com"],
    tokenStorePath: "./data/tokens.json",
    auditLogPath: "./data/audit.jsonl",
    apiBearerTokens: []
  };
}
