import { dirname, join } from "node:path";
import type { GatewayConfig } from "../../config.js";
import { MicrosoftProviderService } from "./service.js";
import { MicrosoftOAuthStateStore } from "./state-store.js";
import { MicrosoftTokenStore } from "./token-store.js";

export function createMicrosoftProviderService(config: GatewayConfig): MicrosoftProviderService {
  return new MicrosoftProviderService({
    config: config.microsoft,
    stateStore: new MicrosoftOAuthStateStore(join(dirname(config.microsoft.tokenStorePath), "microsoft-oauth-states.json")),
    tokenStore: new MicrosoftTokenStore(config.microsoft.tokenStorePath, config.microsoft.tokenStoreKey)
  });
}
