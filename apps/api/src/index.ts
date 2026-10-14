import { buildApp } from "./server.js";
import { config } from "@cert/config";
const app = await buildApp();
await app.listen({ port: config.PORT, host: config.HOST });
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
