export type ProviderAuthMode = "none" | "oauth" | "static-service-token";

export type ProviderBackend = "composio" | "native";

export interface GatewayProviderDefinition {
  slug: string;
  name: string;
  description: string;
  auth: ProviderAuthMode;
  mcpPath: string;
  scopesSummary: string;
  backend?: ProviderBackend;
}

export interface ProviderRegistry {
  list(): GatewayProviderDefinition[];
  get(slug: string): GatewayProviderDefinition | undefined;
}
