import "dotenv/config";
import { loadConfig } from "./config.js";
import { createHttpApp } from "./http.js";

const config = loadConfig();
const app = createHttpApp({ config });

app.listen(config.port, () => {
  console.log(`template-gateway listening on ${config.port}`);
});
