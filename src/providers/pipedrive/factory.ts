import { dirname, join } from "node:path";
import type { GatewayConfig } from "../../config.js";
import { PipedriveProviderService } from "./service.js";
import { PipedriveOAuthStateStore } from "./state-store.js";
import { PipedriveTokenStore } from "./token-store.js";

export function createPipedriveProviderService(config: GatewayConfig): PipedriveProviderService {
  return new PipedriveProviderService({
    config: config.pipedrive,
    stateStore: new PipedriveOAuthStateStore(
      join(dirname(config.pipedrive.tokenStorePath), "pipedrive-oauth-states.json")
    ),
    tokenStore: new PipedriveTokenStore(config.pipedrive.tokenStorePath, config.pipedrive.tokenStoreKey)
  });
}
