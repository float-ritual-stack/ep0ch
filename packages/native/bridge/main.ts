#!/usr/bin/env bun
// The native app's bridge: one JSON object a line on stdin and stdout. The app asks (`{id, op, …}`), the bridge
// answers (`{id, ok, result}` or `{id, ok: false, error, kind}`) and says what changed (`{event: …}`). It is a thin
// host like every small client: the door's SocketBoard reaches the outline (the rule that names one, a machine's
// forward, the protocol check, reconnects), outline-core parses, the service answers. The app only draws.
//
//   bun bridge/main.ts [--ws <name>] [--machine <ssh-name>]
import { createInterface } from "node:readline";
import { boardFor } from "@ep0ch/door/src/notes-cli";
import { hostname } from "node:os";
import { hostRequest, Refused, USER, type SocketBoard } from "@ep0ch/door/src/socket";
import { page } from "./page";

type Ask = { id: number; op: string } & Record<string, unknown>;

const say = (o: unknown) => process.stdout.write(JSON.stringify(o) + "\n");
/** Edits here are a person's, named by client and machine as the door names its own (`ep0ch-door:<machine>`). */
const mutation = { author: "user", actorId: `ep0ch-native:${hostname()}` } as const;

const str = (v: unknown, what: string): string => { if (typeof v !== "string" || !v) throw new Error(`${what} is missing`); return v; };

async function answer(board: SocketBoard & { address?: { outline: string; machine: string } }, a: Ask): Promise<unknown> {
  switch (a.op) {
    case "hello": {
      // The host's own list (`outlines.list` is the host's to answer, not an outline's).
      const outlines = await hostRequest(board.path, "outlines.list", {}, 3000).then(r => r.outlines.map(o => o.name), () => [] as string[]);
      return { outline: board.address?.outline ?? board.outline ?? "", machine: board.address?.machine ?? "", outlines };
    }
    case "tree": {
      const rows = await board.index();
      return { rows: rows.map(b => ({
        id: b.id, parent: b.parentId, depth: b.depth, // The index's preview is the title, then (after a ↵) the note's next words: a tree row is the title alone.
        title: b.title.split(" ↵ ")[0]!, hasChildren: b.hasChildren, kind: b.properties.find(p => p.key === "type")?.value ?? "",
      })) };
    }
    case "page": return page(board, str(a.note, "note"));
    case "follow": {
      // A link in prose: `ep0ch:b/<id>` is a note, `ep0ch:p/<address>` a page the service resolves.
      const href = str(a.href, "href");
      if (href.startsWith("ep0ch:b/")) return { id: href.slice(8) };
      if (!href.startsWith("ep0ch:p/")) return { url: href };
      const address = decodeURIComponent(href.slice(8));
      const r = await board.resolvePage(address);
      if (r.block) return { id: r.block.id };
      throw new Refused(`no page [[${address}]] yet`, "not-found");
    }
    case "save": {
      const note = str(a.note, "note");
      // Refused with `stale-revision` when the note was written since `revision` was read: the app keeps the draft.
      await board.request("update", { blockId: note, text: String(a.text ?? ""), expectedRevision: Number(a.revision), mutation });
      return page(board, note);
    }
    case "create": {
      // The door's own create: a person's new block (the service takes an actor id only on an agent's).
      const made = await board.createBlock(typeof a.parent === "string" ? a.parent : null, String(a.text ?? ""), USER);
      return { id: made.id };
    }
    case "move": {
      const moved = await board.send("move", { blockId: str(a.note, "note"), expectedRevision: Number(a.revision), step: str(a.step, "step"), mutation }) as { outcome: string; said?: string };
      return { outcome: moved.outcome, said: moved.said ?? "" };
    }
    case "trash": { await board.trash(str(a.note, "note"), USER); return {}; }
    case "restore": { await board.restore(str(a.note, "note"), USER); return {}; }
    case "search": {
      const r = await board.request("tree.search", { query: str(a.query, "query"), limit: 30, semantic: false });
      return { rows: r.matches.map(m => ({ id: m.block.id, title: m.title, context: m.path, snippet: m.snippet })) };
    }
    case "query": {
      // Any property filters, groups and sorts: the views' grammar, answered (and refused, with its hint) by the service.
      // The door's own facet read: the keys the matches carry, counted by the service, with the notes.
      const r = await board.facetList(String(a.where ?? ""), 200, typeof a.sort === "string" && a.sort ? { sort: a.sort } : {});
      return {
        rows: r.notes.map(n => ({ id: n.id, title: n.text.split("\n")[0] ?? "", context: new Date(n.updatedAt).toISOString().slice(0, 10), props: Object.fromEntries(n.properties.map(p => [p.key, p.value])) })),
        more: r.truncated, matched: r.matched, hint: r.hint ?? "",
        facets: r.facets.map(f => ({ key: f.key, count: f.count, values: f.values.slice(0, 8).map(v => ({ value: v.value, count: v.count })) })),
      };
    }
    default: throw new Error(`the bridge has no op "${a.op}"`);
  }
}

const args = process.argv.slice(2);
const board = await boardFor(args, ["native"]);
if ("error" in board) { say({ event: "fatal", error: board.error }); process.exit(1); }

// What changed, as the service says it: the app reads again what it shows. Bookkeeping never redraws a window.
board.onConnection = (state, detail) => say({ event: "connection", state, detail });
board.subscribe(e => {
  if (e.domain !== "content") return;
  const c = (e as { change?: { blockId?: string; parentId?: string | null; previousParentId?: string | null; kind?: string; machinery?: boolean; bookkeeping?: boolean } }).change;
  if (c?.machinery || c?.bookkeeping) return;
  say({ event: "changed", action: e.action, ids: [c?.blockId, c?.parentId, c?.previousParentId].filter((x): x is string => typeof x === "string"), structural: !c || c.kind !== "edit" });
});

const pending = new Set<Promise<unknown>>();
say({ event: "ready" });
for await (const line of createInterface({ input: process.stdin })) {
  if (!line.trim()) continue;
  let ask: Ask;
  try { ask = JSON.parse(line) as Ask; } catch { say({ event: "error", error: "not JSON" }); continue; }
  // Asks run side by side (a page read never waits behind the tree's), each answered under its own id.
  const done = answer(board, ask).then(
    result => say({ id: ask.id, ok: true, result }),
    e => say({ id: ask.id, ok: false, error: e instanceof Error ? e.message : String(e), kind: e instanceof Refused ? e.kind : "failed" }),
  );
  pending.add(done); void done.finally(() => pending.delete(done));
}
// The app closed its end: what it already asked is still answered.
await Promise.allSettled([...pending]);
board.close();
process.exit(0);
