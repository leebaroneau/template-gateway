import { describe, expect, it } from "vitest";
import { FixtureGatewayBackend } from "../src/admin/fixture-backend.js";

describe("FixtureGatewayBackend", () => {
  it("starts with deterministic admin fixture data", () => {
    const backend = new FixtureGatewayBackend();
    const state = backend.snapshot();

    expect(state.brands.map((brand) => brand.name)).toEqual(
      expect.arrayContaining(["Haverford", "Catnets", "Koenig Machinery"])
    );
    expect(state.brands.length).toBeGreaterThanOrEqual(3);
    expect(state.regions.length).toBeGreaterThanOrEqual(5);
    expect(state.connectors.length).toBeGreaterThanOrEqual(8);
    expect(state.connections.length).toBeGreaterThanOrEqual(8);
    expect(state.apiClients.map((client) => client.name)).toEqual(
      expect.arrayContaining(["Marketing Ops", "Shopify Sales", "Agent Gateway", "Reporting Worker"])
    );
    expect(state.auditEvents.length).toBeGreaterThanOrEqual(6);
  });

  it("adds a brand and records a brand.created audit event", () => {
    const backend = new FixtureGatewayBackend();

    const brand = backend.createBrand({ name: "New Test Brand", slug: " New Test Brand " });
    const state = backend.snapshot();

    expect(brand).toMatchObject({
      name: "New Test Brand",
      slug: "new-test-brand",
      status: "active"
    });
    expect(state.brands).toContainEqual(brand);
    expect(state.auditEvents[0]).toMatchObject({
      action: "brand.created",
      entityType: "brand",
      entityId: brand.id
    });
  });

  it("adds a region under an existing brand", () => {
    const backend = new FixtureGatewayBackend();
    const brand = backend.snapshot().brands.find((candidate) => candidate.slug === "haverford");

    expect(brand).toBeDefined();
    const region = backend.createRegion({
      brandId: brand!.id,
      code: " uk ",
      name: "United Kingdom",
      domain: "haverford.co.uk"
    });

    expect(region).toMatchObject({
      brandId: brand!.id,
      code: "UK",
      name: "United Kingdom",
      domain: "haverford.co.uk",
      status: "active"
    });
    expect(backend.snapshot().auditEvents[0]).toMatchObject({
      action: "region.created",
      entityType: "region",
      entityId: region.id
    });
  });

  it("adds a pending connection with a supported backend", () => {
    const backend = new FixtureGatewayBackend();
    const state = backend.snapshot();
    const brand = state.brands.find((candidate) => candidate.slug === "haverford")!;
    const region = state.regions.find((candidate) => candidate.brandId === brand.id && candidate.code === "AU")!;
    const connector = state.connectors.find((candidate) => candidate.slug === "outlook")!;

    const connection = backend.createConnection({
      brandId: brand.id,
      regionId: region.id,
      connectorId: connector.id,
      backend: "composio",
      displayName: "Haverford Outlook AU",
      configSummary: { mailbox: "ops@haverford.example" }
    });

    expect(connection).toMatchObject({
      brandId: brand.id,
      regionId: region.id,
      connectorId: connector.id,
      backend: "composio",
      displayName: "Haverford Outlook AU",
      status: "pending",
      configSummary: { mailbox: "ops@haverford.example" }
    });
    expect(backend.snapshot().auditEvents[0]).toMatchObject({
      action: "connection.saved",
      entityType: "connection",
      entityId: connection.id
    });
  });

  it("testConnection marks a known connection connected and sets lastTestedAt", () => {
    const backend = new FixtureGatewayBackend();
    const connection = backend.snapshot().connections.find((candidate) => candidate.status !== "connected")!;

    const tested = backend.testConnection(connection.id);

    expect(tested.status).toBe("connected");
    expect(tested.lastTestedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(tested.lastError).toBeUndefined();
    expect(backend.snapshot().auditEvents[0]).toMatchObject({
      action: "connection.tested",
      entityType: "connection",
      entityId: connection.id
    });
  });

  it("rotates and revokes API keys while preserving audit event order", () => {
    const backend = new FixtureGatewayBackend();
    const client = backend.snapshot().apiClients.find((candidate) => candidate.keys.length > 0)!;
    const key = client.keys[0];

    const rotated = backend.rotateApiKey(client.id, key.id);
    const revoked = backend.revokeApiKey(client.id, key.id);
    const auditEvents = backend.snapshot().auditEvents;

    expect(rotated.keys[0]).toMatchObject({
      id: key.id,
      status: "active"
    });
    expect(rotated.keys[0].rotatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(rotated.keys[0].preview).not.toBe(key.preview);
    expect(rotated.keys[0].fingerprint).not.toBe(key.fingerprint);
    expect(revoked.keys[0]).toMatchObject({
      id: key.id,
      status: "revoked"
    });
    expect(revoked.keys[0].revokedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(auditEvents.slice(0, 2).map((event) => event.action)).toEqual([
      "api_key.revoked",
      "api_key.rotated"
    ]);
  });
});
