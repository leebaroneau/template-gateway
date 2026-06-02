import { DevApiGatewayBackend } from "./dev-api-backend.js";
import { DevApiBrandsClient } from "./dev-api-client.js";
import { FixtureGatewayBackend } from "./fixture-backend.js";
import type { GatewayConnectionBackend } from "./types.js";
import type { GatewayConfig } from "../config.js";

function requireSetting(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} is required when ADMIN_DATA_SOURCE=dev-api`);
  }
  return value;
}

export function buildAdminBackend(config: GatewayConfig): GatewayConnectionBackend {
  if (config.adminDataSource === "fixture") {
    return new FixtureGatewayBackend();
  }

  const baseUrl = requireSetting(config.haverfordDevApiBaseUrl, "HAVERFORD_DEV_API_BASE_URL");
  const clientId = requireSetting(config.haverfordDevApiClientId, "HAVERFORD_DEV_API_CLIENT_ID");
  const clientSecret = requireSetting(config.haverfordDevApiClientSecret, "HAVERFORD_DEV_API_CLIENT_SECRET");

  return new DevApiGatewayBackend(
    new DevApiBrandsClient({
      baseUrl,
      clientId,
      clientSecret
    })
  );
}
