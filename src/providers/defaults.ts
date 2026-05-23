import type { GatewayConfig } from "../config.js";
import type { GatewayProviderDefinition } from "./types.js";

export const MICROSOFT_PROVIDER: GatewayProviderDefinition = {
  slug: "microsoft",
  name: "Microsoft 365",
  description: "Microsoft Graph access for Outlook mail, Calendar, and selected Graph operations.",
  auth: "oauth",
  mcpPath: "/mcp/microsoft",
  scopesSummary: "Delegated Microsoft Graph access for the connected Microsoft login."
};

export const PIPEDRIVE_PROVIDER: GatewayProviderDefinition = {
  slug: "pipedrive",
  name: "Pipedrive CRM",
  description: "Pipedrive CRM access for deals, persons, organizations, and activities.",
  auth: "oauth",
  mcpPath: "/mcp/pipedrive",
  scopesSummary: "Delegated Pipedrive access for the connected Pipedrive user."
};

const DEFAULT_PROVIDERS = new Map<string, GatewayProviderDefinition>([
  [MICROSOFT_PROVIDER.slug, MICROSOFT_PROVIDER],
  [PIPEDRIVE_PROVIDER.slug, PIPEDRIVE_PROVIDER]
]);

export function providersFromConfig(config: Pick<GatewayConfig, "enabledProviders">): GatewayProviderDefinition[] {
  return config.enabledProviders.map((slug) => {
    const provider = DEFAULT_PROVIDERS.get(slug.trim().toLowerCase());
    if (!provider) {
      throw new Error(`Unknown enabled provider: ${slug}`);
    }
    return { ...provider };
  });
}
