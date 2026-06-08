import express from "express";
import type { NextFunction, Request, Response } from "express";
import type { ApiClient } from "../admin/types.js";
import { normalizeImportApps, validateAppImportManifest } from "../access/app-import.js";
import type { GatewayAccessStore } from "../access/store.js";
import type { GatewayApiScope } from "../access/types.js";
import { scopeAllowed } from "../access/types.js";
import { contextFromState } from "../mcp-v1/connection-auth.js";
import type { GatewayConnectionBackend, GatewayState } from "../admin/types.js";
import { createAppApiRouter } from "../apps/api-routes.js";
import type { GatewayAppInstallStore } from "../apps/store.js";
import type { ConnectorAdapterRegistry } from "../connectors/registry.js";
import type { GatewayShopifyStore } from "../shopify-oauth/store.js";
import { AccessStoreError } from "../access/store.js";
import { gatewayApiAuth, gatewayApiRequestPath } from "./auth.js";
import { GatewayApiError, sendGatewayApiError } from "./errors.js";
import { toGatewayApiResources } from "./resources.js";

export interface CreateGatewayApiRouterOptions {
  backend: GatewayConnectionBackend;
  accessStore: GatewayAccessStore;
  appInstallStore?: GatewayAppInstallStore;
  shopifyStore?: GatewayShopifyStore;
  connectorRegistry?: ConnectorAdapterRegistry;
  mcpConnectionBaseUrl?: string;
}

type GatewayApiReadHandler = (req: Request) => Promise<unknown> | unknown;
interface GatewayApiHandlerResponse {
  statusCode: number;
  body: unknown;
}

function notFound(entityName: string, entityId: string): GatewayApiError {
  return new GatewayApiError(404, "not_found", `${entityName} not found: ${entityId}`);
}

function readDurationMs(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}

function recordApiRead(
  accessStore: GatewayAccessStore,
  req: Request,
  statusCode: number,
  durationMs: number,
  succeeded: boolean
): void {
  const authenticated = req.gatewayApiAuth;
  if (authenticated === undefined) {
    return;
  }

  const requiredScope = req.gatewayApiRequiredScope;
  const route = gatewayApiRequestPath(req);
  accessStore.recordUsage({
    clientId: authenticated.client.id,
    keyId: authenticated.key.id,
    route,
    method: req.method,
    statusCode,
    scope: requiredScope,
    durationMs
  });
  accessStore.writeAccessAudit({
    action: succeeded ? "api_read.succeeded" : "api_read.failed",
    targetType: "api_client",
    targetId: authenticated.client.id,
    detail: `${succeeded ? "Read" : "Failed read"} ${req.method} ${route}`,
    actor: authenticated.client.id,
    metadata: {
      route,
      method: req.method,
      statusCode: String(statusCode),
      requiredScope: requiredScope ?? "",
      durationMs: String(durationMs),
      fingerprint: authenticated.key.fingerprint
    }
  });
}

function isGatewayApiHandlerResponse(value: unknown): value is GatewayApiHandlerResponse {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as { statusCode?: unknown }).statusCode === "number" &&
    Object.prototype.hasOwnProperty.call(value, "body")
  );
}

function assertGatewayApiScope(req: Request, accessStore: GatewayAccessStore, requiredScope?: GatewayApiScope): void {
  const authenticated = req.gatewayApiAuth;
  if (authenticated === undefined) {
    throw new GatewayApiError(401, "unauthorized", "Missing bearer token");
  }
  if (requiredScope === undefined || scopeAllowed(authenticated.client.scopes, requiredScope)) {
    return;
  }

  accessStore.writeAccessAudit({
    action: "api_scope.denied",
    targetType: "api_client",
    targetId: authenticated.client.id,
    detail: `Missing required scope: ${requiredScope}`,
    actor: authenticated.client.id,
    metadata: {
      route: gatewayApiRequestPath(req),
      method: req.method,
      fingerprint: authenticated.key.fingerprint,
      requiredScope
    }
  });
  throw new GatewayApiError(403, "forbidden", `Missing required scope: ${requiredScope}`);
}

function gatewayApiRead(
  accessStore: GatewayAccessStore,
  requiredScope: GatewayApiScope | undefined,
  handler: GatewayApiReadHandler
) {
  return [
    gatewayApiAuth(accessStore, requiredScope),
    async (req: Request, res: Response, next: NextFunction) => {
      const startedAt = Date.now();
      try {
        assertGatewayApiScope(req, accessStore, requiredScope);
        const result = await handler(req);
        const statusCode = isGatewayApiHandlerResponse(result) ? result.statusCode : 200;
        const body = isGatewayApiHandlerResponse(result) ? result.body : result;
        recordApiRead(accessStore, req, statusCode, readDurationMs(startedAt), true);
        res.status(statusCode).json(body);
      } catch (error) {
        const statusCode = error instanceof GatewayApiError ? error.statusCode : 500;
        try {
          recordApiRead(accessStore, req, statusCode, readDurationMs(startedAt), false);
        } catch (recordError) {
          next(recordError);
          return;
        }
        next(error);
      }
    }
  ];
}

function gatewayApiWrite(
  accessStore: GatewayAccessStore,
  requiredScope: GatewayApiScope,
  handler: GatewayApiReadHandler
) {
  return gatewayApiRead(accessStore, requiredScope, handler);
}

async function gatewayApiResources(backend: GatewayConnectionBackend) {
  return toGatewayApiResources(await backend.snapshot());
}

async function gatewayState(backend: GatewayConnectionBackend): Promise<GatewayState> {
  return backend.snapshot();
}

export function createGatewayApiRouter({
  backend,
  accessStore,
  appInstallStore,
  shopifyStore,
  connectorRegistry,
  mcpConnectionBaseUrl
}: CreateGatewayApiRouterOptions): express.Router {
  const router = express.Router();
  router.use(express.json({ limit: "1mb" }));

  // Mount app routes when an appInstallStore is provided
  if (appInstallStore !== undefined) {
    router.use(createAppApiRouter({ appInstallStore, shopifyStore, backend, accessStore }));
  }

  router.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", version: "v1" });
  });

  router.get(
    "/me",
    ...gatewayApiRead(accessStore, undefined, (req) => {
      const authenticated = req.gatewayApiAuth;
      if (authenticated === undefined) {
        throw new GatewayApiError(401, "unauthorized", "Missing bearer token");
      }
      return { client: authenticated.client, key: authenticated.key };
    })
  );

  router.get(
    "/brands",
    ...gatewayApiRead(accessStore, "brands.read", async () => ({ brands: (await gatewayApiResources(backend)).brands }))
  );

  router.get(
    "/brands/:brandId",
    ...gatewayApiRead(accessStore, "brands.read", async (req) => {
      const resources = await gatewayApiResources(backend);
      const brand = resources.brands.find((candidate) => candidate.id === req.params.brandId);
      if (brand === undefined) {
        throw notFound("Brand", req.params.brandId);
      }
      return { brand };
    })
  );

  router.get(
    "/brands/:brandId/regions",
    ...gatewayApiRead(accessStore, "regions.read", async (req) => {
      const state = await gatewayState(backend);
      if (!state.brands.some((brand) => brand.id === req.params.brandId)) {
        throw notFound("Brand", req.params.brandId);
      }
      return { regions: state.regions.filter((region) => region.brandId === req.params.brandId) };
    })
  );

  router.get(
    "/regions/:regionId",
    ...gatewayApiRead(accessStore, "regions.read", async (req) => {
      const state = await gatewayState(backend);
      const region = state.regions.find((candidate) => candidate.id === req.params.regionId);
      if (region === undefined) {
        throw notFound("Region", req.params.regionId);
      }
      return { region };
    })
  );

  router.get(
    "/regions/:regionId/connections",
    ...gatewayApiRead(accessStore, "connections.read", async (req) => {
      const state = await gatewayState(backend);
      if (!state.regions.some((region) => region.id === req.params.regionId)) {
        throw notFound("Region", req.params.regionId);
      }
      const resources = toGatewayApiResources(state);
      return { connections: resources.connections.filter((connection) => connection.regionId === req.params.regionId) };
    })
  );

  router.get(
    "/connectors",
    ...gatewayApiRead(accessStore, "connectors.read", async () => ({
      connectors: (await gatewayApiResources(backend)).connectors
    }))
  );

  router.get(
    "/connectors/:connectorId",
    ...gatewayApiRead(accessStore, "connectors.read", async (req) => {
      const resources = await gatewayApiResources(backend);
      const connector = resources.connectors.find((candidate) => candidate.id === req.params.connectorId);
      if (connector === undefined) {
        throw notFound("Connector", req.params.connectorId);
      }
      return { connector };
    })
  );

  if (connectorRegistry !== undefined) {
    router.get(
      "/connectors/:slug/capabilities",
      ...gatewayApiRead(accessStore, "connectors.read", (req) => {
        const { slug } = req.params;
        const adapter = connectorRegistry.resolve(slug);
        if (adapter === undefined) {
          throw new GatewayApiError(404, "not_found", `No adapter registered for connector: ${slug}`);
        }
        const status = adapter.getStatus();
        return {
          connectorSlug: slug,
          adapter: {
            slug: adapter.info.slug,
            backendType: adapter.info.backendType,
            status
          },
          capabilities: status === "unconfigured" ? [] : adapter.listCapabilities(slug)
        };
      })
    );
  }

  router.get(
    "/connections",
    ...gatewayApiRead(accessStore, "connections.read", async () => ({
      connections: (await gatewayApiResources(backend)).connections
    }))
  );

  router.get(
    "/connections/:connectionId",
    ...gatewayApiRead(accessStore, "connections.read", async (req) => {
      const resources = await gatewayApiResources(backend);
      const connection = resources.connections.find((candidate) => candidate.id === req.params.connectionId);
      if (connection === undefined) {
        throw notFound("Connection", req.params.connectionId);
      }
      return { connection };
    })
  );

  router.post(
    "/connections/:connectionId/mcp-tokens",
    ...gatewayApiWrite(accessStore, "api_clients.write", async (req) => {
      const state = await gatewayState(backend);
      const context = contextFromState(state, req.params.connectionId);
      if (context === undefined) {
        throw notFound("Connection", req.params.connectionId);
      }
      const connection = state.connections.find((candidate) => candidate.id === req.params.connectionId);
      if (connection?.status !== "connected") {
        throw new GatewayApiError(403, "forbidden", `Connection is unavailable: ${req.params.connectionId}`);
      }
      const label = requestLabel(req.body);
      try {
        return accessStore.mintConnectionToken({
          connectionId: req.params.connectionId,
          context,
          label,
          actor: req.gatewayApiAuth?.client.id ?? "api-client",
          mcpConnectionBaseUrl
        });
      } catch (err) {
        throw storeErrorToApiError(err);
      }
    })
  );

  router.get(
    "/connections/:connectionId/mcp-tokens",
    ...gatewayApiRead(accessStore, "api_clients.read", async (req) => {
      const state = await gatewayState(backend);
      if (contextFromState(state, req.params.connectionId) === undefined) {
        throw notFound("Connection", req.params.connectionId);
      }
      return { tokens: accessStore.listConnectionTokens(req.params.connectionId) };
    })
  );

  router.post(
    "/connections/:connectionId/mcp-tokens/:tokenId/rotate",
    ...gatewayApiWrite(accessStore, "api_clients.write", async (req) => {
      try {
        return accessStore.rotateConnectionToken(
          req.params.connectionId,
          req.params.tokenId,
          req.gatewayApiAuth?.client.id ?? "api-client",
          mcpConnectionBaseUrl
        );
      } catch (err) {
        throw storeErrorToApiError(err);
      }
    })
  );

  router.delete(
    "/connections/:connectionId/mcp-tokens/:tokenId",
    ...gatewayApiWrite(accessStore, "api_clients.write", async (req) => {
      try {
        return { token: accessStore.revokeConnectionToken(
          req.params.connectionId,
          req.params.tokenId,
          req.gatewayApiAuth?.client.id ?? "api-client"
        )};
      } catch (err) {
        throw storeErrorToApiError(err);
      }
    })
  );

  router.post(
    "/api-clients/import",
    ...gatewayApiWrite(accessStore, "api_clients.write", async (req) => {
      let manifest;
      try {
        manifest = validateAppImportManifest(req.body);
      } catch (err) {
        throw new GatewayApiError(400, "invalid_request", err instanceof Error ? err.message : String(err));
      }

      const today = new Date().toISOString().slice(0, 10);
      const apps = normalizeImportApps(manifest, today);
      const imported = [];
      const skipped = [];
      const rotate = importRotate(req.body);
      const actor = req.gatewayApiAuth?.client.id ?? "api-client";

      for (const app of apps) {
        const existingByOwner = findImportClient(accessStore.listApiClients(), app.manifestKey);
        const activeExisting = existingByOwner?.status === "active" ? existingByOwner : undefined;
        if (activeExisting === undefined && (existingByOwner === undefined || !rotate)) {
          try {
            const client = accessStore.createClient({ ...app.client, owner: `dev-api:${app.manifestKey}` }, actor);
            const created = accessStore.createKey(client.id, { label: app.keyLabel }, actor);
            imported.push({
              manifestKey: app.manifestKey,
              client,
              key: created.key,
              secret: created.secret,
              action: "created"
            });
          } catch (err) {
            throw storeErrorToApiError(err);
          }
          continue;
        }

        if (!rotate) {
          skipped.push({ manifestKey: app.manifestKey, reason: "exists" });
          continue;
        }

        try {
          const existing = existingByOwner ?? activeExisting;
          if (existing === undefined) {
            throw new AccessStoreError(404, `API client not found for manifest key: ${app.manifestKey}`);
          }
          const created = accessStore.createKey(existing.id, { label: uniqueImportKeyLabel(app.keyLabel, existing) }, actor);
          imported.push({
            manifestKey: app.manifestKey,
            client: existing,
            key: created.key,
            secret: created.secret,
            action: "rotated"
          });
        } catch (err) {
          throw storeErrorToApiError(err);
        }
      }

      return { statusCode: 201, body: { imported, skipped } };
    })
  );

  router.get(
    "/api-clients",
    ...gatewayApiRead(accessStore, "api_clients.read", (req) => {
      const ownerPrefix = typeof req.query.owner_prefix === "string" ? req.query.owner_prefix : undefined;
      const apiClients = accessStore
        .listApiClients()
        .filter((client) => ownerPrefix === undefined || client.owner.startsWith(ownerPrefix));
      return { apiClients };
    })
  );

  router.use(
    "*",
    ...gatewayApiRead(accessStore, undefined, (req) => {
      throw new GatewayApiError(
        404,
        "not_found",
        `Gateway API route not found: ${req.method} ${gatewayApiRequestPath(req)}`
      );
    })
  );

  router.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
    sendGatewayApiError(res, error);
  });

  return router;
}

// Translate AccessStoreError (409 conflict, 404 not-found) to GatewayApiError
// so token-management endpoints surface correct HTTP status codes.
function storeErrorToApiError(err: unknown): Error {
  if (err instanceof AccessStoreError) {
    return new GatewayApiError(err.statusCode, err.statusCode === 409 ? "invalid_request" : "not_found", err.message);
  }
  return err instanceof Error ? err : new Error(String(err));
}

function importRotate(body: unknown): boolean {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return false;
  }
  return (body as { rotate?: unknown }).rotate === true;
}

function findImportClient(apiClients: ApiClient[], manifestKey: string): ApiClient | undefined {
  return apiClients.find((client) => client.owner === `dev-api:${manifestKey}`);
}

function uniqueImportKeyLabel(baseLabel: string, client: ApiClient): string {
  const activeLabels = new Set(client.keys.filter((key) => key.status === "active").map((key) => key.label));
  if (!activeLabels.has(baseLabel)) {
    return baseLabel;
  }
  let suffix = 2;
  while (activeLabels.has(`${baseLabel}-${suffix}`)) {
    suffix += 1;
  }
  return `${baseLabel}-${suffix}`;
}

function requestLabel(body: unknown): string {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new GatewayApiError(400, "invalid_request", "Request body must be an object");
  }
  const label = (body as { label?: unknown }).label;
  if (typeof label !== "string" || label.trim() === "") {
    throw new GatewayApiError(400, "invalid_request", "label is required");
  }
  return label.trim();
}
