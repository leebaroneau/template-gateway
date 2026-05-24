import express, { type Express } from "express";
import type { GatewayConfig } from "./config.js";
import { createProviderDirectory } from "./providers/directory.js";
import { providersFromConfig } from "./providers/defaults.js";
import { createMicrosoftProviderService } from "./providers/microsoft/factory.js";
import type { MicrosoftProviderService } from "./providers/microsoft/service.js";
import { createPipedriveProviderService } from "./providers/pipedrive/factory.js";
import type { PipedriveProviderService } from "./providers/pipedrive/service.js";
import { createComposioProviderService } from "./providers/composio/factory.js";
import type { ComposioProviderService } from "./providers/composio/service.js";
import type { ComposioGatewayProvider } from "./providers/composio/types.js";
import { createProviderRegistry } from "./providers/registry.js";
import type { GatewayProviderDefinition } from "./providers/types.js";

export interface HttpAppOptions {
  config: GatewayConfig;
  providers?: GatewayProviderDefinition[];
  microsoftProvider?: MicrosoftProviderService;
  pipedriveProvider?: PipedriveProviderService;
  composioProvider?: Pick<ComposioProviderService, "createConnectUrl" | "status" | "mcpUrl">;
}

export function createHttpApp(options: HttpAppOptions): Express {
  const app = express();
  const providers = createProviderRegistry(options.providers ?? providersFromConfig(options.config));
  const microsoftProvider = options.microsoftProvider ?? createMicrosoftProviderService(options.config);
  const pipedriveProvider = options.pipedriveProvider ?? createPipedriveProviderService(options.config);

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

  app.get("/auth/pipedrive/connect", async (request, response, next) => {
    try {
      const actorEmail = stringQuery(request.query.actor);
      if (!actorEmail) {
        response.status(400).json({ error: "actor query parameter is required" });
        return;
      }
      response.json(await pipedriveProvider.createConnectUrl({
        actorId: stringQuery(request.query.actorId),
        actorEmail,
        actorName: stringQuery(request.query.actorName)
      }));
    } catch (error) {
      next(error);
    }
  });

  app.get("/auth/pipedrive/callback", async (request, response, next) => {
    try {
      const state = stringQuery(request.query.state);
      const code = stringQuery(request.query.code);
      if (!state || !code) {
        response.status(400).json({ error: "state and code query parameters are required" });
        return;
      }
      response.json(await pipedriveProvider.completeCallback({ state, code }));
    } catch (error) {
      next(error);
    }
  });

  app.get("/providers/pipedrive/status", async (request, response, next) => {
    try {
      const actor = stringQuery(request.query.actor);
      if (!actor) {
        response.status(400).json({ error: "actor query parameter is required" });
        return;
      }
      response.json(await pipedriveProvider.status(actor));
    } catch (error) {
      next(error);
    }
  });

  app.get("/providers/pipedrive/tools", (_request, response) => {
    response.json({ provider: "pipedrive", tools: pipedriveProvider.listTools() });
  });

  if (options.config.enableComposioProviders) {
    const composioProvider = options.composioProvider ?? createComposioProviderService(options.config);

    app.get("/providers/:provider/connect", async (request, response, next) => {
      try {
        const providerSlug = parseComposioSlug(request.params.provider);
        response.json(await composioProvider.createConnectUrl(providerSlug, {
          actorId: stringQuery(request.query.actorId),
          actorEmail: stringQuery(request.query.actor) ?? ""
        }));
      } catch (error) {
        next(error);
      }
    });

    app.get("/providers/:provider/status", async (request, response, next) => {
      try {
        const providerSlug = parseComposioSlug(request.params.provider);
        const actor = stringQuery(request.query.actor);
        if (!actor) {
          response.status(400).json({ error: "actor query parameter is required" });
          return;
        }
        response.json(await composioProvider.status(providerSlug, actor));
      } catch (error) {
        next(error);
      }
    });

    app.get("/providers/:provider/mcp-url", async (request, response, next) => {
      try {
        const providerSlug = parseComposioSlug(request.params.provider);
        const actor = stringQuery(request.query.actor);
        if (!actor) {
          response.status(400).json({ error: "actor query parameter is required" });
          return;
        }
        response.json(await composioProvider.mcpUrl(providerSlug, actor));
      } catch (error) {
        next(error);
      }
    });

    app.use((error: unknown, _request: express.Request, response: express.Response, next: express.NextFunction) => {
      if (error instanceof Error && (error as Error & { status?: number }).status) {
        response.status((error as Error & { status: number }).status).json({ error: error.message });
        return;
      }
      next(error);
    });
  }

  return app;
}

function stringQuery(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function parseComposioSlug(value: string): ComposioGatewayProvider {
  if (value === "microsoft-composio" || value === "google-composio") return value;
  const err = new Error(`Unknown composio provider slug: ${value}`);
  (err as Error & { status?: number }).status = 400;
  throw err;
}
