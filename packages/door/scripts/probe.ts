// Read-only protocol probe: bun scripts/probe.ts
import { connect } from "node:net";
const SOCK = process.env.EP0CH_SOCKET ?? `${process.env.EP0CH_OUTLINES ?? `${process.env.HOME}/outlines`}/.host/host.sock`;
const reqs = [
  { action: "ping" },
  { action: "children", parentId: null },
  { action: "clients.list" },
  { action: "activity.recent", limit: 3, author: "agent" },
  { action: "activity.recent", limit: 3, author: "user" },
  { action: "blocks.query", query: { limit: 3, sort: { field: "updated", direction: "desc" } } },
];
const s = connect(SOCK);
let buf = "", got = 0;
s.on("data", d => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    const r = JSON.parse(line);
    const res = r.result;
    const summary = Array.isArray(res) ? `array(${res.length}) first=${JSON.stringify(res[0])?.slice(0, 500)}`
      : JSON.stringify(res)?.slice(0, 900);
    console.log(`#${r.id} ok=${r.ok} seq=${r.sequence} ${r.error ?? ""}\n  ${summary}`);
    if (++got === reqs.length) s.end();
  }
});
s.on("connect", () => reqs.forEach((q, n) => s.write(JSON.stringify({ id: `${n}:${q.action}`, ...q }) + "\n")));
s.on("error", e => { console.error(e.message); process.exit(1); });
setTimeout(() => { console.error("timeout"); process.exit(2); }, 20000);
