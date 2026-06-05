import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GatewayAppInstallStore } from "../src/apps/store.js";

let tempDir: string;
let dbPath: string;
let stores: GatewayAppInstallStore[];

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-apps-store-"));
  dbPath = path.join(tempDir, "gateway.sqlite");
  stores = [];
});

afterEach(() => {
  while (stores.length > 0) stores.pop()?.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function openStore(pathname = dbPath): GatewayAppInstallStore {
  const store = new GatewayAppInstallStore(pathname);
  stores.push(store);
  return store;
}

describe("GatewayAppInstallStore", () => {
  describe("createInstall", () => {
    it("returns a GatewayAppInstall with id, appSlug, brandId, regionId, status defaults to pending", () => {
      const store = openStore();
      const install = store.createInstall({
        appSlug: "cin7",
        brandId: "brand_haverford",
        regionId: "region_haverford_au"
      });
      expect(install.id).toMatch(/^appinstall_/);
      expect(install.appSlug).toBe("cin7");
      expect(install.brandId).toBe("brand_haverford");
      expect(install.regionId).toBe("region_haverford_au");
      expect(install.status).toBe("pending");
      expect(install.createdAt).toBeTruthy();
      expect(install.updatedAt).toBeTruthy();
      expect(install.connectionId).toBeUndefined();
      expect(install.errorDetail).toBeUndefined();
    });

    it("uses provided status when given", () => {
      const store = openStore();
      const install = store.createInstall({
        appSlug: "cin7",
        brandId: "brand_haverford",
        regionId: "region_haverford_au",
        status: "enabled"
      });
      expect(install.status).toBe("enabled");
    });

    it("stores connectionId when provided", () => {
      const store = openStore();
      const install = store.createInstall({
        appSlug: "cin7",
        brandId: "brand_haverford",
        regionId: "region_haverford_au",
        connectionId: "conn_abc123"
      });
      expect(install.connectionId).toBe("conn_abc123");
    });
  });

  describe("getInstall", () => {
    it("returns correct shape by id", () => {
      const store = openStore();
      const created = store.createInstall({
        appSlug: "cin7",
        brandId: "brand_haverford",
        regionId: "region_haverford_au"
      });
      const fetched = store.getInstall(created.id);
      expect(fetched).toEqual(created);
    });

    it("returns undefined for unknown id", () => {
      const store = openStore();
      expect(store.getInstall("appinstall_nonexistent")).toBeUndefined();
    });
  });

  describe("getInstallByKey", () => {
    it("returns install by appSlug+brandId+regionId", () => {
      const store = openStore();
      const created = store.createInstall({
        appSlug: "cin7",
        brandId: "brand_haverford",
        regionId: "region_haverford_au"
      });
      const fetched = store.getInstallByKey("cin7", "brand_haverford", "region_haverford_au");
      expect(fetched).toEqual(created);
    });

    it("returns undefined for unknown key", () => {
      const store = openStore();
      expect(store.getInstallByKey("unknown-app", "brand_x", "region_x")).toBeUndefined();
    });
  });

  describe("listInstalls", () => {
    it("returns all installs with no filter", () => {
      const store = openStore();
      store.createInstall({ appSlug: "cin7", brandId: "brand_a", regionId: "region_1" });
      store.createInstall({ appSlug: "shopify", brandId: "brand_b", regionId: "region_2" });
      expect(store.listInstalls()).toHaveLength(2);
    });

    it("filters by appSlug", () => {
      const store = openStore();
      store.createInstall({ appSlug: "cin7", brandId: "brand_a", regionId: "region_1" });
      store.createInstall({ appSlug: "shopify", brandId: "brand_b", regionId: "region_2" });
      const results = store.listInstalls({ appSlug: "cin7" });
      expect(results).toHaveLength(1);
      expect(results[0].appSlug).toBe("cin7");
    });

    it("filters by brandId", () => {
      const store = openStore();
      store.createInstall({ appSlug: "cin7", brandId: "brand_haverford", regionId: "region_1" });
      store.createInstall({ appSlug: "shopify", brandId: "brand_catnets", regionId: "region_2" });
      const results = store.listInstalls({ brandId: "brand_haverford" });
      expect(results).toHaveLength(1);
      expect(results[0].brandId).toBe("brand_haverford");
    });

    it("filters by status", () => {
      const store = openStore();
      store.createInstall({ appSlug: "cin7", brandId: "brand_a", regionId: "region_1", status: "enabled" });
      store.createInstall({ appSlug: "shopify", brandId: "brand_b", regionId: "region_2", status: "pending" });
      const results = store.listInstalls({ status: "enabled" });
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe("enabled");
    });

    it("returns empty array when no installs match filter", () => {
      const store = openStore();
      store.createInstall({ appSlug: "cin7", brandId: "brand_a", regionId: "region_1" });
      expect(store.listInstalls({ appSlug: "nonexistent" })).toHaveLength(0);
    });
  });

  describe("UNIQUE(app_slug, brand_id, region_id)", () => {
    it("second createInstall with same key upserts (replaces) and listInstalls returns only one entry", () => {
      const store = openStore();
      const first = store.createInstall({
        appSlug: "cin7",
        brandId: "brand_haverford",
        regionId: "region_haverford_au"
      });
      // Small delay to ensure different timestamp/id
      const second = store.createInstall({
        appSlug: "cin7",
        brandId: "brand_haverford",
        regionId: "region_haverford_au",
        status: "enabled"
      });
      // Different ids because generatedId generates a new one each call
      expect(second.id).not.toBe(first.id);
      // Only one row in DB for this key
      const all = store.listInstalls({ appSlug: "cin7", brandId: "brand_haverford", regionId: "region_haverford_au" });
      expect(all).toHaveLength(1);
      // The surviving row has the second install's id and status
      expect(all[0].id).toBe(second.id);
      expect(all[0].status).toBe("enabled");
    });
  });

  describe("updateInstallStatus", () => {
    it("changes status", () => {
      const store = openStore();
      const install = store.createInstall({
        appSlug: "cin7",
        brandId: "brand_haverford",
        regionId: "region_haverford_au"
      });
      store.updateInstallStatus(install.id, "enabled");
      expect(store.getInstall(install.id)?.status).toBe("enabled");
    });

    it("sets errorDetail when provided", () => {
      const store = openStore();
      const install = store.createInstall({
        appSlug: "cin7",
        brandId: "brand_haverford",
        regionId: "region_haverford_au"
      });
      store.updateInstallStatus(install.id, "error", "connection refused");
      const updated = store.getInstall(install.id);
      expect(updated?.status).toBe("error");
      expect(updated?.errorDetail).toBe("connection refused");
    });

    it("clears errorDetail when not provided", () => {
      const store = openStore();
      const install = store.createInstall({
        appSlug: "cin7",
        brandId: "brand_haverford",
        regionId: "region_haverford_au"
      });
      store.updateInstallStatus(install.id, "error", "some error");
      store.updateInstallStatus(install.id, "enabled");
      const updated = store.getInstall(install.id);
      expect(updated?.status).toBe("enabled");
      expect(updated?.errorDetail).toBeUndefined();
    });
  });

  describe("deleteInstall", () => {
    it("removes the row", () => {
      const store = openStore();
      const install = store.createInstall({
        appSlug: "cin7",
        brandId: "brand_haverford",
        regionId: "region_haverford_au"
      });
      store.deleteInstall(install.id);
      expect(store.getInstall(install.id)).toBeUndefined();
      expect(store.listInstalls()).toHaveLength(0);
    });
  });

  describe("persistence", () => {
    it("survives close and reopen", () => {
      let store = openStore();
      const install = store.createInstall({
        appSlug: "cin7",
        brandId: "brand_haverford",
        regionId: "region_haverford_au"
      });
      store.close();
      stores = stores.filter((s) => s !== store);

      store = openStore();
      const fetched = store.getInstall(install.id);
      expect(fetched).toEqual(install);
    });
  });
});
