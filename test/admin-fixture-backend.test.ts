import { describe, expect, it } from "vitest";
import { FixtureGatewayBackend } from "../src/admin/fixture-backend.js";
import { createInitialGatewayState } from "../src/admin/fixtures.js";

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
    const lifecycleConnection = state.connections.find((connection) => connection.id === "conn-hav-nz-gsc")!;

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
    expect(lifecycleConnection).toMatchObject({
      brandId: "brand_haverford",
      regionId: "region_haverford_nz",
      connectorId: "connector_google_search_console",
      backendType: "nango",
      status: "connected",
      lastUsedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)
    });
    expect(marketingOps).toMatchObject({
      id: "client-marketing-ops",
      type: "service",
      status: "active",
      owner: "Marketing Ops",
      scopes: expect.arrayContaining(["connections.read"]),
      requestCount24h: expect.any(Number),
      errorRate24h: expect.any(Number)
    });
    expect(marketingOps.keys[0]).toMatchObject({
      id: "key-marketing-primary",
      label: "Primary",
      status: "active",
      createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)
    });
    expect(state.apiClients.flatMap((client) => client.scopes).some((scope) => scope.includes(":"))).toBe(false);
    expect(
      state.connections.flatMap((connection) => Object.keys(connection.configSummary)).some((key) => key === "private_api_key")
    ).toBe(false);
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

  it("seeded connections satisfy connector config requirements without raw secret keys", () => {
    const state = createInitialGatewayState();
    const forbiddenKeys = [
      "accessToken",
      "clientSecret",
      "refreshToken",
      "authorization",
      "bearer",
      "access_token",
      "client_secret",
      "refresh_token",
      "private_api_key"
    ];

    for (const connection of state.connections) {
      const connector = state.connectors.find((candidate) => candidate.id === connection.connectorId);
      expect(connector, `Missing connector for ${connection.id}`).toBeDefined();
      const allowedConfigKeys = new Set<string>();

      for (const field of connector!.requiredFields) {
        if (field.secret) {
          const referenceKeys =
            field.key === "credential_ref" ? ["credential_ref"] : [`${field.key}_ref`, "credential_ref"];
          for (const key of referenceKeys) {
            allowedConfigKeys.add(key);
          }
          expect(
            referenceKeys.some((key) => connection.configSummary[key]?.trim()),
            `${connection.id} must include a safe reference for ${field.key}`
          ).toBe(true);
        } else {
          allowedConfigKeys.add(field.key);
          expect(
            connection.configSummary[field.key]?.trim(),
            `${connection.id} must include required config field ${field.key}`
          ).toBeTruthy();
        }
      }

      expect(
        Object.keys(connection.configSummary).filter((key) => !allowedConfigKeys.has(key)),
        `${connection.id} should not include unknown config summary keys`
      ).toEqual([]);
      for (const key of forbiddenKeys) {
        expect(connection.configSummary).not.toHaveProperty(key);
      }
    }
  });

  it("fixture API clients cover every approved gateway admin scope", () => {
    const state = createInitialGatewayState();
    const approvedScopes = [
      "brands.read",
      "brands.write",
      "regions.read",
      "regions.write",
      "connectors.read",
      "connections.read",
      "connections.write",
      "api_clients.read",
      "api_clients.write",
      "audit.read"
    ];
    const coveredScopes = new Set(state.apiClients.flatMap((client) => client.scopes));

    expect(approvedScopes.filter((scope) => !coveredScopes.has(scope))).toEqual([]);
    expect([...coveredScopes].filter((scope) => !approvedScopes.includes(scope))).toEqual([]);
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
      configSummary: { mailbox: "ops@haverford.example", tenant: "Haverford Microsoft tenant" }
    });

    expect(connection).toMatchObject({
      brandId: brand.id,
      regionId: region.id,
      connectorId: connector.id,
      backendType: "composio",
      displayName: "Haverford Outlook AU",
      status: "pending",
      configSummary: { mailbox: "ops@haverford.example", tenant: "Haverford Microsoft tenant" }
    });
    expect(backend.snapshot().auditEvents[0]).toMatchObject({
      action: "connection.saved",
      targetType: "connection",
      targetId: connection.id
    });
  });

  it("adds an empty config summary for a connector with no required fields", () => {
    const initial = createInitialGatewayState();
    initial.connectors.push({
      id: "connector_fixture_status",
      slug: "fixture-status",
      name: "Fixture Status",
      category: "internal",
      authMode: "none",
      backendOptions: ["internal"],
      requiredFields: [],
      scopes: [],
      description: "Fixture-only health status connector."
    });
    const backend = new FixtureGatewayBackend(initial);
    const state = backend.snapshot();
    const brand = state.brands.find((candidate) => candidate.slug === "haverford")!;
    const region = state.regions.find((candidate) => candidate.brandId === brand.id && candidate.code === "AU")!;
    const connector = state.connectors.find((candidate) => candidate.slug === "fixture-status")!;

    const connection = backend.createConnection({
      brandId: brand.id,
      regionId: region.id,
      connectorId: connector.id,
      backendType: "internal",
      displayName: "Haverford Fixture Status",
      configSummary: { credential_ref: "should not persist" }
    });

    expect(connection.configSummary).toEqual({});
  });

  it("requires non-empty config values for connector required fields", () => {
    const backend = new FixtureGatewayBackend();
    const { brand, region, connector } = getFixtureRefs(backend);

    expect(() =>
      backend.createConnection({
        brandId: brand.id,
        regionId: region.id,
        connectorId: connector.id,
        backendType: "composio",
        displayName: "Missing Outlook Tenant",
        configSummary: { mailbox: "ops@haverford.example" }
      })
    ).toThrow(/Connector outlook requires config field: tenant/);

    expect(() =>
      backend.createConnection({
        brandId: brand.id,
        regionId: region.id,
        connectorId: connector.id,
        backendType: "composio",
        displayName: "Blank Outlook Mailbox",
        configSummary: { mailbox: "   ", tenant: "Haverford Microsoft tenant" }
      })
    ).toThrow(/Connector outlook requires config field: mailbox/);
  });

  it("rejects non-string required config values with a clear validation error", () => {
    const backend = new FixtureGatewayBackend();
    const { brand, region, connector } = getFixtureRefs(backend);

    expect(() =>
      backend.createConnection({
        brandId: brand.id,
        regionId: region.id,
        connectorId: connector.id,
        backendType: "composio",
        displayName: "Malformed Outlook Mailbox",
        configSummary: { mailbox: 123, tenant: "Haverford Microsoft tenant" } as Record<string, unknown>
      })
    ).toThrow(/Connector outlook requires config field mailbox to be a string/);
  });

  it("drops unknown non-string config values while preserving valid required fields", () => {
    const backend = new FixtureGatewayBackend();
    const { brand, region, connector } = getFixtureRefs(backend);

    const connection = backend.createConnection({
      brandId: brand.id,
      regionId: region.id,
      connectorId: connector.id,
      backendType: "composio",
      displayName: "Unknown Non-string Outlook",
      configSummary: {
        mailbox: "ops@haverford.example",
        tenant: "Haverford Microsoft tenant",
        displayHint: 123
      } as Record<string, unknown>
    });

    expect(connection.configSummary).toEqual({
      mailbox: "ops@haverford.example",
      tenant: "Haverford Microsoft tenant"
    });
  });

  it("sanitizes raw secret config values before returning or storing a connection", () => {
    const backend = new FixtureGatewayBackend();
    const state = backend.snapshot();
    const brand = state.brands.find((candidate) => candidate.slug === "haverford")!;
    const region = state.regions.find((candidate) => candidate.brandId === brand.id && candidate.code === "AU")!;
    const connector = state.connectors.find((candidate) => candidate.slug === "shopify")!;
    const rawToken = "shpat_raw_secret_123";
    const rawPassword = "submitted-password-value";

    const connection = backend.createConnection({
      brandId: brand.id,
      regionId: region.id,
      connectorId: connector.id,
      backendType: "nango",
      displayName: "Sanitized Shopify",
      configSummary: {
        shop_domain: "haverford-au.myshopify.com",
        access_token: rawToken,
        password: rawPassword
      }
    });
    const stored = backend.snapshot().connections.find((candidate) => candidate.id === connection.id)!;

    for (const summary of [connection.configSummary, stored.configSummary]) {
      expect(summary).toMatchObject({
        shop_domain: "haverford-au.myshopify.com",
        access_token_ref: "fixture-redacted:access_token"
      });
      expect(summary).not.toHaveProperty("access_token");
      expect(summary).not.toHaveProperty("password");
      expect(Object.values(summary)).not.toContain(rawToken);
      expect(Object.values(summary)).not.toContain(rawPassword);
    }
  });

  it("drops unknown config keys and camelCase raw secret keys", () => {
    const backend = new FixtureGatewayBackend();
    const { brand, region, connector } = getFixtureRefs(backend);
    const rawValues = [
      "shpat_camel_secret",
      "client_secret_camel",
      "refresh_secret_camel",
      "Bearer fixture-token",
      "fixture-bearer",
      "looks display-safe but is unknown"
    ];

    const connection = backend.createConnection({
      brandId: brand.id,
      regionId: region.id,
      connectorId: connector.id,
      backendType: "composio",
      displayName: "Sanitized Outlook",
      configSummary: {
        mailbox: "ops@haverford.example",
        tenant: "Haverford Microsoft tenant",
        accessToken: rawValues[0],
        clientSecret: rawValues[1],
        refreshToken: rawValues[2],
        authorization: rawValues[3],
        bearer: rawValues[4],
        credential_ref: "should not persist",
        displayHint: rawValues[5]
      }
    });
    const stored = backend.snapshot().connections.find((candidate) => candidate.id === connection.id)!;

    for (const summary of [connection.configSummary, stored.configSummary]) {
      expect(summary).toEqual({
        mailbox: "ops@haverford.example",
        tenant: "Haverford Microsoft tenant"
      });
      for (const value of rawValues) {
        expect(Object.values(summary)).not.toContain(value);
      }
    }
  });

  it("requires secret connector fields to have a safe reference or a raw value to redact", () => {
    const backend = new FixtureGatewayBackend();
    const state = backend.snapshot();
    const brand = state.brands.find((candidate) => candidate.slug === "haverford")!;
    const region = state.regions.find((candidate) => candidate.brandId === brand.id && candidate.code === "AU")!;
    const connector = state.connectors.find((candidate) => candidate.slug === "shopify")!;

    expect(() =>
      backend.createConnection({
        brandId: brand.id,
        regionId: region.id,
        connectorId: connector.id,
        backendType: "nango",
        displayName: "Missing Shopify Token",
        configSummary: { shop_domain: "haverford-au.myshopify.com" }
      })
    ).toThrow(/Connector shopify requires secret config reference: access_token/);
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
      status: "active",
      createdAt: key.createdAt
    });
    expect(rotated.rotatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(rotated.preview).not.toBe(key.preview);
    expect(rotated.fingerprint).not.toBe(key.fingerprint);
    expect(revoked).toMatchObject({
      id: key.id,
      status: "revoked",
      createdAt: key.createdAt
    });
    expect(revoked.revokedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(auditEvents.slice(0, 2).map((event) => event.action)).toEqual([
      "api_key.revoked",
      "api_key.rotated"
    ]);
  });

  it("rejects rotation for revoked API keys without reactivating them", () => {
    const backend = new FixtureGatewayBackend();
    const clientId = "api_client_reporting_worker";
    const keyId = "api_key_reporting_worker_primary";
    const beforeState = backend.snapshot();
    const beforeClient = beforeState.apiClients.find((candidate) => candidate.id === clientId)!;
    const beforeKey = beforeClient.keys.find((candidate) => candidate.id === keyId)!;

    expect(() => backend.rotateApiKey(clientId, keyId)).toThrow(`Cannot rotate revoked API key: ${keyId}`);

    const afterState = backend.snapshot();
    const afterClient = afterState.apiClients.find((candidate) => candidate.id === clientId)!;
    const afterKey = afterClient.keys.find((candidate) => candidate.id === keyId)!;
    expect(afterKey).toMatchObject({
      id: keyId,
      status: "revoked",
      revokedAt: beforeKey.revokedAt,
      preview: beforeKey.preview,
      fingerprint: beforeKey.fingerprint
    });
    expect(afterState.auditEvents).toHaveLength(beforeState.auditEvents.length);
  });

  it("rejects revocation for already revoked API keys without mutating or auditing", () => {
    const backend = new FixtureGatewayBackend();
    const clientId = "api_client_reporting_worker";
    const keyId = "api_key_reporting_worker_primary";
    const beforeState = backend.snapshot();
    const beforeClient = beforeState.apiClients.find((candidate) => candidate.id === clientId)!;
    const beforeKey = beforeClient.keys.find((candidate) => candidate.id === keyId)!;

    expect(() => backend.revokeApiKey(clientId, keyId)).toThrow(`Cannot revoke revoked API key: ${keyId}`);

    const afterState = backend.snapshot();
    const afterClient = afterState.apiClients.find((candidate) => candidate.id === clientId)!;
    const afterKey = afterClient.keys.find((candidate) => candidate.id === keyId)!;
    expect(afterKey).toEqual(beforeKey);
    expect(afterState.auditEvents).toHaveLength(beforeState.auditEvents.length);
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
    expect(() => backend.revokeApiKey("client-marketing-ops", "missing-key")).toThrow(
      /Unknown API key: missing-key/
    );
  });
});
