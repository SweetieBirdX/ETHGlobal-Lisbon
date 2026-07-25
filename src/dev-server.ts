import "dotenv/config";
import { createSellerApp, SELLER_PORT } from "./a2a/seller-server.js";
import { startX402Server } from "./x402/server.js";
import { startWebServer, WEB_PORT } from "./web/server.js";

/**
 * Everything the demo needs, in one process.
 *
 * Running the three servers together is not just convenience: the policy the
 * owner saves in the panel is held in memory by the seller agent, so the panel
 * and the agent have to *be* the same process for a saved policy to change what
 * the agent does. Started separately, the panel would only be talking to itself.
 *
 *   npm run dev
 */

const servers = [
  createSellerApp().listen(SELLER_PORT, () =>
    console.log(`Seller agent   http://localhost:${SELLER_PORT}`),
  ),
  startX402Server(),
  startWebServer(),
];

console.log(`\nOpen the demo panel: http://localhost:${WEB_PORT}\n`);

function shutdown(signal: string): void {
  console.log(`\n${signal} — shutting down`);
  for (const server of servers) server.close();
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
