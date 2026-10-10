// `outline_new` and `outline_archive` (PIE-679): an agent makes a place of its own for the fleeting things (a link spree, the
// day's discourse, a burp) so they stop landing in the outlines that drive work. One shared tool path, like the
// reads and writes: the stdio server and the HTTP gateway both answer these through `McpOutlines.admin`.
//
// Safe by shape: a new outline is empty, so full access on it reaches nothing that exists; grants nowhere else change;
// there is no delete over MCP. What can go wrong is sprawl, so the tool says to look first, refuses a name that is
// taken (an archived one too) with a did-you-mean, and holds a soft cap per principal per week. The outline is made on
// this machine only, through the outline host's own create (`outlines.create`, with an `about`): the host records who made it,
// gives the other principals `read`, and tags the root note. Nothing here restates those rules.
import { freeOutlineName } from "@ep0ch/outline-core/outline-location";
import { createdByOf, parseActor } from "@ep0ch/outline-core/attribution";
import { isWritablePropertyValue } from "@ep0ch/outline-core/property-grammar";
import type { HostedOutlineList, OutlineAbout } from "@ep0ch/outline-core/protocol";
import { applyWrite, actorOf, mcpSetting, principalOf, type McpCaller, type WriteBoard } from "./mcp-writes";
import { hostSocketOf } from "./discover";
import { canonicalLocalMachineName } from "@ep0ch/outliner/machine-name";
import { boardFor } from "./notes-cli";
import { hostRequest, OUTLINE_NAME } from "./socket";

/** What the tools need of this machine's outline host. */
export interface McpOutlineAdmin {
  machine: string;
  /** A request to this machine's outline host (`outlines.*`). */
  host<T = unknown>(action: string, params?: Record<string, unknown>): Promise<T>;
  /** A board on one of this machine's outlines (to seed it). */
  open(name: string): Promise<WriteBoard | { error: string }>;
  env?: Record<string, string | undefined>;
  now?: () => number;
}

export const SCRATCH_CAP_DEFAULT = 5;
const WEEK = 7 * 24 * 3600 * 1000;
const MAX_SEED = 50;
const MAX_PURPOSE = 200;

/** Scratch outlines one principal may make in a week: EP0CH_MCP_SCRATCH_CAP (a whole number; 0 stops them), default 5. */
export function scratchCap(env: Record<string, string | undefined> = process.env): number {
  const n = Number(mcpSetting(env, "EP0CH_MCP_SCRATCH_CAP"));
  return Number.isInteger(n) && n >= 0 && mcpSetting(env, "EP0CH_MCP_SCRATCH_CAP")?.trim() ? n : SCRATCH_CAP_DEFAULT;
}

/** Outline names near `name`: one holding the other, or a couple of edits apart. */
export function similarNames(name: string, taken: readonly string[]): string[] {
  const distance = (a: string, b: string) => {
    const row = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      let prev = row[0]!; row[0] = i;
      for (let j = 1; j <= b.length; j++) { const keep = row[j]!; row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = keep; }
    }
    return row[b.length]!;
  };
  return taken.filter(t => t !== name && (t.includes(name) || name.includes(t) || distance(t, name) <= 2)).slice(0, 5);
}

type Outcome = { ok: Record<string, unknown> } | { error: string };

const NEW_RULE = "Look first: call list_outlines (and outline_find in the ones that might hold it), and make a new outline only when none fits what you want to keep. ";

export const outlineAdminDefinitions = (machine: string) => [
  {
    name: "outline_new",
    description: `Make a new scratch outline of your own on ${machine}, for fleeting things (a link spree, the day's discourse, a burp) that don't belong in the outlines that drive work. ${NEW_RULE}` +
      "You get full access to it; the other principals get read; nothing else changes. Its root note records who made it and why. At most a few a week per principal (a soft cap, refused with the ones you already have). " +
      "It is made on this machine only, and can't be deleted from here: outline_archive puts it away. The answer is its ep0ch:// URI, which list_outlines shows from now on.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Lowercase letters, digits and hyphens, up to 32: gurgle, link-spree. A name already used (an archived one too) is refused with the nearest names." },
        purpose: { type: "string", description: `One line, up to ${MAX_PURPOSE} characters: what goes here. It is shown beside the name in the door and in list_outlines.` },
        seed: { type: "array", items: { type: "string" }, maxItems: MAX_SEED, description: "Optional first blocks, written under the root note in order." },
      },
      required: ["name", "purpose"],
      additionalProperties: false,
    },
  },
  {
    name: "outline_archive",
    description: "Put away a scratch outline you made: it leaves every list and keeps its database; restore: true brings it back. Only the principal that made it may, and only an outline made with outline_new. There is no delete over MCP.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" }, restore: { type: "boolean", default: false, description: "Bring an archived outline back" } },
      required: ["name"],
      additionalProperties: false,
    },
  },
];

export const OUTLINE_ADMIN_EXAMPLES: Record<string, Record<string, unknown>> = {
  outline_new: { name: "gurgle", purpose: "burps, links and the day's discourse", seed: ["first thing"] },
  outline_archive: { name: "gurgle" },
};

const describe = (n: string, a: OutlineAbout | undefined) => `${n}${a ? ` (${a.purpose}; made ${a.created.slice(0, 10)})` : ""}`;

/** One outline_new at a time per server: the weekly cap counts what the host lists, so two at once would both see room. */
const making = new WeakMap<McpOutlineAdmin, Promise<unknown>>();
export function outlineNew(admin: McpOutlineAdmin, args: Record<string, unknown>, caller: McpCaller): Promise<Outcome> {
  const run = (making.get(admin) ?? Promise.resolve()).catch(() => undefined).then(() => makeOutline(admin, args, caller));
  making.set(admin, run);
  return run;
}

async function makeOutline(admin: McpOutlineAdmin, args: Record<string, unknown>, caller: McpCaller): Promise<Outcome> {
  const name = typeof args.name === "string" ? args.name.trim() : "";
  const purpose = typeof args.purpose === "string" ? args.purpose.trim() : "";
  if (!OUTLINE_NAME.test(name)) return { error: `${JSON.stringify(args.name)} isn't an outline name: lowercase letters, digits and hyphens, up to 32 (${OUTLINE_NAME.source}).` };
  if (!purpose || purpose.length > MAX_PURPOSE || !isWritablePropertyValue(purpose)) return { error: `purpose is one line of up to ${MAX_PURPOSE} characters, without a stray [ or ].` };
  const seed = args.seed === undefined ? [] : args.seed;
  if (!Array.isArray(seed) || seed.length > MAX_SEED || seed.some(x => typeof x !== "string" || !x.trim())) return { error: `seed is a list of up to ${MAX_SEED} non-empty texts.` };
  const env = admin.env ?? process.env, now = admin.now?.() ?? Date.now();
  const principal = principalOf(caller, admin.machine);
  const list = await admin.host<HostedOutlineList>("outlines.list");
  const all = [...list.outlines.map(o => ({ name: o.name, about: o.about, archived: false })), ...(list.archived ?? []).map(o => ({ name: o.name, about: o.about, archived: true }))];
  const taken = all.map(o => o.name);
  if (taken.includes(name)) {
    const near = similarNames(name, taken), free = freeOutlineName(name, taken);
    const hit = all.find(o => o.name === name)!;
    return { error: `An outline named ${name} already exists${hit.archived ? " (archived: outline_archive with restore: true brings it back if you made it)" : ""}. ` +
      `If it fits, use it: ep0ch://${name}@${admin.machine}. ${near.length ? `Nearby names: ${near.join(", ")}. ` : ""}Otherwise a free name is ${free}.` };
  }
  const mine = all.filter(o => o.about?.kind === "scratch" && o.about.principal === principal && now - Date.parse(o.about.created) < WEEK);
  const cap = scratchCap(env);
  if (mine.length >= cap) {
    return { error: `${principal} has made ${mine.length} scratch outline${mine.length === 1 ? "" : "s"} this week (the limit is ${cap}, EP0CH_MCP_SCRATCH_CAP): ${mine.map(o => describe(o.name, o.about)).join("; ")}. ` +
      "Write in one of those, or ask the owner to raise the limit (archived ones count too)." };
  }
  const actor = actorOf(caller, env, admin.machine);
  const personaName = parseActor(actor.actorId).persona;
  const about: OutlineAbout = {
    createdBy: createdByOf({ ...(personaName ? { persona: personaName } : {}), principal }), principal, ...(personaName ? { persona: personaName } : {}),
    created: new Date(now).toISOString(), purpose, kind: "scratch",
  };
  try { await admin.host("outlines.create", { name, about }); }
  catch (e) { return { error: (e as Error).message }; }
  const uri = `ep0ch://${name}@${admin.machine}`;
  let seeded = 0;
  if (seed.length) {
    const board = await admin.open(name);
    if ("error" in board) return { ok: { outcome: "created", uri, outline: name, machine: admin.machine, about, seeded, said: `made ${uri}, but couldn't seed it: ${board.error}` } };
    try {
      const root = (await board.roots()).find(r => r.text.includes("[kind::scratch]"));
      if (!root) throw new Error("the new outline has no root note");
      for (const text of seed as string[]) {
        await applyWrite(board, { tool: "outline_create", blockId: root.id, input: { text: text.trim() } }, { level: "full", actor, uri: id => `${uri}/b/${id}` });
        seeded++;
      }
    } catch (e) {
      return { ok: { outcome: "created", uri, outline: name, machine: admin.machine, about, seeded, said: `made ${uri}; seeding stopped after ${seeded} of ${seed.length}: ${(e as Error).message}` } };
    } finally { board.close(); }
  }
  return { ok: { outcome: "created", uri, outline: name, machine: admin.machine, about, access: { you: "full", others: "read" }, seeded,
    said: `made ${uri} on ${admin.machine}: you have full access, other principals read. It is in list_outlines now; write to it with outline_create, outline_patch and the other write tools.` } };
}

export async function outlineArchive(admin: McpOutlineAdmin, args: Record<string, unknown>, caller: McpCaller): Promise<Outcome> {
  const name = typeof args.name === "string" ? args.name.trim() : "";
  const restore = args.restore === true;
  if (!OUTLINE_NAME.test(name)) return { error: `${JSON.stringify(args.name)} isn't an outline name.` };
  const principal = principalOf(caller, admin.machine);
  const list = await admin.host<HostedOutlineList>("outlines.list");
  const found = restore ? list.archived?.find(o => o.name === name) : list.outlines.find(o => o.name === name);
  if (!found) return { error: restore ? `No archived outline ${name}. ${list.archived?.length ? `Archived: ${list.archived.map(o => o.name).join(", ")}.` : "Nothing is archived."}` : `No outline ${name} on ${admin.machine}.` };
  const about = found.about;
  if (!about) return { error: `${name} wasn't made with outline_new, so it can't be archived over MCP: its owner does that with \`ep0ch outline archive ${name}\`.` };
  if (about.principal !== principal) return { error: `${name} was made by ${about.createdBy}; only ${about.principal} may ${restore ? "restore" : "archive"} it (its owner can: \`ep0ch outline ${restore ? "unarchive" : "archive"} ${name}\`).` };
  try {
    const r = await admin.host<{ movedTo: string }>(restore ? "outlines.unarchive" : "outlines.archive", { name });
    return { ok: { outcome: restore ? "restored" : "archived", outline: name, machine: admin.machine, said: restore ? `${name} is back in list_outlines` : `${name} is out of every list and its database is kept; outline_archive with restore: true brings it back` , movedTo: r.movedTo } };
  } catch (e) { return { error: (e as Error).message }; }
}

/** This machine's outline host (EP0CH_SOCKET names it outright, else the outlines folder's socket), as the tools use it. */
export function localAdmin(env: Record<string, string | undefined> = process.env): McpOutlineAdmin {
  const path = env.EP0CH_SOCKET?.trim() || hostSocketOf(env);
  return {
    machine: canonicalLocalMachineName(), env,
    host: (action, params = {}) => hostRequest(path, action, params, 30_000),
    open: async name => {
      const b = await boardFor(["--ws", name, "--here"]);
      return "error" in b ? b : b as WriteBoard;
    },
  };
}
