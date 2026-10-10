// The notifications hub (PIE-741): one scheduled action, `pull`. Each source in config returns notifications in one
// shape (notification.ts); each becomes one note on the notifications page, keyed by `[notify.key::source:id]`, so a
// pull is idempotent. The boards (hubs of views) are the demo's (demo/), written once when it's installed. No model is called.
import { outline } from "./outline";
import { KEY, keyOf, merged, type Notification, type Source } from "./notification";
import { fixture, REAL } from "./sources";

interface Block { id: string; text: string; revision: number }
interface Config {
  sources?: string[]; page?: string; outline?: string; days?: number; fixtures?: Record<string, string>;
}
const answer = (value: unknown) => process.stdout.write(JSON.stringify({ ok: true, value }));

/** The properties of a first line, with these set (or taken out, null). */
function withProps(text: string, changes: Record<string, string | null>): string {
  const lines = text.split("\n");
  let line = lines[0] ?? "";
  for (const [key, next] of Object.entries(changes)) {
    line = line.replace(new RegExp(`\\s?\\[${key.replace(/\./g, "\\.")}::[^\\]\\n]*\\]`, "g"), "");
    if (next !== null) line += ` [${key}::${next}]`;
  }
  lines[0] = line;
  return lines.join("\n");
}

const { input, config } = (await Bun.stdin.json()) as { input: { context: { now: string } }; config: Config };
const where = config.outline;
const o = <T,>(request: { action: string; [k: string]: unknown }) => outline<T>(request, where);
const addressOf = config.page ?? "notifications";
const now = input.context.now;
const names = config.sources?.length ? config.sources : ["github"];

/** The source for a name: its fixture file when config names one, else the real one, else a message on how to plug it in. */
function sourceFor(name: string): Source {
  const file = config.fixtures?.[name];
  if (file) return fixture(name, file);
  const real = REAL[name];
  if (real) return real;
  return { fetch: async () => { throw new Error(`no real ${name} source yet: add it to sources.ts (README, "Plugging in a real source"), or set config fixtures.${name}`); } };
}

async function findPage(address: string): Promise<Block | null> {
  const resolved = await o<{ status: string; block?: Block }>({ action: "pages.resolve", address });
  return resolved.status === "resolved" && resolved.block ? o<Block>({ action: "get", blockId: resolved.block.id }) : null;
}

/** The page the notifications land under, made the first time. */
async function ensurePage(): Promise<Block> {
  return (await findPage(addressOf)) ?? o<Block>({ action: "create", text: `Notifications [page::${addressOf}]` });
}

const page = await ensurePage();
const tally = { created: 0, changed: 0, same: 0 };
const problems: string[] = [];
const synced: Record<string, string> = {};
const readCursor = (text: string, name: string) => text.split("\n")[0]!.match(new RegExp(`\\[notify\\.synced\\.${name}::([^\\]]*)\\]`))?.[1];

for (const name of names) {
  const started = new Date(Date.parse(now) - 60_000).toISOString(); // a minute of overlap: a write is idempotent
  try {
    const since = readCursor(page.text, name) ?? new Date(Date.parse(now) - (config.days ?? 14) * 86_400_000).toISOString();
    const fetched: Notification[] = await sourceFor(name).fetch({ since, days: config.days ?? 14 });
    for (const n of fetched) {
      const key = keyOf(n);
      const found = await o<{ blocks: Block[] }>({ action: "blocks.query", query: { where: `${KEY}="${key.replace(/"/g, "")}"`, subtreeRootId: page.id, limit: 1 } });
      if (!found.blocks[0]) {
        await o({ action: "create", parentId: page.id, text: merged(n) });
        tally.created++;
        continue;
      }
      const current = await o<Block>({ action: "get", blockId: found.blocks[0].id });
      const text = merged(n, current.text);
      if (text === current.text) { tally.same++; continue; }
      await o({ action: "update", blockId: current.id, expectedRevision: current.revision, text });
      tally.changed++;
    }
    synced[name] = started;
  } catch (error) {
    problems.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// The cursors move last, and only for a source that finished: a failed one is asked again from where it was.
if (Object.keys(synced).length) {
  const fresh = await o<Block>({ action: "get", blockId: page.id });
  const text = withProps(fresh.text, Object.fromEntries(Object.entries(synced).map(([name, at]) => [`notify.synced.${name}`, at])));
  if (text !== fresh.text) await o({ action: "update", blockId: fresh.id, expectedRevision: fresh.revision, text });
}
answer({ message: `notifications: ${tally.created} new, ${tally.changed} changed, ${tally.same} unchanged${problems.length ? `; ${problems.join("; ")}` : ""}` });
