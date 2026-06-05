import { describe, it, expect } from "vitest";
import { ComposioConnectorAdapter } from "../src/connectors/composio.js";

describe("ComposioConnectorAdapter", () => {
  describe("listCapabilities", () => {
    it("returns 3 capabilities for pipedrive", () => {
      const adapter = new ComposioConnectorAdapter({ apiKey: "test-key" });
      const caps = adapter.listCapabilities("pipedrive");
      expect(caps).toHaveLength(3);
    });

    it("returns 2 capabilities for outlook", () => {
      const adapter = new ComposioConnectorAdapter({ apiKey: "test-key" });
      const caps = adapter.listCapabilities("outlook");
      expect(caps).toHaveLength(2);
    });

    it("returns empty array for unknown connector", () => {
      const adapter = new ComposioConnectorAdapter({ apiKey: "test-key" });
      const caps = adapter.listCapabilities("unknown");
      expect(caps).toEqual([]);
    });
  });

  describe("getStatus", () => {
    it("returns 'available' when apiKey is set", () => {
      const adapter = new ComposioConnectorAdapter({ apiKey: "my-api-key" });
      expect(adapter.getStatus()).toBe("available");
    });

    it("returns 'unconfigured' when apiKey is empty string", () => {
      const adapter = new ComposioConnectorAdapter({ apiKey: "" });
      expect(adapter.getStatus()).toBe("unconfigured");
    });
  });

  describe("supportedSlugs", () => {
    it("uses default slugs (pipedrive, outlook) when not provided", () => {
      const adapter = new ComposioConnectorAdapter({ apiKey: "key" });
      expect(adapter.info.supportedConnectorSlugs).toEqual(["pipedrive", "outlook"]);
    });

    it("uses custom supportedSlugs when provided", () => {
      const adapter = new ComposioConnectorAdapter({
        apiKey: "key",
        supportedSlugs: ["hubspot", "salesforce"],
      });
      expect(adapter.info.supportedConnectorSlugs).toEqual(["hubspot", "salesforce"]);
    });

    it("returns empty for a connector not in custom slugs", () => {
      const adapter = new ComposioConnectorAdapter({
        apiKey: "key",
        supportedSlugs: ["hubspot"],
      });
      expect(adapter.listCapabilities("pipedrive")).toEqual([]);
    });
  });

  describe("info", () => {
    it("has backendType === 'composio'", () => {
      const adapter = new ComposioConnectorAdapter({ apiKey: "key" });
      expect(adapter.info.backendType).toBe("composio");
    });

    it("has slug === 'composio'", () => {
      const adapter = new ComposioConnectorAdapter({ apiKey: "key" });
      expect(adapter.info.slug).toBe("composio");
    });

    it("has name === 'Composio'", () => {
      const adapter = new ComposioConnectorAdapter({ apiKey: "key" });
      expect(adapter.info.name).toBe("Composio");
    });
  });
});
