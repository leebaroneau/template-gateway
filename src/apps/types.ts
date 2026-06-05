export type GatewayAppInstallStatus = "pending" | "enabled" | "disabled" | "error";

export interface GatewayAppManifest {
  slug: string;
  name: string;
  description: string;
  requiredConnectors: string[];
  tools: Array<{ slug: string; name: string; mode: "read" | "write" }>;
}

export interface GatewayAppInstall {
  id: string;
  appSlug: string;
  brandId: string;
  regionId: string;
  connectionId?: string;
  status: GatewayAppInstallStatus;
  createdAt: string;
  updatedAt: string;
  errorDetail?: string;
}

export interface CreateAppInstallInput {
  appSlug: string;
  brandId: string;
  regionId: string;
  connectionId?: string;
  status?: GatewayAppInstallStatus;
}
