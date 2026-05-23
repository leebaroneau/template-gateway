import express, { type Express } from "express";
import type { GatewayConfig } from "./config.js";
import { createProviderRegistry } from "./providers/registry.js";
import type { GatewayProviderDefinition, ProviderRegistry } from "./providers/types.js";

export interface HttpAppOptions {
  config: GatewayConfig;
  providers?: GatewayProviderDefinition[];
}

export function createHttpApp(options: HttpAppOptions): Express {
  const app = express();
  const providers = createProviderRegistry(options.providers ?? []);

  app.use(express.json());

  app.get("/health", (_request, response) => {
    response.json({ status: "ok", service: "template-gateway" });
  });

  app.get("/providers", (_request, response) => {
    response.json(toProviderDirectory(options.config.apiBaseUrl, providers));
  });

  app.get("/mcp", (_request, response) => {
    response.json(toProviderDirectory(options.config.apiBaseUrl, providers));
  });

  return app;
}

function toProviderDirectory(apiBaseUrl: string, providers: ProviderRegistry) {
  return {
    providers: providers.list().map((provider) => ({
      ...provider,
      url: new URL(provider.mcpPath, apiBaseUrl).toString()
    }))
  };
}
