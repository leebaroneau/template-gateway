import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { FixtureGatewayBackend } from "../src/admin/fixture-backend.js";
import { createAdminRouter } from "../src/admin/routes.js";
import { createApp } from "../src/index.js";
import type { GatewayConfig } from "../src/config.js";

function buildAdminApp(backend = new FixtureGatewayBackend()) {
  const app = express();
  app.disable("x-powered-by");
  app.use("/admin", createAdminRouter(backend));
  return { app, backend };
}

function testConfig(): GatewayConfig {
  return {
    composioApiKey: "ak_test",
    brandSlug: "haverford",
    gatewayBearer: "a_secret_thats_long_enough",
    port: 3000,
    sessionTtlSeconds: 3600
  };
}

describe("admin routes", () => {
  it("mounts the admin HTML shell under /admin without changing health routing", async () => {
    const app = createApp(testConfig());

    const admin = await request(app).get("/admin");
    const health = await request(app).get("/health");

    expect(admin.status).toBe(200);
    expect(admin.headers["content-type"]).toContain("text/html");
    expect(admin.text).toContain("Haverford Unified Gateway");
    expect(admin.text).toContain("/admin/style.css");
    expect(admin.text).toContain("/admin/app.js");
    expect(admin.text).toContain("Overview");
    expect(admin.text).toContain("Brands");
    expect(admin.text).toContain("Connectors");
    expect(admin.text).toContain("API Access");
    expect(admin.text).toContain("Audit");
    expect(health.status).toBe(200);
    expect(health.body).toMatchObject({ status: "ok", brand: "haverford" });
  });

  it("serves admin CSS and browser JavaScript assets", async () => {
    const { app } = buildAdminApp();

    const css = await request(app).get("/admin/style.css");
    const js = await request(app).get("/admin/app.js");

    expect(css.status).toBe(200);
    expect(css.headers["content-type"]).toContain("text/css");
    expect(css.text).toContain(".admin-shell");
    expect(js.status).toBe(200);
    expect(js.headers["content-type"]).toContain("javascript");
    expect(js.text).toContain("/admin/api/state");
    expect(js.text).toContain("setup-flow");
    expect(js.text).toContain("lifecycle");
  });

  it("returns fixture state with brands and connectors", async () => {
    const { app } = buildAdminApp();

    const res = await request(app).get("/admin/api/state");

    expect(res.status).toBe(200);
    expect(res.body.brands.length).toBeGreaterThanOrEqual(3);
    expect(res.body.connectors.length).toBeGreaterThanOrEqual(8);
    expect(res.body.connections.length).toBeGreaterThanOrEqual(8);
  });

  it("creates brands, regions, and connections with 201 responses and fresh state", async () => {
    const { app } = buildAdminApp();

    const brandRes = await request(app).post("/admin/api/brands").send({
      name: "Route Test Brand",
      slug: "route-test-brand"
    });
    expect(brandRes.status).toBe(201);
    expect(brandRes.body.brand).toMatchObject({
      name: "Route Test Brand",
      slug: "route-test-brand",
      status: "active"
    });
    expect(brandRes.body.state.brands).toContainEqual(brandRes.body.brand);

    const regionRes = await request(app).post(`/admin/api/brands/${brandRes.body.brand.id}/regions`).send({
      code: "uk",
      name: "United Kingdom",
      domain: "route-test.example"
    });
    expect(regionRes.status).toBe(201);
    expect(regionRes.body.region).toMatchObject({
      brandId: brandRes.body.brand.id,
      code: "UK",
      name: "United Kingdom",
      status: "active"
    });
    expect(regionRes.body.state.regions).toContainEqual(regionRes.body.region);

    const connector = regionRes.body.state.connectors.find((candidate: { slug: string }) => candidate.slug === "outlook");
    expect(connector).toBeDefined();
    const connectionRes = await request(app).post(`/admin/api/regions/${regionRes.body.region.id}/connections`).send({
      brandId: brandRes.body.brand.id,
      connectorId: connector.id,
      backendType: "composio",
      displayName: "Route Test Outlook",
      configSummary: {
        mailbox: "ops@route-test.example",
        tenant: "Route Test Tenant"
      }
    });

    expect(connectionRes.status).toBe(201);
    expect(connectionRes.body.connection).toMatchObject({
      brandId: brandRes.body.brand.id,
      regionId: regionRes.body.region.id,
      connectorId: connector.id,
      backendType: "composio",
      displayName: "Route Test Outlook",
      status: "pending",
      configSummary: {
        mailbox: "ops@route-test.example",
        tenant: "Route Test Tenant"
      }
    });
    expect(connectionRes.body.state.connections).toContainEqual(connectionRes.body.connection);
  });

  it("does not echo raw submitted secret or reference values in connection responses or state", async () => {
    const { app } = buildAdminApp();
    const stateRes = await request(app).get("/admin/api/state");
    const brand = stateRes.body.brands.find((candidate: { slug: string }) => candidate.slug === "haverford");
    const region = stateRes.body.regions.find(
      (candidate: { brandId: string; code: string }) => candidate.brandId === brand.id && candidate.code === "AU"
    );
    const connector = stateRes.body.connectors.find((candidate: { slug: string }) => candidate.slug === "shopify");
    const rawToken = "shpat_route_raw_secret_123";
    const rawReference = "vault://route/raw-shopify-token";

    const connectionRes = await request(app).post(`/admin/api/regions/${region.id}/connections`).send({
      brandId: brand.id,
      connectorId: connector.id,
      backendType: "nango",
      displayName: "Route Sanitized Shopify",
      configSummary: {
        shop_domain: "route-test.myshopify.com",
        access_token: rawToken,
        access_token_ref: rawReference
      }
    });

    expect(connectionRes.status).toBe(201);
    expect(connectionRes.body.connection.configSummary).toEqual({
      shop_domain: "route-test.myshopify.com",
      access_token_ref: "fixture-redacted:access_token"
    });
    expect(JSON.stringify(connectionRes.body)).not.toContain(rawToken);
    expect(JSON.stringify(connectionRes.body)).not.toContain(rawReference);

    const freshState = await request(app).get("/admin/api/state");
    expect(JSON.stringify(freshState.body)).not.toContain(rawToken);
    expect(JSON.stringify(freshState.body)).not.toContain(rawReference);
  });

  it("tests connections and rotates or revokes API keys", async () => {
    const { app } = buildAdminApp();
    const stateRes = await request(app).get("/admin/api/state");
    const connection = stateRes.body.connections.find((candidate: { status: string }) => candidate.status !== "connected");
    const client = stateRes.body.apiClients.find(
      (candidate: { id: string }) => candidate.id === "client-marketing-ops"
    );
    const key = client.keys[0];

    const testRes = await request(app).post(`/admin/api/connections/${connection.id}/test`).send({});
    expect(testRes.status).toBe(200);
    expect(testRes.body.connection).toMatchObject({ id: connection.id, status: "connected" });
    expect(testRes.body.connection.lastTestedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const rotateRes = await request(app)
      .post(`/admin/api/api-clients/${client.id}/keys/${key.id}/rotate`)
      .send({});
    expect(rotateRes.status).toBe(200);
    expect(rotateRes.body.key).toMatchObject({ id: key.id, status: "active" });
    expect(rotateRes.body.key.preview).not.toBe(key.preview);

    const revokeRes = await request(app)
      .post(`/admin/api/api-clients/${client.id}/keys/${key.id}/revoke`)
      .send({});
    expect(revokeRes.status).toBe(200);
    expect(revokeRes.body.key).toMatchObject({ id: key.id, status: "revoked" });
    expect(revokeRes.body.state.auditEvents.slice(0, 3).map((event: { action: string }) => event.action)).toEqual([
      "api_key.revoked",
      "api_key.rotated",
      "connection.tested"
    ]);
  });

  it("returns 400 JSON for backend validation errors instead of 500", async () => {
    const { app } = buildAdminApp();

    const duplicateBrand = await request(app).post("/admin/api/brands").send({
      name: "Duplicate Haverford",
      slug: "haverford"
    });
    const badConnection = await request(app).post("/admin/api/regions/region_haverford_au/connections").send({
      brandId: "brand_haverford",
      connectorId: "connector_shopify",
      backendType: "nango",
      displayName: "Missing Shopify Secret",
      configSummary: ["not", "an", "object"]
    });

    expect(duplicateBrand.status).toBe(400);
    expect(duplicateBrand.headers["content-type"]).toContain("application/json");
    expect(duplicateBrand.body).toEqual({ error: "Duplicate brand slug: haverford" });
    expect(badConnection.status).toBe(400);
    expect(badConnection.headers["content-type"]).toContain("application/json");
    expect(badConnection.body.error).toMatch(/configSummary|requires/);
  });
});
