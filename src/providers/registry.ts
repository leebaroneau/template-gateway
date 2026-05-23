import type { GatewayProviderDefinition, ProviderRegistry } from "./types.js";

export function createProviderRegistry(
  providers: GatewayProviderDefinition[] = []
): ProviderRegistry {
  const normalized = providers
    .map((provider) => ({ ...provider, slug: provider.slug.trim().toLowerCase() }))
    .sort((a, b) => a.slug.localeCompare(b.slug));
  const bySlug = new Map(normalized.map((provider) => [provider.slug, provider]));

  return {
    list: () => normalized.map((provider) => ({ ...provider })),
    get: (slug: string) => {
      const provider = bySlug.get(slug.trim().toLowerCase());
      return provider ? { ...provider } : undefined;
    }
  };
}
