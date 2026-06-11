import { describe, expect, it } from "vitest";
import { mapDevApiBrandsToGatewayState } from "../src/admin/dev-api-mapper.js";

describe("google-business-profile connector", () => {
  it("appears in the full connector catalog", () => {
    const state = mapDevApiBrandsToGatewayState({ brands: [] });
    const gbp = state.connectors.find((c) => c.slug === "google-business-profile");
    expect(gbp).toBeDefined();
    expect(gbp!.authMode).toBe("oauth");
    expect(gbp!.requiredFields.some((f) => f.key === "location_name")).toBe(true);
  });
});
