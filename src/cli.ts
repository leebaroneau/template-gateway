import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { SessionTokenStore, type StaticServiceToken } from "./auth/session-tokens.js";
import { loadConfig as loadGatewayConfig, type GatewayConfig } from "./config.js";
import { providersFromConfig } from "./providers/defaults.js";
import { createMicrosoftProviderService } from "./providers/microsoft/factory.js";
import type { MicrosoftProviderService } from "./providers/microsoft/service.js";
import { createProviderRegistry } from "./providers/registry.js";
import type { GatewayProviderDefinition, ProviderRegistry } from "./providers/types.js";

export interface CliIo {
  write(line: string): void;
  writeError?(line: string): void;
}

export interface CliOptions extends CliIo {
  loadConfig?: () => GatewayConfig;
  providers?: GatewayProviderDefinition[] | ProviderRegistry;
  sessionStore?: SessionLister;
  microsoftProvider?: Pick<MicrosoftProviderService, "createConnectUrl" | "status">;
}

interface SessionLister {
  listSessions(): Promise<Array<{ email: string; clientId: string; scopes: string[]; createdAt: string }>>;
}

class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliError";
  }
}

export function buildCli(options: CliOptions = { write: (line) => console.log(line) }): Command {
  const writeError = options.writeError ?? ((line: string) => console.error(line));
  const loadConfig = options.loadConfig ?? loadGatewayConfig;
  const program = new Command();
  program.name("template-gateway").description("Operator CLI for template-gateway");

  program.command("doctor").description("Check local gateway configuration").action(() => {
    const config = readConfig(loadConfig, writeError);
    options.write("template-gateway: ok");
    options.write(`apiBaseUrl: ${config.apiBaseUrl}`);
    options.write(`allowedEmailDomains: ${config.allowedEmailDomains.join(",")}`);
  });

  program.command("providers").description("List configured providers").action(() => {
    const registry = getProviderRegistry(options.providers, readConfig(loadConfig, writeError));
    const providers = registry.list();
    if (providers.length === 0) {
      options.write("No providers configured");
      return;
    }
    for (const provider of providers) {
      options.write(`${provider.slug}: ${provider.name} (${provider.mcpPath})`);
    }
  });

  program.command("sessions").description("List active user sessions").action(async () => {
    const store = options.sessionStore ?? createDefaultSessionStore(readConfig(loadConfig, writeError));
    const sessions = await store.listSessions();
    if (sessions.length === 0) {
      options.write("No sessions");
      return;
    }
    for (const session of sessions) {
      options.write(`${session.email}: ${session.clientId} [${session.scopes.join(",")}] ${session.createdAt}`);
    }
  });

  const microsoft = program.command("microsoft").description("Manage Microsoft 365 provider connections");

  microsoft.command("connect")
    .description("Print a Microsoft OAuth login URL for an actor")
    .requiredOption("--actor <email>", "Actor email address")
    .option("--actor-id <id>", "Stable actor id or profile")
    .option("--actor-name <name>", "Display actor name")
    .action(async (commandOptions: { actor: string; actorId?: string; actorName?: string }) => {
      const provider = options.microsoftProvider ?? createMicrosoftProviderService(readConfig(loadConfig, writeError));
      const result = await provider.createConnectUrl({
        actorId: commandOptions.actorId,
        actorEmail: commandOptions.actor,
        actorName: commandOptions.actorName
      });
      options.write(result.authorizeUrl);
    });

  microsoft.command("status")
    .description("Print Microsoft connection status for an actor")
    .requiredOption("--actor <id-or-email>", "Actor id, profile, or email")
    .action(async (commandOptions: { actor: string }) => {
      const provider = options.microsoftProvider ?? createMicrosoftProviderService(readConfig(loadConfig, writeError));
      const status = await provider.status(commandOptions.actor);
      const upstream = status.upstreamLogin ? ` -> ${status.upstreamLogin}` : "";
      const scopes = status.scopes.length > 0 ? ` [${status.scopes.join(",")}]` : " []";
      const expires = status.expiresAt ? ` expires ${status.expiresAt}` : "";
      options.write(`microsoft: ${status.status} ${status.actorId}${upstream}${scopes}${expires}`);
    });

  return program;
}

function readConfig(loadConfig: () => GatewayConfig, writeError: (line: string) => void): GatewayConfig {
  try {
    return loadConfig();
  } catch (error) {
    const message = `Configuration error: ${errorMessage(error)}`;
    writeError(message);
    throw new CliError(message);
  }
}

function getProviderRegistry(providers: CliOptions["providers"], config: GatewayConfig): ProviderRegistry {
  if (!providers) {
    return createProviderRegistry(providersFromConfig(config));
  }
  if (Array.isArray(providers)) {
    return createProviderRegistry(providers);
  }
  return providers;
}

function createDefaultSessionStore(config: GatewayConfig): SessionTokenStore {
  return new SessionTokenStore(config.tokenStorePath, config.allowedEmailDomains, staticServiceTokensFromConfig(config));
}

function staticServiceTokensFromConfig(config: GatewayConfig): StaticServiceToken[] {
  const fallbackEmail = `service-token@${config.allowedEmailDomains[0] ?? "example.com"}`;
  return config.apiBearerTokens.map((binding) => {
    const [token, email, profile] = binding.split(":");
    return {
      token,
      email: email || fallbackEmail,
      profile: profile || undefined
    };
  });
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.split("\n")[0] ?? "Unknown error";
  }
  return String(error);
}

function isMainModule(): boolean {
  const entrypoint = process.argv[1];
  return Boolean(entrypoint && fileURLToPath(import.meta.url) === resolve(entrypoint));
}

if (isMainModule()) {
  await import("dotenv/config");
  try {
    await buildCli().parseAsync(process.argv);
  } catch (error) {
    if (error instanceof CliError) {
      process.exitCode = 1;
    } else {
      throw error;
    }
  }
}
