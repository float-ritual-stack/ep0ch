/*
 * Two list sources a command bar lists (packages/native/docs/DESIGN.md W7), read as every list is (`lists.read`,
 * list-producers.ts): a row says what it shows and the act line a pick runs, so a client maps nothing.
 *
 * - **`extensions`**: what `extensions.list` says of the outline's extensions, a row a thing a person does with one:
 *   open an installed one's page, change its settings (`extensions.configure`), install one the repo has
 *   (`extensions.install`), and, once words are typed, remove one, its demo notes kept or binned
 *   (`extensions.uninstall`: `demo=` has no default, so each is its own row). The words on a row are the extension's
 *   own (its name, its description, its state, each setting as the schema says it): nothing here describes one.
 * - **`outlines`**: the outlines this machine has and the ones on the machines it holds a forward to
 *   (`outlines.known`, the host's own listing through outline-links.ts). A pick switches to one (`outline.switch`),
 *   by the names a client opens an outline by: its name, and its machine's ssh name when it is another's. It lists
 *   and never makes one: an outline nobody has is not a row.
 */
import { listRowMatches, type ListGroup, type ListRow } from "@ep0ch/outline-core/list-row";
import type { ExtensionSettings } from "@ep0ch/outline-core/protocol";
import { prepareSearchQuery } from "@ep0ch/outline-core/search-match";
import { listed, runs, opens, type Answered, type ListsRequest, type Own, type Producer } from "./list-producers";
import type { KnownOutlines } from "./outline-links";

type Entry = { id: string; name?: string; description?: string; state: string; error?: string; partOf?: string; settings?: ExtensionSettings };
type Listed = { extensions?: readonly Entry[]; available?: readonly { id: string; name: string; description?: string }[]; pages?: Record<string, string>; demos?: Record<string, number>; hub?: string };

const firstSentence = (words: string | undefined) => (words ?? "").split(/(?<=[.!?])\s/)[0]!.trim();
const shown = (value: unknown) => typeof value === "string" ? value : JSON.stringify(value);

/** An extension's settings in a line: each field as the schema names it with what it has now, then what needs the person. */
function settingsLine(s: ExtensionSettings): string {
  const fields = s.fields.map(f => `${f.name}=${f.value !== undefined ? shown(f.value) : f.default !== undefined ? `${shown(f.default)} (its default)` : f.state === "missing" ? "needed" : "unset"}`);
  const secrets = s.secrets.map(x => `${x.name}: ${x.state === "set" ? x.reference ?? "set" : "needed"}`);
  return [s.state === "failing" ? `failing: ${s.error ?? "its last call failed"}` : s.state === "missing" ? "needs setup" : "", ...fields, ...secrets].filter(Boolean).join(" · ");
}

async function extensions(own: Own, request: ListsRequest): Promise<Answered> {
  const l = await own.request<Listed>({ action: "extensions.list" });
  const words = prepareSearchQuery(request.query ?? "");
  // A script an extension ships is part of that extension's row, and a copy another shadows isn't the one that runs.
  const installed = (l.extensions ?? []).filter(e => e.state !== "shadowed" && !e.partOf);
  const named = (e: { id: string; name?: string }) => e.name ?? e.id;
  const rows: ListRow[] = [], groups: ListGroup[] = [];
  const group = (name: string, label: string, of: ListRow[]) => { const left = of.filter(r => listRowMatches({ label: r.label, detail: r.detail, mark: r.mark }, words)); if (left.length) { rows.push(...left); groups.push({ name, label, count: left.length }); } };
  group("installed", "Installed", installed.map(e => listed({
    id: e.id, label: named(e), mark: e.id, group: "installed",
    detail: [e.state === "active" ? "" : e.state, e.error ?? "", firstSentence(e.description)].filter(Boolean).join(" · "),
    ...(e.state === "failed" ? { tone: "warn" as const } : {}), ...(l.pages?.[e.id] ? { do: opens(l.pages[e.id]!) } : {}),
  })));
  group("settings", "Settings", installed.filter(e => e.settings).map(e => listed({
    id: `settings:${e.id}`, label: `Settings of ${named(e)}`, mark: e.id, group: "settings", detail: settingsLine(e.settings!),
    ...(e.settings!.state === "missing" || e.settings!.state === "failing" ? { tone: "warn" as const } : {}), do: runs("extensions.configure", { id: e.id }),
  })));
  group("available", "Not installed", (l.available ?? []).map(a => listed({
    id: `install:${a.id}`, label: `Install ${a.name}`, mark: a.id, group: "available", detail: firstSentence(a.description), do: runs("extensions.install", { id: a.id }),
  })));
  // Removing one is listed once something is typed, as the door's bar lists it: never the first thing under a hand.
  if (words) group("remove", "Remove", installed.flatMap(e => {
    const notes = l.demos?.[e.id] ?? 0, demo = notes === 1 ? "its demo note" : `its ${notes} demo notes`;
    return [
      listed({ id: `remove:${e.id}:keep`, label: `Remove ${named(e)}`, mark: e.id, group: "remove", detail: notes ? `${demo} stay under its page` : "it has no demo notes here", do: runs("extensions.uninstall", { id: e.id, demo: "keep" }) }),
      ...(notes ? [listed({ id: `remove:${e.id}:remove`, label: `Remove ${named(e)} and ${demo}`, mark: e.id, group: "remove", detail: "to the Trash, except the ones someone changed", do: runs("extensions.uninstall", { id: e.id, demo: "remove" }) })] : []),
    ];
  }));
  return { list: { type: "list", arrange: "rows", rows, groups, empty: words ? "No extension matches." : "No extensions here." } };
}

async function outlines(own: Own, request: ListsRequest): Promise<Answered> {
  const known = await own.request<KnownOutlines>({ action: "outlines.known" });
  const words = prepareSearchQuery(request.query ?? "");
  const away = new Map((known.away ?? []).map(a => [a.machine, a] as const));
  // A header a machine, once there is more than one to tell apart.
  const several = new Set(known.outlines.map(o => o.machine ?? "")).size > 1;
  const rows = known.outlines.map(o => listed({
    id: o.machine ? `${o.machine}/${o.name}` : o.name, label: o.name, mark: o.machine ?? "",
    detail: o.machine ? [`on ${o.machine}`, away.has(o.machine) ? `not answering${away.get(o.machine)!.asOf ? `: a copy as of ${away.get(o.machine)!.asOf!.slice(0, 16).replace("T", " ")}` : ""}` : ""].filter(Boolean).join(" · ") : o.here ? "on this machine · the one this list was asked of" : "on this machine",
    ...(several ? { group: o.machine ?? "" } : {}), ...(o.machine && away.has(o.machine) ? { tone: "warn" as const } : {}),
    do: runs("outline.switch", { name: o.name, ...(o.machine ? { machine: o.machine } : {}) }),
  })).filter(r => listRowMatches({ label: r.label, detail: r.detail, mark: r.mark }, words));
  const machines = several ? [...new Set(rows.map(r => r.group ?? ""))] : [];
  const groups: ListGroup[] = machines.map(m => ({ name: m, label: m || "This machine", count: rows.filter(r => (r.group ?? "") === m).length }));
  return { list: { type: "list", arrange: "rows", rows, ...(several ? { groups } : {}), empty: words ? "No outline by that name: this lists the ones there are and makes none (ep0ch outline create <name> makes one)." : "No outlines here." } };
}

/** The sources this module adds to `lists.read`, each as it says of itself. */
export const EXTENSION_PRODUCERS: readonly Producer[] = [
  { row: { from: "extensions", about: "Extensions", placeholder: "An extension's name · typed, it can be removed too", params: [{ name: "query", about: "words of its name or of what it does" }], bar: {} }, read: extensions },
  { row: { from: "outlines", about: "Outlines", placeholder: "An outline's name, or a machine's", params: [{ name: "query", about: "words of its name or its machine's" }], bar: {} }, read: outlines },
];
