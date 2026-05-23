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
    expect(registry.get("microsoft")?.name).toBe("Microsoft 365");
    expect(registry.get("missing")).toBeUndefined();
  });
});
