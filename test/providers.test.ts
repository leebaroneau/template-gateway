import { describe, expect, it } from "vitest";
import { createProviderRegistry } from "../src/providers/registry.js";
import {
  providersFromConfig,
  MICROSOFT_PROVIDER,
  GOOGLE_PROVIDER,
  PIPEDRIVE_PROVIDER,
  MICROSOFT_COMPOSIO_PROVIDER,
  GOOGLE_COMPOSIO_PROVIDER
} from "../src/providers/defaults.js";

describe("provider registry", () => {
  it("lists providers in stable slug order", () => {
    const registry = createProviderRegistry([
      {
        slug: "pipedrive",
        name: "Pipedrive",
        description: "CRM",
        auth: "oauth",
        mcpPath: "/mcp/pipedrive",
        scopesSummary: "Read and write CRM data."
      },
      {
        slug: "microsoft",
        name: "Microsoft 365",
        description: "Outlook, Calendar, OneDrive",
        auth: "oauth",
        mcpPath: "/mcp/microsoft",
        scopesSummary: "Read and write Microsoft 365 data."
      }
    ]);

    expect(registry.list().map((provider) => provider.slug)).toEqual(["microsoft", "pipedrive"]);
    expect(registry.get(" Microsoft ")?.name).toBe("Microsoft 365");
    expect(registry.get("missing")).toBeUndefined();
  });

  it("returns provider copies from list", () => {
    const registry = createProviderRegistry([
      {
        slug: "microsoft",
        name: "Microsoft 365",
        description: "Outlook, Calendar, OneDrive",
        auth: "oauth",
        mcpPath: "/mcp/microsoft",
        scopesSummary: "Read and write Microsoft 365 data."
      }
    ]);

    const [provider] = registry.list();
    provider.name = "Mutated";

    expect(registry.get("microsoft")?.name).toBe("Microsoft 365");
    expect(registry.list()[0]?.name).toBe("Microsoft 365");
  });

  it("returns provider copies from get", () => {
    const registry = createProviderRegistry([
      {
        slug: "microsoft",
        name: "Microsoft 365",
        description: "Outlook, Calendar, OneDrive",
        auth: "oauth",
        mcpPath: "/mcp/microsoft",
        scopesSummary: "Read and write Microsoft 365 data."
      }
    ]);

    const provider = registry.get("microsoft");
    expect(provider).toBeDefined();
    provider!.name = "Mutated";

    expect(registry.get("microsoft")?.name).toBe("Microsoft 365");
    expect(registry.list()[0]?.name).toBe("Microsoft 365");
  });
});

describe("providersFromConfig — native-default architecture", () => {
  it("registers native microsoft when listed in enabledProviders", () => {
    const result = providersFromConfig({
      enabledProviders: ["microsoft"],
      enableComposioProviders: false
    });
    expect(result).toEqual([MICROSOFT_PROVIDER]);
  });

  it("registers native google when listed in enabledProviders", () => {
    const result = providersFromConfig({
      enabledProviders: ["google"],
      enableComposioProviders: false
    });
    expect(result).toEqual([GOOGLE_PROVIDER]);
  });

  it("registers native pipedrive when listed in enabledProviders", () => {
    const result = providersFromConfig({
      enabledProviders: ["pipedrive"],
      enableComposioProviders: false
    });
    expect(result).toEqual([PIPEDRIVE_PROVIDER]);
  });

  it("refuses microsoft-composio slug when ENABLE_COMPOSIO_PROVIDERS is off", () => {
    expect(() => providersFromConfig({
      enabledProviders: ["microsoft-composio"],
      enableComposioProviders: false
    })).toThrow(/composio.*disabled|composio providers are disabled/i);
  });

  it("registers microsoft-composio when flag is on and slug is listed", () => {
    const result = providersFromConfig({
      enabledProviders: ["microsoft-composio"],
      enableComposioProviders: true
    });
    expect(result).toEqual([MICROSOFT_COMPOSIO_PROVIDER]);
  });

  it("registers google-composio when flag is on and slug is listed", () => {
    const result = providersFromConfig({
      enabledProviders: ["google-composio"],
      enableComposioProviders: true
    });
    expect(result).toEqual([GOOGLE_COMPOSIO_PROVIDER]);
  });

  it("registers a mix of native and composio entries with flag on", () => {
    const result = providersFromConfig({
      enabledProviders: ["microsoft", "google", "microsoft-composio", "google-composio"],
      enableComposioProviders: true
    });
    expect(result.map((p) => p.slug)).toEqual([
      "microsoft",
      "google",
      "microsoft-composio",
      "google-composio"
    ]);
  });

  it("rejects unknown slugs", () => {
    expect(() => providersFromConfig({
      enabledProviders: ["frobnicate"],
      enableComposioProviders: false
    })).toThrow(/unknown enabled provider/i);
  });
});
