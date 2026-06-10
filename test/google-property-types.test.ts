import { describe, expect, it } from "vitest";
import {
  googleProducts,
  googleProductScopes,
  googleConnectorBinding
} from "../src/google-oauth/types.js";

describe("google_business product", () => {
  it("exists in googleProducts array", () => {
    expect(googleProducts).toContain("google_business");
  });

  it("has a scope in googleProductScopes", () => {
    expect(googleProductScopes["google_business"]).toBe(
      "https://www.googleapis.com/auth/business.manage"
    );
  });

  it("has a binding for google-business-profile connector", () => {
    const binding = googleConnectorBinding["google-business-profile"];
    expect(binding).toBeDefined();
    expect(binding.product).toBe("google_business");
    expect(binding.configKey).toBe("location_name");
  });
});
