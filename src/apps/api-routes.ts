import express from "express";
import type { NextFunction, Request, Response } from "express";
import type { GatewayAccessStore } from "../access/store.js";
import type { GatewayApiScope } from "../access/types.js";
import { scopeAllowed } from "../access/types.js";
import type { GatewayConnectionBackend } from "../admin/types.js";
import { gatewayApiAuth, gatewayApiRequestPath } from "../api/auth.js";
import { GatewayApiError, sendGatewayApiError } from "../api/errors.js";
import type { GatewayShopifyStore } from "../shopify-oauth/store.js";
import { BUILT_IN_APPS } from "./catalog.js";
import type { GatewayAppInstallStatus } from "./types.js";
import { GatewayAppInstallStore } from "./store.js";

export interface CreateAppApiRouterOptions {
  appInstallStore: GatewayAppInstallStore;
  shopifyStore?: GatewayShopifyStore;
  backend: GatewayConnectionBackend;
  accessStore: GatewayAccessStore;
}

const VALID_STATUSES: GatewayAppInstallStatus[] = ["pending", "enabled", "disabled", "error"];
const BUILT_IN_APP_SLUGS = new Set(BUILT_IN_APPS.map((app) => app.slug));

type AppApiReadHandler = (req: Request) => Promise<unknown> | unknown;

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

function assertAppApiScope(req: Request, accessStore: GatewayAccessStore, requiredScope?: GatewayApiScope): void {
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

function appApiRead(
  accessStore: GatewayAccessStore,
  requiredScope: GatewayApiScope,
  handler: AppApiReadHandler,
  successStatusCode = 200
) {
  return [
    gatewayApiAuth(accessStore, requiredScope),
    async (req: Request, res: Response, next: NextFunction) => {
      const startedAt = Date.now();
      try {
        assertAppApiScope(req, accessStore, requiredScope);
        const body = await handler(req);
        recordApiRead(accessStore, req, successStatusCode, readDurationMs(startedAt), true);
        res.status(successStatusCode).json(body);
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

export function createAppApiRouter(options: CreateAppApiRouterOptions): express.Router {
  const { appInstallStore, shopifyStore, backend, accessStore } = options;
  const router = express.Router();

  // GET /apps — list built-in app manifests
  router.get(
    "/apps",
    ...appApiRead(accessStore, "apps.read", () => ({ apps: BUILT_IN_APPS }))
  );

  // GET /app-installs — list installs with optional filters
  router.get(
    "/app-installs",
    ...appApiRead(accessStore, "apps.read", (req) => {
      const { appSlug, brandId, regionId, status } = req.query;
      const filter: {
        appSlug?: string;
        brandId?: string;
        regionId?: string;
        status?: GatewayAppInstallStatus;
      } = {};
      if (typeof appSlug === "string") filter.appSlug = appSlug;
      if (typeof brandId === "string") filter.brandId = brandId;
      if (typeof regionId === "string") filter.regionId = regionId;
      if (typeof status === "string" && VALID_STATUSES.includes(status as GatewayAppInstallStatus)) {
        filter.status = status as GatewayAppInstallStatus;
      }
      const installs = appInstallStore.listInstalls(Object.keys(filter).length > 0 ? filter : undefined);
      return { installs };
    })
  );

  // GET /app-installs/:id — get single install
  router.get(
    "/app-installs/:id",
    ...appApiRead(accessStore, "apps.read", (req) => {
      const install = appInstallStore.getInstall(req.params.id);
      if (install === undefined) {
        throw new GatewayApiError(404, "not_found", `App install not found: ${req.params.id}`);
      }
      return { install };
    })
  );

  // POST /app-installs — create a new install
  router.post(
    "/app-installs",
    express.json(),
    ...appApiRead(
      accessStore,
      "apps.write",
      (req) => {
        const body = req.body as Record<string, unknown>;
        const appSlug = typeof body.appSlug === "string" ? body.appSlug : undefined;
        const brandId = typeof body.brandId === "string" ? body.brandId : undefined;
        const regionId = typeof body.regionId === "string" ? body.regionId : undefined;
        const connectionId = typeof body.connectionId === "string" ? body.connectionId : undefined;

        if (!appSlug || !brandId || !regionId) {
          throw new GatewayApiError(400, "invalid_request", "appSlug, brandId, and regionId are required");
        }
        if (!BUILT_IN_APP_SLUGS.has(appSlug)) {
          throw new GatewayApiError(400, "invalid_request", `Unknown app slug: ${appSlug}`);
        }

        const install = appInstallStore.createInstall({ appSlug, brandId, regionId, connectionId, status: "pending" });
        return { install };
      },
      201
    )
  );

  // PATCH /app-installs/:id/status — update install status
  router.patch(
    "/app-installs/:id/status",
    express.json(),
    ...appApiRead(accessStore, "apps.write", (req) => {
      const body = req.body as Record<string, unknown>;
      const status = typeof body.status === "string" ? body.status : undefined;
      const errorDetail = typeof body.errorDetail === "string" ? body.errorDetail : undefined;

      if (!status) {
        throw new GatewayApiError(400, "invalid_request", "status is required");
      }
      if (!VALID_STATUSES.includes(status as GatewayAppInstallStatus)) {
        throw new GatewayApiError(
          400,
          "invalid_request",
          `Invalid status: ${status}. Must be one of: ${VALID_STATUSES.join(", ")}`
        );
      }

      const existing = appInstallStore.getInstall(req.params.id);
      if (existing === undefined) {
        throw new GatewayApiError(404, "not_found", `App install not found: ${req.params.id}`);
      }

      appInstallStore.updateInstallStatus(req.params.id, status as GatewayAppInstallStatus, errorDetail);
      const updated = appInstallStore.getInstall(req.params.id);
      return { install: updated };
    })
  );

  // POST /app-installs/provision — auto-provision haverford-storefront installs from connected Shopify credentials
  router.post(
    "/app-installs/provision",
    express.json(),
    ...appApiRead(accessStore, "apps.write", async () => {
      if (shopifyStore === undefined) {
        return { provisioned: 0, installs: [] };
      }

      const credentials = shopifyStore.listCredentials().filter((cred) => cred.status === "connected");
      if (credentials.length === 0) {
        return { provisioned: 0, installs: [] };
      }

      const state = await backend.snapshot();
      const shopifyConnections = state.connections.filter((conn) => conn.connectorId === "connector_shopify");

      const createdInstalls = [];
      for (const credential of credentials) {
        const matchingConnections = shopifyConnections.filter(
          (conn) => conn.configSummary.shop_domain === credential.shop
        );
        for (const conn of matchingConnections) {
          const install = appInstallStore.createInstall({
            appSlug: "haverford-storefront",
            brandId: conn.brandId,
            regionId: conn.regionId,
            connectionId: credential.id,
            status: "pending"
          });
          createdInstalls.push(install);
        }
      }

      return { provisioned: createdInstalls.length, installs: createdInstalls };
    })
  );

  router.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
    sendGatewayApiError(res, error);
  });

  return router;
}
