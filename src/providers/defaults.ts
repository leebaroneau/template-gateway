import type { GatewayConfig } from "../config.js";
import type { GatewayProviderDefinition } from "./types.js";

export const MICROSOFT_PROVIDER: GatewayProviderDefinition = {
  slug: "microsoft",
  name: "Microsoft 365",
  description: "Microsoft Graph access for Outlook mail, Calendar, and selected Graph operations.",
  auth: "oauth",
  mcpPath: "/mcp/microsoft",
  scopesSummary: "Delegated Microsoft Graph access for the connected Microsoft login.",
  backend: "native"
};

export const GOOGLE_PROVIDER: GatewayProviderDefinition = {
  slug: "google",
  name: "Google Workspace",
  description: "Google Workspace access for Gmail, Calendar, and selected Google API operations.",
  auth: "oauth",
  mcpPath: "/mcp/google",
  scopesSummary: "Delegated Google Workspace access for the connected Google login.",
  backend: "native"
};

export const PIPEDRIVE_PROVIDER: GatewayProviderDefinition = {
  slug: "pipedrive",
  name: "Pipedrive CRM",
  description: "Pipedrive CRM access for deals, persons, organizations, and activities.",
  auth: "oauth",
  mcpPath: "/mcp/pipedrive",
  scopesSummary: "Delegated Pipedrive access for the connected Pipedrive user.",
  backend: "native"
};

export const MICROSOFT_COMPOSIO_PROVIDER: GatewayProviderDefinition = {
  slug: "microsoft-composio",
  name: "Microsoft 365 (Composio)",
  description: "Composio-backed Microsoft 365 access for deployments that opt in to Composio for upstream identity.",
  auth: "oauth",
  mcpPath: "/mcp/microsoft-composio",
  scopesSummary: "Delegated Microsoft Graph access via Composio.",
  backend: "composio"
};

export const GOOGLE_COMPOSIO_PROVIDER: GatewayProviderDefinition = {
  slug: "google-composio",
  name: "Google Workspace (Composio)",
  description: "Composio-backed Google Workspace access for deployments that opt in to Composio for upstream identity.",
  auth: "oauth",
  mcpPath: "/mcp/google-composio",
  scopesSummary: "Delegated Google Workspace access via Composio.",
  backend: "composio"
};

const NATIVE_PROVIDERS = new Map<string, GatewayProviderDefinition>([
  [MICROSOFT_PROVIDER.slug, MICROSOFT_PROVIDER],
  [GOOGLE_PROVIDER.slug, GOOGLE_PROVIDER],
  [PIPEDRIVE_PROVIDER.slug, PIPEDRIVE_PROVIDER]
]);

const COMPOSIO_PROVIDERS = new Map<string, GatewayProviderDefinition>([
  [MICROSOFT_COMPOSIO_PROVIDER.slug, MICROSOFT_COMPOSIO_PROVIDER],
  [GOOGLE_COMPOSIO_PROVIDER.slug, GOOGLE_COMPOSIO_PROVIDER]
]);

export function providersFromConfig(
  // enableComposioProviders is optional so callers that build partial config
  // (e.g. older tests) still type-check; an undefined value behaves as `false`.
  config: Pick<GatewayConfig, "enabledProviders"> & { enableComposioProviders?: boolean }
): GatewayProviderDefinition[] {
  const composioEnabled = config.enableComposioProviders === true;
  return config.enabledProviders.map((rawSlug) => {
    const slug = rawSlug.trim().toLowerCase();
    const native = NATIVE_PROVIDERS.get(slug);
    if (native) {
      return { ...native };
    }
    const composio = COMPOSIO_PROVIDERS.get(slug);
    if (composio) {
      if (!composioEnabled) {
        throw new Error(`Composio providers are disabled; cannot enable: ${slug}. Set ENABLE_COMPOSIO_PROVIDERS=true.`);
      }
      return { ...composio };
    }
    throw new Error(`Unknown enabled provider: ${rawSlug}`);
  });
}
