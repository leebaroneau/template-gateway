import { DevApiGatewayBackend } from "./dev-api-backend.js";
import { DevApiBrandsClient } from "./dev-api-client.js";
import { FixtureGatewayBackend } from "./fixture-backend.js";
import { OverlayGatewayBackend } from "./overlay-backend.js";
import { GatewayOverlayStore } from "./overlay-store.js";
import type { GatewayConnectionBackend } from "./types.js";
import type { GatewayConfig } from "../config.js";

function requireSetting(value: string | undefined, name: string, dataSource: GatewayConfig["adminDataSource"]): string {
  if (!value) {
    throw new Error(`${name} is required when ADMIN_DATA_SOURCE=${dataSource}`);
  }
  return value;
}

function buildDevApiBackend(config: GatewayConfig): DevApiGatewayBackend {
  const baseUrl = requireSetting(config.haverfordDevApiBaseUrl, "HAVERFORD_DEV_API_BASE_URL", config.adminDataSource);
  const clientId = requireSetting(config.haverfordDevApiClientId, "HAVERFORD_DEV_API_CLIENT_ID", config.adminDataSource);
  const clientSecret = requireSetting(
    config.haverfordDevApiClientSecret,
    "HAVERFORD_DEV_API_CLIENT_SECRET",
    config.adminDataSource
  );

  return new DevApiGatewayBackend(
    new DevApiBrandsClient({
      baseUrl,
      clientId,
      clientSecret
    })
  );
}

export function buildAdminBackend(config: GatewayConfig): GatewayConnectionBackend {
  if (config.adminDataSource === "fixture") {
    return new FixtureGatewayBackend();
  }

  if (config.adminDataSource === "dev-api") {
    return buildDevApiBackend(config);
  }

  if (config.adminDataSource === "fixture-overlay") {
    return new OverlayGatewayBackend({
      source: new FixtureGatewayBackend(),
      store: new GatewayOverlayStore(config.gatewayStorePath),
      sourceLabel: "Fixture backend",
      sourceType: "fixture"
    });
  }

  return new OverlayGatewayBackend({
    source: buildDevApiBackend(config),
    store: new GatewayOverlayStore(config.gatewayStorePath),
    sourceLabel: "Haverford Dev API",
    sourceType: "dev_api"
  });
}
