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
