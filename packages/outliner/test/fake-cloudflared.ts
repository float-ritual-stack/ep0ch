// A stand-in for cloudflared in tests (never the real one): `tunnel --url <origin> [--allowed-mail …]` records its
// arguments and pid in FAKE_CLOUDFLARED_LOG, says a made-up trycloudflare.com host the way cloudflared does (in a box
// on stderr, after its own api.trycloudflare.com line), then waits to be killed. FAKE_CLOUDFLARED_FAIL=1: it exits
// before saying a host.
import { appendFileSync } from "node:fs";

const log = process.env.FAKE_CLOUDFLARED_LOG;
if (log) appendFileSync(log, `${JSON.stringify({ pid: process.pid, args: process.argv.slice(2) })}\n`);
if (process.env.FAKE_CLOUDFLARED_FAIL === "1") {
  console.error("failed to request quick Tunnel: fictional outage");
  process.exit(1);
}
const host = `fake-${Math.random().toString(36).slice(2, 10)}-tunnel.trycloudflare.com`;
console.error("INF Requesting new quick Tunnel on trycloudflare.com... (https://api.trycloudflare.com)");
console.error(`INF +----------------------------+\nINF |  https://${host}  |\nINF +----------------------------+`);
setInterval(() => {}, 1 << 30);
