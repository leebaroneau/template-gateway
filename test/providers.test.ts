import { describe, expect, it } from "vitest";
import { createProviderRegistry } from "../src/providers/registry.js";

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
