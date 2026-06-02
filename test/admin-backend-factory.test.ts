import { describe, expect, it } from "vitest";
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
});
