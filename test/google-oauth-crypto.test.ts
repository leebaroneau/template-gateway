import { describe, it } from "vitest";
import type { GoogleProduct, GoogleOAuthCredential } from "../src/google-oauth/types.js";

describe("types", () => {
  it("compiles", () => {
    const product: GoogleProduct = "ga4";
    const _ = product satisfies GoogleProduct;
  });
});
