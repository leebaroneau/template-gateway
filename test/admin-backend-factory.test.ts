import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildAdminBackend } from "../src/admin/backend-factory.js";
import type { GatewayConfig } from "../src/config.js";

function baseConfig(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    composioApiKey: "ak_test",
    brandSlug: "haverford",
    gatewayBearer: "a_secret_thats_long_enough",
    port: 3000,
    sessionTtlSeconds: 3600,
    adminDataSource: "fixture",
    gatewayStorePath: "./data/gateway.sqlite",
    ...overrides
  };
}

describe("buildAdminBackend", () => {
  const tempDirs: string[] = [];

  function tempStorePath(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "template-gateway-factory-"));
    tempDirs.push(dir);
    return path.join(dir, "gateway.sqlite");
  }

  function closeBackend(backend: unknown): void {
    if (
      backend &&
      typeof backend === "object" &&
      "close" in backend &&
      typeof (backend as { close?: unknown }).close === "function"
    ) {
      (backend as { close: () => void }).close();
    }
  }

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns fixture data by default", async () => {
    const state = await buildAdminBackend(baseConfig()).snapshot();

    expect(state.brands).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Haverford" })]));
    expect(state.connections).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "connection_haverford_au_dev_api" })])
    );
  });

  it("requires the Dev API base URL when using Dev API admin data", () => {
    expect(() => buildAdminBackend(baseConfig({ adminDataSource: "dev-api" }))).toThrow(
      /HAVERFORD_DEV_API_BASE_URL/
    );
  });

  it("requires the Dev API client ID when using Dev API admin data", () => {
    expect(() =>
      buildAdminBackend(
        baseConfig({
          adminDataSource: "dev-api",
          haverfordDevApiBaseUrl: "https://dev-api.haverford.au"
        })
      )
    ).toThrow(/HAVERFORD_DEV_API_CLIENT_ID/);
  });

  it("requires the Dev API client secret when using Dev API admin data", () => {
    expect(() =>
      buildAdminBackend(
        baseConfig({
          adminDataSource: "dev-api",
          haverfordDevApiBaseUrl: "https://dev-api.haverford.au",
          haverfordDevApiClientId: "gateway-admin"
        })
      )
    ).toThrow(/HAVERFORD_DEV_API_CLIENT_SECRET/);
  });

  it("wraps fixture data with a persistent overlay store without requiring Dev API credentials", async () => {
    const gatewayStorePath = tempStorePath();
    const firstBackend = buildAdminBackend(baseConfig({ adminDataSource: "fixture-overlay", gatewayStorePath }));

    const initialState = await firstBackend.snapshot();
    const created = await firstBackend.createBrand({ name: "Persisted Overlay Brand", slug: "persisted-overlay" });
    const updatedState = await firstBackend.snapshot();
    closeBackend(firstBackend);

    const secondBackend = buildAdminBackend(baseConfig({ adminDataSource: "fixture-overlay", gatewayStorePath }));
    const rebuiltState = await secondBackend.snapshot();
    closeBackend(secondBackend);

    expect(initialState.entityMeta).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: "brand",
          entityId: "brand_haverford",
          source: "fixture",
          hasOverride: false
        })
      ])
    );
    expect(updatedState.brands).toContainEqual(created);
    expect(rebuiltState.brands).toContainEqual(created);
    expect(rebuiltState.entityMeta).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: "brand",
          entityId: created.id,
          source: "gateway",
          sourceLabel: "Gateway overlay"
        })
      ])
    );
  });

  it("requires the Dev API settings when using Dev API overlay admin data", () => {
    expect(() => buildAdminBackend(baseConfig({ adminDataSource: "dev-api-overlay", gatewayStorePath: tempStorePath() }))).toThrow(
      /HAVERFORD_DEV_API_BASE_URL/
    );
  });
});
