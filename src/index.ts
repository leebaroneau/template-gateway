import express from "express";
import type { Request, Response } from "express";
import { loadConfig } from "./config.js";
import { actorContext, bearerAuth } from "./auth.js";
import { SessionCache } from "./session-cache.js";
import { forwardJsonRpc, makeComposioSessionFactory } from "./mcp-proxy.js";

export function createApp(config = loadConfig()) {
  const factory = makeComposioSessionFactory({
    composioApiKey: config.composioApiKey,
    composioProjectId: config.composioProjectId,
    toolkitAllowlist: config.toolkitAllowlist
  });
  const cache = new SessionCache(factory, { ttlSeconds: config.sessionTtlSeconds });
  const app = express();
  app.disable("x-powered-by");

  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      brand: config.brandSlug,
      cachedSessions: cache.size(),
      toolkitAllowlist: config.toolkitAllowlist ?? "<all toolkits the API key can see>"
    });
  });

  const mcpRouter = express.Router();
  mcpRouter.use(express.json({ limit: "1mb" }));
  mcpRouter.use(bearerAuth(config.gatewayBearer));
  mcpRouter.use(actorContext(config.brandSlug));

  const mcpHandler = (req: Request, res: Response) => forwardJsonRpc(req, res, { cache });
  mcpRouter.post("/", mcpHandler);
  mcpRouter.delete("/", mcpHandler);

  // GET is SSE in MCP streamable HTTP. Composio Tool Router decides whether to
  // upgrade; we forward as-is. forwardJsonRpc handles the empty body for GET.
  mcpRouter.get("/", mcpHandler);

  app.use("/mcp", mcpRouter);

  app.use((err: Error, _req: Request, res: Response, _next: express.NextFunction) => {
    // eslint-disable-next-line no-console
    console.error("[gateway] unhandled error:", err);
    res.status(500).json({ error: "internal gateway error", detail: err.message });
  });

  return app;
}

function main() {
  const config = loadConfig();
  const app = createApp(config);
  app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(
      `[gateway] brand=${config.brandSlug} listening on :${config.port} (TTL ${config.sessionTtlSeconds}s)`
    );
  });
}

if (process.argv[1] && process.argv[1].endsWith("index.js")) {
  main();
}
