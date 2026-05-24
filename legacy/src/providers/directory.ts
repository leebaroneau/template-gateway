import type { GatewayProviderDefinition, ProviderRegistry } from "./types.js";

export interface GatewayProviderDirectoryEntry extends GatewayProviderDefinition {
  url: string;
}

export interface GatewayProviderDirectory {
  providers: GatewayProviderDirectoryEntry[];
}

export function createProviderDirectory(
  apiBaseUrl: string,
  providers: ProviderRegistry
): GatewayProviderDirectory {
  return {
    providers: providers.list().map((provider) => ({
      ...provider,
      url: new URL(provider.mcpPath, apiBaseUrl).toString()
    }))
  };
}
