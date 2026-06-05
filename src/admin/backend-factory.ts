import { DevApiGatewayBackend } from "./dev-api-backend.js";
import { DevApiBrandsClient } from "./dev-api-client.js";
import { mapDevApiBrandsToGatewayState } from "./dev-api-mapper.js";
import { FixtureGatewayBackend } from "./fixture-backend.js";
import { OverlayGatewayBackend } from "./overlay-backend.js";
import { GatewayOverlayStore } from "./overlay-store.js";
import type { GatewayConnectionBackend, GatewayState } from "./types.js";
import type { GatewayConfig } from "../config.js";
import type { GatewayAccessStore } from "../access/store.js";

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

export function buildAdminBackend(config: GatewayConfig, accessStore?: GatewayAccessStore): GatewayConnectionBackend {
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

  if (config.adminDataSource === "gateway-store") {
    // Serves data exclusively from the gateway SQLite overlay store.
    // Connector catalog uses the merged (fixture + mapper) definitions, filtered by
    // per-deployment enable/disable settings stored in gateway_connector_settings.
    const allConnectors = mapDevApiBrandsToGatewayState({ brands: [] }).connectors;
    const emptyCatalogBackend: GatewayConnectionBackend = {
      ...new FixtureGatewayBackend(),
      // Re-evaluate the enabled filter on EVERY snapshot so runtime toggles
      // (enable/disable a connector) take effect without a restart.
      snapshot: async (): Promise<GatewayState> => ({
        brands: [],
        regions: [],
        connections: [],
        connectors: accessStore
          ? allConnectors.filter((c) => accessStore.isConnectorEnabled(c.id))
          : allConnectors,
        apiClients: [],
        auditEvents: [],
        entityMeta: [],
      }),
    } as GatewayConnectionBackend;

    return new OverlayGatewayBackend({
      source: emptyCatalogBackend,
      store: new GatewayOverlayStore(config.gatewayStorePath),
      sourceLabel: "Gateway store",
      sourceType: "gateway",
    });
  }

  return new OverlayGatewayBackend({
    source: buildDevApiBackend(config),
    store: new GatewayOverlayStore(config.gatewayStorePath),
    sourceLabel: "Haverford Dev API",
    sourceType: "dev_api"
  });
}
