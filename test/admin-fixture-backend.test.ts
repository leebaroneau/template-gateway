import { describe, expect, it } from "vitest";
import { FixtureGatewayBackend } from "../src/admin/fixture-backend.js";

describe("FixtureGatewayBackend", () => {
  function getFixtureRefs(backend: FixtureGatewayBackend) {
    const state = backend.snapshot();
    const brand = state.brands.find((candidate) => candidate.slug === "haverford")!;
    const region = state.regions.find((candidate) => candidate.brandId === brand.id && candidate.code === "AU")!;
    const connector = state.connectors.find((candidate) => candidate.slug === "outlook")!;
    return { brand, region, connector, state };
  }

  it("starts with deterministic admin fixture data", () => {
    const backend = new FixtureGatewayBackend();
    const state = backend.snapshot();
    const outlook = state.connectors.find((connector) => connector.slug === "outlook")!;
    const devApi = state.connectors.find((connector) => connector.slug === "haverford-dev-api")!;
    const marketingOps = state.apiClients.find((client) => client.name === "Marketing Ops")!;

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
    expect(outlook).toMatchObject({
      backendOptions: expect.arrayContaining(["composio", "nango"]),
      requiredFields: expect.arrayContaining([expect.objectContaining({ key: "mailbox" })]),
      scopes: expect.arrayContaining(["mail.read"])
    });
    expect(devApi.backendOptions).toEqual(["internal"]);
    expect(state.connections.map((connection) => connection.backendType)).toEqual(
      expect.arrayContaining(["nango", "composio", "native", "internal"])
    );
    expect(marketingOps).toMatchObject({
      type: "service",
      status: "active",
      owner: "Marketing Ops",
      scopes: expect.arrayContaining(["connections:read"]),
      requestCount24h: expect.any(Number),
      errorRate24h: expect.any(Number)
    });
    expect(marketingOps.keys[0]).toMatchObject({
      label: "Primary",
      status: "active"
    });
    expect(state.auditEvents[0]).toMatchObject({
      targetType: expect.any(String),
      targetId: expect.any(String),
      detail: expect.any(String),
      timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)
    });
  });

  it("snapshot returns a clone that cannot mutate backend state", () => {
    const backend = new FixtureGatewayBackend();
    const snapshot = backend.snapshot();

    snapshot.brands[0].name = "Mutated Brand";
    snapshot.connectors[0].requiredFields.push({ key: "mutated", label: "Mutated" });
    snapshot.apiClients[0].keys[0].preview = "mutated";

    const fresh = backend.snapshot();
    expect(fresh.brands[0].name).not.toBe("Mutated Brand");
    expect(fresh.connectors[0].requiredFields).not.toContainEqual({ key: "mutated", label: "Mutated" });
    expect(fresh.apiClients[0].keys[0].preview).not.toBe("mutated");
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
      targetType: "brand",
      targetId: brand.id
    });
  });

  it("rejects duplicate brand slugs", () => {
    const backend = new FixtureGatewayBackend();

    expect(() => backend.createBrand({ name: "Haverford Duplicate", slug: " Haverford " })).toThrow(
      /Duplicate brand slug: haverford/
    );
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
      targetType: "region",
      targetId: region.id
    });
  });

  it("rejects duplicate region codes within a brand", () => {
    const backend = new FixtureGatewayBackend();
    const brand = backend.snapshot().brands.find((candidate) => candidate.slug === "haverford")!;

    expect(() =>
      backend.createRegion({
        brandId: brand.id,
        code: " au ",
        name: "Duplicate Australia"
      })
    ).toThrow(/Duplicate region code for haverford: AU/);
  });

  it("adds a pending connection with a supported backend", () => {
    const backend = new FixtureGatewayBackend();
    const { brand, region, connector } = getFixtureRefs(backend);

    const connection = backend.createConnection({
      brandId: brand.id,
      regionId: region.id,
      connectorId: connector.id,
      backendType: "composio",
      displayName: "Haverford Outlook AU",
      configSummary: { mailbox: "ops@haverford.example" }
    });

    expect(connection).toMatchObject({
      brandId: brand.id,
      regionId: region.id,
      connectorId: connector.id,
      backendType: "composio",
      displayName: "Haverford Outlook AU",
      status: "pending",
      configSummary: { mailbox: "ops@haverford.example" }
    });
    expect(backend.snapshot().auditEvents[0]).toMatchObject({
      action: "connection.saved",
      targetType: "connection",
      targetId: connection.id
    });
  });

  it("rejects region and brand mismatches in createConnection", () => {
    const backend = new FixtureGatewayBackend();
    const state = backend.snapshot();
    const brand = state.brands.find((candidate) => candidate.slug === "haverford")!;
    const region = state.regions.find((candidate) => candidate.brandId !== brand.id)!;
    const connector = state.connectors.find((candidate) => candidate.slug === "outlook")!;

    expect(() =>
      backend.createConnection({
        brandId: brand.id,
        regionId: region.id,
        connectorId: connector.id,
        backendType: "composio",
        displayName: "Mismatched Outlook"
      })
    ).toThrow(new RegExp(`Region ${region.id} does not belong to brand ${brand.id}`));
  });

  it("rejects unsupported connector backends", () => {
    const backend = new FixtureGatewayBackend();
    const { brand, region, state } = getFixtureRefs(backend);
    const connector = state.connectors.find((candidate) => candidate.slug === "haverford-dev-api")!;

    expect(() =>
      backend.createConnection({
        brandId: brand.id,
        regionId: region.id,
        connectorId: connector.id,
        backendType: "nango",
        displayName: "Unsupported Dev API"
      })
    ).toThrow(/Connector haverford-dev-api does not support backend nango/);
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
      targetType: "connection",
      targetId: connection.id
    });
  });

  it("rotates and revokes API keys while preserving audit event order", () => {
    const backend = new FixtureGatewayBackend();
    const client = backend.snapshot().apiClients.find((candidate) => candidate.keys.length > 0)!;
    const key = client.keys[0];

    const rotated = backend.rotateApiKey(client.id, key.id);
    const revoked = backend.revokeApiKey(client.id, key.id);
    const auditEvents = backend.snapshot().auditEvents;

    expect(rotated).toMatchObject({
      id: key.id,
      status: "active"
    });
    expect(rotated.rotatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(rotated.preview).not.toBe(key.preview);
    expect(rotated.fingerprint).not.toBe(key.fingerprint);
    expect(revoked).toMatchObject({
      id: key.id,
      status: "revoked"
    });
    expect(revoked.revokedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(auditEvents.slice(0, 2).map((event) => event.action)).toEqual([
      "api_key.revoked",
      "api_key.rotated"
    ]);
  });

  it("returns clear errors for unknown brand, region, connector, connection, client, and key", () => {
    const backend = new FixtureGatewayBackend();
    const { brand, region, connector } = getFixtureRefs(backend);

    expect(() => backend.createRegion({ brandId: "missing-brand", code: "CA", name: "Canada" })).toThrow(
      /Unknown brand: missing-brand/
    );
    expect(() =>
      backend.createConnection({
        brandId: brand.id,
        regionId: "missing-region",
        connectorId: connector.id,
        backendType: "composio",
        displayName: "Missing Region"
      })
    ).toThrow(/Unknown region: missing-region/);
    expect(() =>
      backend.createConnection({
        brandId: brand.id,
        regionId: region.id,
        connectorId: "missing-connector",
        backendType: "composio",
        displayName: "Missing Connector"
      })
    ).toThrow(/Unknown connector: missing-connector/);
    expect(() => backend.testConnection("missing-connection")).toThrow(/Unknown connection: missing-connection/);
    expect(() => backend.rotateApiKey("missing-client", "missing-key")).toThrow(/Unknown API client: missing-client/);
    expect(() => backend.revokeApiKey("api_client_marketing_ops", "missing-key")).toThrow(
      /Unknown API key: missing-key/
    );
  });
});
