import express from "express";
import type { Request, Response } from "express";
import { statusCodeForAdminError } from "./backend-error.js";
import { adminClientScript } from "./client-script.js";
import { FixtureGatewayBackend } from "./fixture-backend.js";
import { renderAdminPage } from "./page.js";
import { adminStyles } from "./styles.js";
import type { GatewayConnectionBackend } from "./types.js";

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

export function createAdminRouter(backend: GatewayConnectionBackend = new FixtureGatewayBackend()): express.Router {
  const router = express.Router();

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
      res.json(await backend.snapshot());
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/api/brands", async (req: Request, res: Response) => {
    try {
      const body = req.body as any;
      const brand = await backend.createBrand({ name: body?.name, slug: body?.slug });
      res.status(201).json({ brand, state: await backend.snapshot() });
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
      res.json({ brand, state: await backend.snapshot() });
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
      res.status(201).json({ region, state: await backend.snapshot() });
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
      res.json({ region, state: await backend.snapshot() });
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
      res.status(201).json({ connection, state: await backend.snapshot() });
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
      res.json({ connection, state: await backend.snapshot() });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/api/connections/:connectionId/test", async (req: Request, res: Response) => {
    try {
      const connection = await backend.testConnection(req.params.connectionId);
      res.json({ connection, state: await backend.snapshot() });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/api/entities/reset", async (req: Request, res: Response) => {
    try {
      const body = requestBodyObject(req.body);
      const state = await backend.resetEntity({ entityType: body.entityType, entityId: body.entityId });
      res.json({ state });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/api/api-clients/:clientId/keys/:keyId/rotate", async (req: Request, res: Response) => {
    try {
      const key = await backend.rotateApiKey(req.params.clientId, req.params.keyId);
      res.json({ key, state: await backend.snapshot() });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/api/api-clients/:clientId/keys/:keyId/revoke", async (req: Request, res: Response) => {
    try {
      const key = await backend.revokeApiKey(req.params.clientId, req.params.keyId);
      res.json({ key, state: await backend.snapshot() });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.use((error: Error, _req: Request, res: Response, _next: express.NextFunction) => {
    sendError(res, error);
  });

  return router;
}
