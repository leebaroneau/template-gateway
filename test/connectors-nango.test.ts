import { describe, it, expect } from "vitest";
import { NangoConnectorAdapter } from "../src/connectors/nango.js";

describe("NangoConnectorAdapter", () => {
  describe("listCapabilities", () => {
    it("returns 2 capabilities for google-search-console", () => {
      const adapter = new NangoConnectorAdapter({ secretKey: "test-key" });
      const caps = adapter.listCapabilities("google-search-console");
      expect(caps).toHaveLength(2);
    });

    it("returns 3 capabilities for meta-ads", () => {
      const adapter = new NangoConnectorAdapter({ secretKey: "test-key" });
      const caps = adapter.listCapabilities("meta-ads");
      expect(caps).toHaveLength(3);
    });

    it("returns empty array for unknown connector", () => {
      const adapter = new NangoConnectorAdapter({ secretKey: "test-key" });
      const caps = adapter.listCapabilities("unknown");
      expect(caps).toEqual([]);
    });
  });

  describe("getStatus", () => {
    it("returns 'available' when secretKey is set", () => {
      const adapter = new NangoConnectorAdapter({ secretKey: "my-secret-key" });
      expect(adapter.getStatus()).toBe("available");
    });

    it("returns 'unconfigured' when secretKey is absent", () => {
      const adapter = new NangoConnectorAdapter({});
      expect(adapter.getStatus()).toBe("unconfigured");
    });

    it("returns 'unconfigured' when secretKey is empty string", () => {
      const adapter = new NangoConnectorAdapter({ secretKey: "" });
      expect(adapter.getStatus()).toBe("unconfigured");
    });
  });

  describe("supportedSlugs", () => {
    it("uses default slugs (google-search-console, meta-ads) when not provided", () => {
      const adapter = new NangoConnectorAdapter({ secretKey: "key" });
      expect(adapter.info.supportedConnectorSlugs).toEqual([
        "google-search-console",
        "meta-ads",
      ]);
    });

    it("uses custom supportedSlugs when provided", () => {
      const adapter = new NangoConnectorAdapter({
        secretKey: "key",
        supportedSlugs: ["slack", "github"],
      });
      expect(adapter.info.supportedConnectorSlugs).toEqual(["slack", "github"]);
    });

    it("returns empty for a connector not in custom slugs", () => {
      const adapter = new NangoConnectorAdapter({
        secretKey: "key",
        supportedSlugs: ["slack"],
      });
      expect(adapter.listCapabilities("google-search-console")).toEqual([]);
    });
  });

  describe("info", () => {
    it("has backendType === 'nango'", () => {
      const adapter = new NangoConnectorAdapter({ secretKey: "key" });
      expect(adapter.info.backendType).toBe("nango");
    });

    it("has slug === 'nango'", () => {
      const adapter = new NangoConnectorAdapter({ secretKey: "key" });
      expect(adapter.info.slug).toBe("nango");
    });

    it("has name === 'Nango'", () => {
      const adapter = new NangoConnectorAdapter({ secretKey: "key" });
      expect(adapter.info.name).toBe("Nango");
    });

    it("publicKey is accepted without affecting status", () => {
      const adapter = new NangoConnectorAdapter({
        secretKey: "key",
        publicKey: "pub-key",
      });
      expect(adapter.getStatus()).toBe("available");
    });
  });
});
