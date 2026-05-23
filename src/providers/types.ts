export type ProviderAuthMode = "none" | "oauth" | "static-service-token";

export interface GatewayProviderDefinition {
  slug: string;
  name: string;
  description: string;
  auth: ProviderAuthMode;
  mcpPath: string;
  scopesSummary: string;
}

export interface ProviderRegistry {
  list(): GatewayProviderDefinition[];
  get(slug: string): GatewayProviderDefinition | undefined;
}
