import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AdminBackendError } from "../src/admin/backend-error.js";
import { FixtureGatewayBackend } from "../src/admin/fixture-backend.js";
import { createInitialGatewayState } from "../src/admin/fixtures.js";
import { OverlayGatewayBackend } from "../src/admin/overlay-backend.js";
import { GatewayOverlayStore } from "../src/admin/overlay-store.js";
import type { GatewayState } from "../src/admin/types.js";

let tempDir: string;
let dbPath: string;
let openStores: GatewayOverlayStore[];

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-overlay-backend-"));
  dbPath = path.join(tempDir, "gateway.sqlite");
  openStores = [];
});

afterEach(() => {
  for (const store of openStores) {
    try {
      store.close();
    } catch {
      // Already closed by the test.
    }
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function createBackend(initial?: GatewayState): { backend: OverlayGatewayBackend; source: FixtureGatewayBackend; store: GatewayOverlayStore } {
  const source = new FixtureGatewayBackend(initial);
  const store = new GatewayOverlayStore(dbPath);
  openStores.push(store);
  const backend = new OverlayGatewayBackend({
    source,
    store,
    sourceType: "fixture",
    sourceLabel: "Fixture Source",
    actor: "overlay-test"
  });
  return { backend, source, store };
}

async function expectAdminError(promise: Promise<unknown>, statusCode: number, message: RegExp): Promise<void> {
  await expect(promise).rejects.toMatchObject({ statusCode });
  await expect(promise).rejects.toThrow(message);
}

describe("OverlayGatewayBackend", () => {
  it("emits source entity metadata with label and override state", async () => {
    const { backend } = createBackend();

    const state = await backend.snapshot();

    expect(state.entityMeta).toContainEqual({
      entityType: "brand",
      entityId: "brand_haverford",
      source: "fixture",
      sourceLabel: "Fixture Source",
      hasOverride: false,
      overrideFields: []
    });
    expect(state.entityMeta).toContainEqual({
      entityType: "region",
      entityId: "region_haverford_au",
      source: "fixture",
      sourceLabel: "Fixture Source",
      hasOverride: false,
      overrideFields: []
    });
    expect(state.entityMeta).toContainEqual({
      entityType: "connection",
      entityId: "connection_haverford_au_outlook",
      source: "fixture",
      sourceLabel: "Fixture Source",
      hasOverride: false,
      overrideFields: []
    });
  });

  it("persists gateway-owned brands, regions, and connections across backend recreation", async () => {
    const first = createBackend();
    const brand = await first.backend.createBrand({ name: "Route Test", slug: "Route Test" });
    const region = await first.backend.createRegion({
      brandId: brand.id,
      code: " uk ",
      name: "United Kingdom",
      domain: "route-test.example"
    });
    const connector = (await first.backend.snapshot()).connectors.find((candidate) => candidate.slug === "outlook")!;
    const connection = await first.backend.createConnection({
      brandId: brand.id,
      regionId: region.id,
      connectorId: connector.id,
      backendType: "composio",
      displayName: "Route Test Outlook",
      configSummary: { mailbox: "ops@route-test.example", tenant: "Route Test tenant" }
    });
    first.backend.close();

    const second = createBackend();
    const state = await second.backend.snapshot();

    expect(state.brands).toContainEqual(brand);
    expect(state.regions).toContainEqual(region);
    expect(state.connections).toContainEqual(connection);
    expect(state.entityMeta).toContainEqual(
      expect.objectContaining({
        entityType: "brand",
        entityId: brand.id,
        source: "gateway",
        sourceLabel: "Gateway overlay",
        hasOverride: false
      })
    );
    expect(state.entityMeta).toContainEqual(
      expect.objectContaining({
        entityType: "connection",
        entityId: connection.id,
        source: "gateway",
        sourceLabel: "Gateway overlay"
      })
    );
  });

  it("persists source overrides across backend recreation and resets them", async () => {
    const first = createBackend();
    await first.backend.updateBrand("brand_haverford", { name: "Haverford Override", status: "disabled" });
    first.backend.close();

    const second = createBackend();
    const overridden = await second.backend.snapshot();
    const brandMeta = overridden.entityMeta?.find(
      (meta) => meta.entityType === "brand" && meta.entityId === "brand_haverford"
    );

    expect(overridden.brands.find((brand) => brand.id === "brand_haverford")).toMatchObject({
      name: "Haverford Override",
      status: "disabled"
    });
    expect(brandMeta).toMatchObject({
      source: "fixture",
      sourceLabel: "Fixture Source",
      hasOverride: true,
      overrideFields: ["name", "status"],
      updatedBy: "overlay-test"
    });

    const reset = await second.backend.resetEntity({ entityType: "brand", entityId: "brand_haverford" });

    expect(reset.brands.find((brand) => brand.id === "brand_haverford")).toMatchObject({
      name: "Haverford",
      status: "active"
    });
    expect(reset.entityMeta?.find((meta) => meta.entityType === "brand" && meta.entityId === "brand_haverford")).toMatchObject({
      hasOverride: false,
      overrideFields: []
    });
    expect(second.store.listAuditEvents()[0]).toMatchObject({
      action: "entity.reset",
      targetType: "brand",
      targetId: "brand_haverford"
    });
  });

  it("rejects duplicate brand slugs and duplicate region codes across visible records", async () => {
    const { backend } = createBackend();

    await expectAdminError(backend.createBrand({ name: "Duplicate Haverford", slug: " haverford " }), 409, /Duplicate brand slug: haverford/);
    await expectAdminError(
      backend.createRegion({ brandId: "brand_haverford", code: " au ", name: "Duplicate Australia" }),
      409,
      /Duplicate region code/
    );
  });

  it("rejects identity edits for source-owned brand and region records", async () => {
    const { backend } = createBackend();

    await expectAdminError(backend.updateBrand("brand_haverford", { slug: "renamed-haverford" }), 409, /Cannot edit source-owned brand identity/);
    await expectAdminError(backend.updateRegion("region_haverford_au", { code: "NZ" }), 409, /Cannot edit source-owned region identity/);
  });

  it("uses replacement semantics for connection config overrides and blocks raw secret keys", async () => {
    const first = createBackend();
    await first.backend.updateConnection("connection_haverford_au_outlook", {
      configSummary: { mailbox: "new-ops@haverford.example" }
    });
    first.backend.close();

    const second = createBackend();
    const state = await second.backend.snapshot();
    const connection = state.connections.find((candidate) => candidate.id === "connection_haverford_au_outlook")!;

    expect(connection.configSummary).toEqual({ mailbox: "new-ops@haverford.example" });
    await expectAdminError(
      second.backend.updateConnection("connection_haverford_au_outlook", {
        configSummary: { accessToken: "raw-secret-token" }
      }),
      400,
      /Unsafe config field: accessToken/
    );
    await expectAdminError(
      second.backend.updateConnection("connection_haverford_au_outlook", {
        configSummary: { api_key: "raw-api-key" }
      }),
      400,
      /Unsafe config field: api_key/
    );
    await expectAdminError(
      second.backend.updateConnection("connection_haverford_au_outlook", {
        configSummary: { secret: "raw-secret" }
      }),
      400,
      /Unsafe config field: secret/
    );
  });

  it("does not create source overrides or audit events for no-op updates", async () => {
    const { backend, store } = createBackend();

    const emptyUpdate = await backend.updateBrand("brand_haverford", {});
    const sameValueUpdate = await backend.updateBrand("brand_haverford", {
      name: "Haverford",
      status: "active"
    });
    const state = await backend.snapshot();

    expect(emptyUpdate).toMatchObject({ id: "brand_haverford", name: "Haverford", status: "active" });
    expect(sameValueUpdate).toMatchObject({ id: "brand_haverford", name: "Haverford", status: "active" });
    expect(state.entityMeta?.find((meta) => meta.entityType === "brand" && meta.entityId === "brand_haverford")).toMatchObject({
      hasOverride: false,
      overrideFields: []
    });
    expect(store.listAuditEvents()).toEqual([]);
    expect(store.listOverrides()).toEqual([]);
  });

  it("does not write gateway-owned rows or audit events for unchanged updates", async () => {
    const { backend, store } = createBackend();
    const brand = await backend.createBrand({ name: "Gateway Noop", slug: "gateway-noop" });
    const auditAfterCreate = store.listAuditEvents();

    const unchanged = await backend.updateBrand(brand.id, {
      name: brand.name,
      status: brand.status
    });

    expect(unchanged).toEqual(brand);
    expect(store.listAuditEvents()).toEqual(auditAfterCreate);
  });

  it("redacts connector-declared secret fields and references during config updates", async () => {
    const initial = createInitialGatewayState();
    initial.connectors.push({
      id: "connector_secret_not_denylisted",
      slug: "secret-not-denylisted",
      name: "Secret Not Denylisted",
      category: "crm",
      authMode: "api_key",
      backendOptions: ["native"],
      requiredFields: [
        { key: "account_id", label: "Account ID" },
        { key: "shared_secret", label: "Shared secret", secret: true }
      ],
      scopes: ["records:read"],
      description: "Regression fixture for connector-specific secret handling."
    });
    initial.connections.push({
      id: "connection_haverford_au_secret_not_denylisted",
      brandId: "brand_haverford",
      regionId: "region_haverford_au",
      connectorId: "connector_secret_not_denylisted",
      backendType: "native",
      displayName: "Haverford Secret Fixture",
      status: "pending",
      configSummary: { account_id: "HAV-AU", shared_secret_ref: "fixture vault placeholder" }
    });
    const { backend } = createBackend(initial);

    const rawUpdated = await backend.updateConnection("connection_haverford_au_secret_not_denylisted", {
      configSummary: { account_id: "HAV-AU-2", shared_secret: "raw-shared-secret" }
    });
    expect(rawUpdated.configSummary).toEqual({
      account_id: "HAV-AU-2",
      shared_secret_ref: "fixture-redacted:shared_secret"
    });
    expect(JSON.stringify(rawUpdated)).not.toContain("raw-shared-secret");

    const refUpdated = await backend.updateConnection("connection_haverford_au_secret_not_denylisted", {
      configSummary: { account_id: "HAV-AU-3", shared_secret_ref: "vault://shared-secret" }
    });
    expect(refUpdated.configSummary).toEqual({
      account_id: "HAV-AU-3",
      shared_secret_ref: "fixture-redacted:shared_secret"
    });
    expect(JSON.stringify(await backend.snapshot())).not.toContain("vault://shared-secret");
  });

  it("enforces connector backend support when creating and updating connections", async () => {
    const { backend } = createBackend();

    await expectAdminError(
      backend.createConnection({
        brandId: "brand_haverford",
        regionId: "region_haverford_au",
        connectorId: "connector_klaviyo",
        backendType: "composio",
        displayName: "Unsupported Klaviyo"
      }),
      400,
      /does not support backend composio/
    );
    await expectAdminError(
      backend.updateConnection("conn-hav-nz-gsc", { backendType: "composio" }),
      400,
      /does not support backend composio/
    );
  });

  it("testConnection persists connected state and writes only a connection.tested audit event", async () => {
    const first = createBackend();
    const tested = await first.backend.testConnection("connection_haverford_au_outlook");

    expect(tested).toMatchObject({
      id: "connection_haverford_au_outlook",
      status: "connected"
    });
    expect(tested.lastTestedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(tested.lastError).toBeUndefined();
    expect(first.store.listAuditEvents().map((event) => event.action)).toEqual(["connection.tested"]);
    first.backend.close();

    const second = createBackend();
    const persisted = (await second.backend.snapshot()).connections.find(
      (candidate) => candidate.id === "connection_haverford_au_outlook"
    )!;
    expect(persisted.status).toBe("connected");
    expect(persisted.lastTestedAt).toBe(tested.lastTestedAt);
  });

  it("delegates API key rotation and revocation to the source backend", async () => {
    const { backend, source, store } = createBackend();

    const rotated = await backend.rotateApiKey("client-marketing-ops", "key-marketing-primary");
    const revoked = await backend.revokeApiKey("client-marketing-ops", "key-marketing-primary");
    const sourceKey = source
      .snapshot()
      .apiClients.find((client) => client.id === "client-marketing-ops")!
      .keys.find((key) => key.id === "key-marketing-primary")!;

    expect(rotated.preview).toContain("gw_mock_rotated_");
    expect(revoked.status).toBe("revoked");
    expect(sourceKey.status).toBe("revoked");
    expect(store.listAuditEvents()).toEqual([]);
  });

  it("normalizes synchronous source API key errors into rejected promises", async () => {
    class ThrowingSourceBackend extends FixtureGatewayBackend {
      rotateApiKey(): never {
        throw new Error("sync rotate failure");
      }

      revokeApiKey(): never {
        throw new Error("sync revoke failure");
      }
    }
    const store = new GatewayOverlayStore(dbPath);
    openStores.push(store);
    const backend = new OverlayGatewayBackend({
      source: new ThrowingSourceBackend(),
      store,
      sourceType: "fixture",
      sourceLabel: "Fixture Source"
    });

    const promise = backend.rotateApiKey("client-marketing-ops", "key-marketing-primary");
    expect(promise).toBeInstanceOf(Promise);
    await expect(promise).rejects.toThrow(/sync rotate failure/);

    const revokePromise = backend.revokeApiKey("client-marketing-ops", "key-marketing-primary");
    expect(revokePromise).toBeInstanceOf(Promise);
    await expect(revokePromise).rejects.toThrow(/sync revoke failure/);
  });

  it("raises AdminBackendError instances for missing visible records", async () => {
    const { backend } = createBackend();

    await expect(backend.updateBrand("missing-brand", { name: "Missing" })).rejects.toBeInstanceOf(AdminBackendError);
    await expectAdminError(backend.resetEntity({ entityType: "connection", entityId: "connection_haverford_au_outlook" }), 404, /No overlay override/);
  });
});
