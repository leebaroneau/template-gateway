import express from "express";
import type { Request, Response } from "express";
import type { GatewayAccessStore } from "../access/store.js";
import type { GatewayAppInstallStore } from "../apps/store.js";
import { statusCodeForAdminError } from "./backend-error.js";
import { adminClientScript } from "./client-script.js";
import { FixtureGatewayBackend } from "./fixture-backend.js";
import { renderAdminPage } from "./page.js";
import { adminStyles } from "./styles.js";
import type { AuditEvent, GatewayConnectionBackend, GatewayEntityType, GatewayState } from "./types.js";

const ACCESS_STORE_NOT_CONFIGURED = "Gateway access store is not configured";
const ACTOR_HEADER_FALLBACKS = ["x-auth-gate-email", "x-forwarded-email", "x-user-email"] as const;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requestBodyObject(body: unknown): Record<string, any> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Request body must be an object");
  }
  return body as Record<string, any>;
}

function configSummaryFromBody(body: any): Record<string, unknown> | undefined {
  if (!Object.prototype.hasOwnProperty.call(body ?? {}, "configSummary")) {
    return undefined;
  }
  const value = body.configSummary;
  if (value === undefined) {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("configSummary must be an object");
  }
  return value;
}

function sendError(res: Response, error: unknown): void {
  res.status(statusCodeForAdminError(error)).json({ error: errorMessage(error) });
}

function noStore(res: Response): void {
  res.set("Cache-Control", "no-store");
}

function firstNonEmptyHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value.map((candidate) => candidate.trim()).find((candidate) => candidate.length > 0);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  return undefined;
}

function actorFromRequest(req: Request): string {
  for (const header of ACTOR_HEADER_FALLBACKS) {
    const actor = firstNonEmptyHeader(req.headers[header]);
    if (actor !== undefined) {
      return actor;
    }
  }
  return "local-admin";
}

function accessStoreNotConfigured(): Error & { statusCode: number } {
  const error = new Error(ACCESS_STORE_NOT_CONFIGURED) as Error & { statusCode: number };
  error.statusCode = 503;
  return error;
}

function requireAccessStore(accessStore: GatewayAccessStore | undefined): GatewayAccessStore {
  if (!accessStore) {
    throw accessStoreNotConfigured();
  }
  return accessStore;
}

function sortAuditEventsNewestFirst(events: AuditEvent[]): AuditEvent[] {
  return [...events].sort((left, right) => {
    const leftTimestamp = Date.parse(left.timestamp);
    const rightTimestamp = Date.parse(right.timestamp);
    if (!Number.isFinite(leftTimestamp) || !Number.isFinite(rightTimestamp)) {
      return 0;
    }
    return rightTimestamp - leftTimestamp;
  });
}

function dedupeAuditEventsById(events: AuditEvent[]): AuditEvent[] {
  const seen = new Set<string>();
  return events.filter((event) => {
    if (seen.has(event.id)) {
      return false;
    }
    seen.add(event.id);
    return true;
  });
}

function entityTypeFromParam(value: string): GatewayEntityType {
  if (value === "brand" || value === "region" || value === "connection") {
    return value;
  }
  throw new Error(`Invalid entity type: ${value}`);
}

export function createAdminRouter(
  backend: GatewayConnectionBackend = new FixtureGatewayBackend(),
  accessStore?: GatewayAccessStore,
  appInstallStore?: GatewayAppInstallStore
): express.Router {
  const router = express.Router();

  async function snapshotForResponse(state?: GatewayState): Promise<GatewayState> {
    const backendState = state ?? (await backend.snapshot());
    if (!accessStore) {
      return backendState;
    }
    return {
      ...backendState,
      apiClients: accessStore.listApiClients(),
      auditEvents: dedupeAuditEventsById(
        sortAuditEventsNewestFirst([...accessStore.listAuditEvents(), ...backendState.auditEvents])
      )
    };
  }

  router.use(express.json({ limit: "256kb", strict: false }));

  router.get("/", (_req: Request, res: Response) => {
    noStore(res);
    res.type("html").send(renderAdminPage());
  });

  router.get("/style.css", (_req: Request, res: Response) => {
    noStore(res);
    res.type("text/css").send(adminStyles);
  });

  router.get("/app.js", (_req: Request, res: Response) => {
    noStore(res);
    res.type("application/javascript").send(adminClientScript);
  });

  router.get("/api/state", async (_req: Request, res: Response) => {
    try {
      noStore(res);
      res.json(await snapshotForResponse());
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/api/brands", async (req: Request, res: Response) => {
    try {
      const body = req.body as any;
      const brand = await backend.createBrand({ name: body?.name, slug: body?.slug });
      res.status(201).json({ brand, state: await snapshotForResponse() });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.patch("/api/brands/:brandId", async (req: Request, res: Response) => {
    try {
      const body = requestBodyObject(req.body);
      const brand = await backend.updateBrand(req.params.brandId, {
        name: body?.name,
        slug: body?.slug,
        status: body?.status
      });
      res.json({ brand, state: await snapshotForResponse() });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/api/brands/:brandId/regions", async (req: Request, res: Response) => {
    try {
      const body = req.body as any;
      const region = await backend.createRegion({
        brandId: req.params.brandId,
        code: body?.code,
        name: body?.name,
        domain: body?.domain
      });
      res.status(201).json({ region, state: await snapshotForResponse() });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.patch("/api/regions/:regionId", async (req: Request, res: Response) => {
    try {
      const body = requestBodyObject(req.body);
      const region = await backend.updateRegion(req.params.regionId, {
        code: body?.code,
        name: body?.name,
        domain: body?.domain,
        status: body?.status
      });
      res.json({ region, state: await snapshotForResponse() });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/api/regions/:regionId/connections", async (req: Request, res: Response) => {
    try {
      const body = req.body as any;
      const connection = await backend.createConnection({
        brandId: body?.brandId,
        regionId: req.params.regionId,
        connectorId: body?.connectorId,
        backendType: body?.backendType,
        displayName: body?.displayName,
        configSummary: configSummaryFromBody(body)
      });
      res.status(201).json({ connection, state: await snapshotForResponse() });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.patch("/api/connections/:connectionId", async (req: Request, res: Response) => {
    try {
      const body = requestBodyObject(req.body);
      const connection = await backend.updateConnection(req.params.connectionId, {
        backendType: body?.backendType,
        displayName: body?.displayName,
        status: body?.status,
        configSummary: configSummaryFromBody(body),
        lastError: body?.lastError
      });
      res.json({ connection, state: await snapshotForResponse() });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/api/connections/:connectionId/test", async (req: Request, res: Response) => {
    try {
      const connection = await backend.testConnection(req.params.connectionId);
      res.json({ connection, state: await snapshotForResponse() });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/api/entities/:entityType/:entityId/reset", async (req: Request, res: Response) => {
    try {
      const state = await backend.resetEntity({
        entityType: entityTypeFromParam(req.params.entityType),
        entityId: req.params.entityId
      });
      res.json({ state: await snapshotForResponse(state) });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/api/entities/reset", async (req: Request, res: Response) => {
    try {
      const body = requestBodyObject(req.body);
      const state = await backend.resetEntity({ entityType: body.entityType, entityId: body.entityId });
      res.json({ state: await snapshotForResponse(state) });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/api/connectors/all", async (_req: Request, res: Response) => {
    try {
      const store = requireAccessStore(accessStore);
      // Return all connectors (from the full merged catalog) with their enabled status.
      // The snapshot only includes enabled connectors; this endpoint shows the full library.
      const { mapDevApiBrandsToGatewayState } = await import("./dev-api-mapper.js");
      const allConnectors = mapDevApiBrandsToGatewayState({ brands: [] }).connectors;
      const disabledIds = new Set(store.listDisabledConnectors());
      res.json({
        connectors: allConnectors.map((c) => ({ ...c, enabled: !disabledIds.has(c.id) }))
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/api/connectors/:connectorId/toggle", async (req: Request, res: Response) => {
    try {
      const store = requireAccessStore(accessStore);
      const { connectorId } = req.params;
      const body = requestBodyObject(req.body);
      const enabled = body.enabled === true || body.enabled === 1;
      store.setConnectorEnabled(connectorId, enabled);
      const state = await snapshotForResponse();
      res.json({ state });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/api/api-clients", async (req: Request, res: Response) => {
    try {
      const store = requireAccessStore(accessStore);
      const body = requestBodyObject(req.body);
      const client = store.createClient(
        {
          name: body.name,
          type: body.type,
          owner: body.owner,
          scopes: body.scopes
        },
        actorFromRequest(req)
      );
      res.status(201).json({ client, state: await snapshotForResponse() });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.patch("/api/api-clients/:clientId", async (req: Request, res: Response) => {
    try {
      const store = requireAccessStore(accessStore);
      const body = requestBodyObject(req.body);
      const client = store.updateClient(
        req.params.clientId,
        {
          name: body.name,
          type: body.type,
          owner: body.owner,
          scopes: body.scopes,
          status: body.status
        },
        actorFromRequest(req)
      );
      res.json({ client, state: await snapshotForResponse() });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/api/api-clients/:clientId/keys", async (req: Request, res: Response) => {
    try {
      const store = requireAccessStore(accessStore);
      const body = requestBodyObject(req.body);
      const { key, secret } = store.createKey(req.params.clientId, { label: body.label }, actorFromRequest(req));
      res.status(201).json({ key, secret, state: await snapshotForResponse() });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/api/api-clients/:clientId/keys/:keyId/rotate", async (req: Request, res: Response) => {
    try {
      if (accessStore) {
        const { key, secret } = accessStore.rotateKey(req.params.clientId, req.params.keyId, actorFromRequest(req));
        res.json({ key, secret, state: await snapshotForResponse() });
        return;
      }

      const key = await backend.rotateApiKey(req.params.clientId, req.params.keyId);
      res.json({ key, state: await snapshotForResponse() });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/api/api-clients/:clientId/keys/:keyId/revoke", async (req: Request, res: Response) => {
    try {
      if (accessStore) {
        const key = accessStore.revokeKey(req.params.clientId, req.params.keyId, actorFromRequest(req));
        res.json({ key, state: await snapshotForResponse() });
        return;
      }

      const key = await backend.revokeApiKey(req.params.clientId, req.params.keyId);
      res.json({ key, state: await snapshotForResponse() });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/api/app-installs", (_req: Request, res: Response) => {
    try {
      noStore(res);
      res.json({ installs: appInstallStore?.listInstalls() ?? [] });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.use((error: Error, _req: Request, res: Response, _next: express.NextFunction) => {
    sendError(res, error);
  });

  return router;
}
