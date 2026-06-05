import type { GatewayAppManifest } from "./types.js";

export const HAVERFORD_STOREFRONT_APP: GatewayAppManifest = {
  slug: "haverford-storefront",
  name: "Haverford Storefront",
  description: "Storefront intelligence for a Haverford brand region powered by a connected Shopify store.",
  requiredConnectors: ["shopify"],
  tools: [
    { slug: "storefront_overview", name: "Storefront Overview", mode: "read" },
    { slug: "product_health", name: "Product Health", mode: "read" },
    { slug: "order_summary", name: "Order Summary", mode: "read" }
  ]
};

export const BUILT_IN_APPS: GatewayAppManifest[] = [HAVERFORD_STOREFRONT_APP];
