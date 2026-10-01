// Seed the showcase outline (src/showcase/seed.ts) through a service's socket. scripts/try-it.sh
// --showcase runs it on first start and after --reset; it refuses an outline that already has one.
//   bun scripts/showcase.ts seed <outliner socket> [<the service's XDG_CONFIG_HOME> [<pi-herdr-outliner checkout>]]
// With the config dir, the made-up ticket extension is installed there and a ticket fetched (PIE-445); with
// the checkout too, its example extensions (moon, horoscope, fancy-horror, tarot, tidy; PIE-512).
import { seedShowcase } from "../src/showcase/seed";
import { SocketBoard } from "../src/socket";

const [cmd, sock, ticketsConfig, outliner] = process.argv.slice(2);
if (cmd !== "seed" || !sock) { console.error("usage: bun scripts/showcase.ts seed <outliner socket> [<service config dir>]"); process.exit(2); }
const board = new SocketBoard(sock);
try {
  const info = await board.info();
  const s = await seedShowcase(board, { ...(ticketsConfig ? { ticketsConfig } : {}), ...(outliner ? { outliner } : {}) });
  console.log(`seeded the showcase in ${info.workspace}: ${Object.keys(s.notes).length} notes, ${s.lanes.length} lanes, ${s.cards.length} cards, ${s.chores.length} chores, 2 comment threads`);
} catch (e) {
  console.error(`couldn't seed the showcase: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
} finally { board.close(); }
