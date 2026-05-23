import express, { type Express } from "express";
import type { GatewayConfig } from "./config.js";
import { createProviderDirectory } from "./providers/directory.js";
import { providersFromConfig } from "./providers/defaults.js";
import { createMicrosoftProviderService } from "./providers/microsoft/factory.js";
import type { MicrosoftProviderService } from "./providers/microsoft/service.js";
import { createProviderRegistry } from "./providers/registry.js";
import type { GatewayProviderDefinition } from "./providers/types.js";

export interface HttpAppOptions {
  config: GatewayConfig;
  providers?: GatewayProviderDefinition[];
  microsoftProvider?: MicrosoftProviderService;
}

export function createHttpApp(options: HttpAppOptions): Express {
  const app = express();
  const providers = createProviderRegistry(options.providers ?? providersFromConfig(options.config));
  const microsoftProvider = options.microsoftProvider ?? createMicrosoftProviderService(options.config);

  app.use(express.json());

  app.get("/health", (_request, response) => {
    response.json({ status: "ok", service: "template-gateway" });
  });

  app.get("/providers", (_request, response) => {
    response.json(createProviderDirectory(options.config.apiBaseUrl, providers));
  });

  app.get("/mcp", (_request, response) => {
    response.json(createProviderDirectory(options.config.apiBaseUrl, providers));
  });

  app.get("/auth/microsoft/connect", async (request, response, next) => {
    try {
      const actorEmail = stringQuery(request.query.actor);
      if (!actorEmail) {
        response.status(400).json({ error: "actor query parameter is required" });
        return;
      }
      response.json(await microsoftProvider.createConnectUrl({
        actorId: stringQuery(request.query.actorId),
        actorEmail,
        actorName: stringQuery(request.query.actorName)
      }));
    } catch (error) {
      next(error);
    }
  });

  app.get("/auth/microsoft/callback", async (request, response, next) => {
    try {
      const state = stringQuery(request.query.state);
      const code = stringQuery(request.query.code);
      if (!state || !code) {
        response.status(400).json({ error: "state and code query parameters are required" });
        return;
      }
      response.json(await microsoftProvider.completeCallback({ state, code }));
    } catch (error) {
      next(error);
    }
  });

  app.get("/providers/microsoft/status", async (request, response, next) => {
    try {
      const actor = stringQuery(request.query.actor);
      if (!actor) {
        response.status(400).json({ error: "actor query parameter is required" });
        return;
      }
      response.json(await microsoftProvider.status(actor));
    } catch (error) {
      next(error);
    }
  });

  app.get("/providers/microsoft/tools", (_request, response) => {
    response.json({ provider: "microsoft", tools: microsoftProvider.listTools() });
  });

  return app;
}

function stringQuery(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}
