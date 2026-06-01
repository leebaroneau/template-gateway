import express from "express";
import type { Request, Response } from "express";
import { adminClientScript } from "./client-script.js";
import { FixtureGatewayBackend } from "./fixture-backend.js";
import { renderAdminPage } from "./page.js";
import { adminStyles } from "./styles.js";
import type { GatewayConnectionBackend } from "./types.js";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
  res.status(400).json({ error: errorMessage(error) });
}

export function createAdminRouter(backend: GatewayConnectionBackend = new FixtureGatewayBackend()): express.Router {
  const router = express.Router();

  router.use(express.json({ limit: "256kb" }));

  router.get("/", (_req: Request, res: Response) => {
    res.type("html").send(renderAdminPage());
  });

  router.get("/style.css", (_req: Request, res: Response) => {
    res.type("text/css").send(adminStyles);
  });

  router.get("/app.js", (_req: Request, res: Response) => {
    res.type("application/javascript").send(adminClientScript);
  });

  router.get("/api/state", (_req: Request, res: Response) => {
    res.json(backend.snapshot());
  });

  router.post("/api/brands", (req: Request, res: Response) => {
    try {
      const body = req.body as any;
      const brand = backend.createBrand({ name: body?.name, slug: body?.slug });
      res.status(201).json({ brand, state: backend.snapshot() });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/api/brands/:brandId/regions", (req: Request, res: Response) => {
    try {
      const body = req.body as any;
      const region = backend.createRegion({
        brandId: req.params.brandId,
        code: body?.code,
        name: body?.name,
        domain: body?.domain
      });
      res.status(201).json({ region, state: backend.snapshot() });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/api/regions/:regionId/connections", (req: Request, res: Response) => {
    try {
      const body = req.body as any;
      const connection = backend.createConnection({
        brandId: body?.brandId,
        regionId: req.params.regionId,
        connectorId: body?.connectorId,
        backendType: body?.backendType,
        displayName: body?.displayName,
        configSummary: configSummaryFromBody(body)
      });
      res.status(201).json({ connection, state: backend.snapshot() });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/api/connections/:connectionId/test", (req: Request, res: Response) => {
    try {
      const connection = backend.testConnection(req.params.connectionId);
      res.json({ connection, state: backend.snapshot() });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/api/api-clients/:clientId/keys/:keyId/rotate", (req: Request, res: Response) => {
    try {
      const key = backend.rotateApiKey(req.params.clientId, req.params.keyId);
      res.json({ key, state: backend.snapshot() });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/api/api-clients/:clientId/keys/:keyId/revoke", (req: Request, res: Response) => {
    try {
      const key = backend.revokeApiKey(req.params.clientId, req.params.keyId);
      res.json({ key, state: backend.snapshot() });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.use((error: Error, _req: Request, res: Response, _next: express.NextFunction) => {
    sendError(res, error);
  });

  return router;
}
