import "dotenv/config";
import { loadConfig } from "./config.js";

const config = loadConfig();

console.log(`template-gateway config loaded for ${config.apiBaseUrl}`);
