import { Command } from "commander";
import { loadConfig as loadGatewayConfig, type GatewayConfig } from "./config.js";
import { createProviderRegistry } from "./providers/registry.js";
import type { GatewayProviderDefinition, ProviderRegistry } from "./providers/types.js";

export interface CliIo {
  write(line: string): void;
  writeError?(line: string): void;
}

export interface CliOptions extends CliIo {
  loadConfig?: () => GatewayConfig;
  providers?: GatewayProviderDefinition[] | ProviderRegistry;
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
    const registry = getProviderRegistry(options.providers);
    const providers = registry.list();
    if (providers.length === 0) {
      options.write("No providers configured");
      return;
    }
    for (const provider of providers) {
      options.write(`${provider.slug}: ${provider.name} (${provider.mcpPath})`);
    }
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

function getProviderRegistry(providers: CliOptions["providers"]): ProviderRegistry {
  if (!providers) {
    return createProviderRegistry([]);
  }
  if (Array.isArray(providers)) {
    return createProviderRegistry(providers);
  }
  return providers;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.split("\n")[0] ?? "Unknown error";
  }
  return String(error);
}

if (process.argv[1]?.endsWith("cli.ts") || process.argv[1]?.endsWith("cli.js")) {
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
