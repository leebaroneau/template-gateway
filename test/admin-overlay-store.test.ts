import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GatewayOverlayStore } from "../src/admin/overlay-store.js";

let tempDir: string;
let dbPath: string;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-overlay-"));
  dbPath = path.join(tempDir, "gateway.sqlite");
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("GatewayOverlayStore", () => {
  it("creates SQLite tables and persists gateway-owned records", () => {
    const store = new GatewayOverlayStore(dbPath);
    store.createBrand({
      brand: { id: "gateway_brand_route_test", name: "Route Test", slug: "route-test", status: "active" },
      actor: "test"
    });
    store.createRegion({
      region: {
        id: "gateway_region_route_test_au",
        brandId: "gateway_brand_route_test",
        code: "AU",
        name: "Australia",
        status: "active",
        domain: "route-test.example"
      },
      actor: "test"
    });
    store.createConnection({
      connection: {
        id: "gateway_connection_route_test_au_shopify",
        brandId: "gateway_brand_route_test",
        regionId: "gateway_region_route_test_au",
        connectorId: "connector_shopify",
        backendType: "native",
        displayName: "Route Test Shopify",
        status: "pending",
        configSummary: { shop_domain: "route-test.myshopify.com" }
      },
      actor: "test"
    });
    store.close();

    const reopened = new GatewayOverlayStore(dbPath);
    expect(reopened.listBrands().map((record) => record.value)).toContainEqual(
      expect.objectContaining({ id: "gateway_brand_route_test", slug: "route-test" })
    );
    expect(reopened.listRegions().map((record) => record.value)).toContainEqual(
      expect.objectContaining({ id: "gateway_region_route_test_au", domain: "route-test.example" })
    );
    expect(reopened.listConnections().map((record) => record.value)).toContainEqual(
      expect.objectContaining({
        id: "gateway_connection_route_test_au_shopify",
        configSummary: { shop_domain: "route-test.myshopify.com" }
      })
    );
    reopened.close();
  });

  it("upserts and deletes source entity overrides", () => {
    const store = new GatewayOverlayStore(dbPath);
    store.upsertOverride({
      entityType: "brand",
      entityId: "brand_haverford",
      source: "dev_api",
      patch: { name: "Haverford Override", status: "disabled" },
      actor: "test"
    });

    store.upsertOverride({
      entityType: "brand",
      entityId: "brand_haverford",
      source: "dev_api",
      patch: { name: "Haverford Updated Override", status: "active" },
      actor: "review",
      sourceFingerprint: "fingerprint-2"
    });

    const overrides = store.listOverrides();
    expect(overrides).toHaveLength(1);
    expect(overrides[0]).toMatchObject({
      entityType: "brand",
      entityId: "brand_haverford",
      patch: { name: "Haverford Updated Override", status: "active" },
      sourceFingerprint: "fingerprint-2",
      updatedBy: "review"
    });

    store.deleteOverride("brand", "brand_haverford");
    expect(store.listOverrides()).toEqual([]);
    store.close();
  });

  it("stores audit events newest first", async () => {
    const store = new GatewayOverlayStore(dbPath);
    store.writeAudit({
      action: "brand.updated",
      targetType: "brand",
      targetId: "brand_haverford",
      detail: "Haverford brand updated.",
      actor: "test",
      metadata: { field: "name" }
    });
    await wait(2);
    store.writeAudit({
      action: "region.updated",
      targetType: "region",
      targetId: "region_haverford_au",
      detail: "Haverford AU region updated.",
      actor: "review",
      metadata: { field: "domain" }
    });

    const events = store.listAuditEvents();
    expect(events[0]).toMatchObject({
      action: "region.updated",
      targetType: "region",
      targetId: "region_haverford_au",
      actor: "review",
      metadata: { field: "domain" }
    });
    expect(events[1]).toMatchObject({
      action: "brand.updated",
      targetType: "brand",
      targetId: "brand_haverford",
      actor: "test",
      metadata: { field: "name" }
    });
    expect(events[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(events[0].timestamp >= events[1].timestamp).toBe(true);
    store.close();
  });
});
