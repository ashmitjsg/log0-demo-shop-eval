import { createApp } from "./app.js";
import { close, connect } from "./db.js";
import { error, info } from "./log0.js";
import { seed } from "./seed.js";

const PORT = Number(process.env.PORT) || 8090;

process.on("unhandledRejection", (reason) => {
  error(`unhandled promise rejection: ${reason?.message ?? reason}`, reason instanceof Error ? reason : undefined);
});

const db = await connect();
await seed(db);
const server = createApp(db).listen(PORT, () => info(`storefront-api listening on ${PORT}`));

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    server.close();
    await close();
    process.exit(0);
  });
}
