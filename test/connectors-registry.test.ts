import { describe, it, expect } from "vitest";
import { ConnectorAdapterRegistry } from "../src/connectors/registry.js";
import { ComposioConnectorAdapter } from "../src/connectors/composio.js";
import { NangoConnectorAdapter } from "../src/connectors/nango.js";

describe("ConnectorAdapterRegistry", () => {
  describe("get", () => {
    it("returns the registered adapter for a known connector slug", () => {
      const registry = new ConnectorAdapterRegistry();
      const composio = new ComposioConnectorAdapter({ apiKey: "key" });
      registry.register(composio);
      expect(registry.get("pipedrive")).toBe(composio);
    });

    it("returns undefined for an unknown connector slug", () => {
      const registry = new ConnectorAdapterRegistry();
      expect(registry.get("unknown")).toBeUndefined();
    });

    it("returns undefined after registering an adapter that does not cover the slug", () => {
      const registry = new ConnectorAdapterRegistry();
      const composio = new ComposioConnectorAdapter({ apiKey: "key" });
      registry.register(composio);
      expect(registry.get("google-search-console")).toBeUndefined();
    });
  });

  describe("list", () => {
    it("returns empty array when registry is empty", () => {
      const registry = new ConnectorAdapterRegistry();
      expect(registry.list()).toEqual([]);
    });

    it("returns 1 adapter when only Composio is registered (not 2 for its 2 slugs)", () => {
      const registry = new ConnectorAdapterRegistry();
      const composio = new ComposioConnectorAdapter({ apiKey: "key" });
      registry.register(composio);
      const listed = registry.list();
      expect(listed).toHaveLength(1);
      expect(listed[0]).toBe(composio);
    });

    it("returns 2 adapters when both Composio and Nango are registered (deduplicated, not 4)", () => {
      const registry = new ConnectorAdapterRegistry();
      const composio = new ComposioConnectorAdapter({ apiKey: "key" });
      const nango = new NangoConnectorAdapter({ secretKey: "secret" });
      registry.register(composio);
      registry.register(nango);
      const listed = registry.list();
      expect(listed).toHaveLength(2);
      expect(listed).toContain(composio);
      expect(listed).toContain(nango);
    });
  });

  describe("priority-chain resolution on slug collision", () => {
    it("first registered adapter wins when both adapters are available", () => {
      const registry = new ConnectorAdapterRegistry();
      const first = new ComposioConnectorAdapter({
        apiKey: "key-1",
        supportedSlugs: ["shared-slug"],
      });
      const second = new ComposioConnectorAdapter({
        apiKey: "key-2",
        supportedSlugs: ["shared-slug"],
      });
      registry.register(first);
      registry.register(second);
      expect(registry.get("shared-slug")).toBe(first);
    });

    it("falls through to second adapter when first is unconfigured", () => {
      const registry = new ConnectorAdapterRegistry();
      const unconfigured = new ComposioConnectorAdapter({
        apiKey: "",
        supportedSlugs: ["shared-slug"],
      });
      const configured = new ComposioConnectorAdapter({
        apiKey: "key-2",
        supportedSlugs: ["shared-slug"],
      });
      registry.register(unconfigured);
      registry.register(configured);
      expect(registry.get("shared-slug")).toBe(configured);
    });

    it("resolve() respects backendOverride even when a higher-priority adapter is available", () => {
      const registry = new ConnectorAdapterRegistry();
      const nango = new NangoConnectorAdapter({ secretKey: "nango-secret", supportedSlugs: ["shared-slug"] });
      const composio = new ComposioConnectorAdapter({ apiKey: "composio-key", supportedSlugs: ["shared-slug"] });
      registry.register(nango);
      registry.register(composio);
      expect(registry.resolve("shared-slug")).toBe(nango);
      expect(registry.resolve("shared-slug", "composio")).toBe(composio);
    });

    it("list() deduplicates so a slug collision returns 2 adapters, not 3", () => {
      const registry = new ConnectorAdapterRegistry();
      const first = new ComposioConnectorAdapter({
        apiKey: "key-1",
        supportedSlugs: ["shared-slug"],
      });
      const second = new ComposioConnectorAdapter({
        apiKey: "key-2",
        supportedSlugs: ["shared-slug"],
      });
      registry.register(first);
      registry.register(second);
      expect(registry.list()).toHaveLength(2);
      expect(registry.list()).toContain(first);
      expect(registry.list()).toContain(second);
    });
  });
});
