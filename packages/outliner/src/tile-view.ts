/*
 * `tiles.view` (packages/native/docs/DESIGN.md §2 Kinds): what a tile of a kind an extension's script renders shows,
 * as one view primitive a client draws with the builders it has. The door asks `scripts.render` and draws the view
 * with its own renderer; a client that reads no activation asks this, and gets the same view with every press in it
 * said as the act line it runs (outline-core's `withActs`, the one rule a note's page is stamped by).
 *
 * - **The kind is the service's row** (`extensions.list`'s `tileKinds`): the asker names a kind as a tile carries it, or
 *   a name that kind serves in place of (`replaces`), and maps nothing itself.
 * - **A tile's fields are the script's props**, each a single value, as the door hands a render tile its args.
 * - **A script that returns no view** is its Markdown, as a `markdown` primitive: nothing is hidden.
 *
 * Watched as `notes.page` is (`watch: "later"`): answered now and again on each pass that reaches it.
 */
import type { Primitive } from "@ep0ch/outline-core/primitive";
import { withActs, type PagePrimitive } from "@ep0ch/outline-core/note-page";
import { Refusal } from "@ep0ch/outline-core/refusal";

/** What a client asks a rendered tile for. Declared here, beside the handler: types.ts names it once in the request union. */
export interface TileViewRequest {
  id: string; action: "tiles.view"; watch?: string; generation?: number;
  /** The tile's kind, as a tile carries it (`<extension>.<kind>`, or a name that kind serves in place of). */
  kind: string;
  /** The tile's own fields: the script's props, a value each. */
  fields?: Record<string, unknown>;
}

/** `tiles.view`'s answer: the kind that drew it, what the view calls itself, and the view. */
export interface TileView {
  kind: string; extension: string;
  /** The view's own title (a list's "outbox · 3 waiting on 2 people"), else the kind's name. */
  title: string;
  view: PagePrimitive;
  /** A watched answer hears every change: a script reads whatever it asks for. */
  anyChange: true;
}

type Own = { request<T>(input: { action: string } & Record<string, unknown>): Promise<T> };
type Served = { tileKinds?: readonly { kind: string; extension: string; name: string; render?: string; replaces?: readonly string[] }[] };
type Rendered = { markdown: string; view?: Primitive };

/** A tile's fields as a render script's props: each one a single value, as written. */
const propsOf = (fields: Record<string, unknown> | undefined): Record<string, string[]> =>
  Object.fromEntries(Object.entries(fields ?? {}).flatMap(([key, value]) => (typeof value === "string" && value) || typeof value === "number" || typeof value === "boolean" ? [[key, [String(value)]]] : []));

/** `tiles.view`: the view a kind's script draws for a tile with these fields. */
export async function readTileView(own: Own, request: Pick<TileViewRequest, "kind" | "fields">): Promise<TileView> {
  const kinds = (await own.request<Served>({ action: "extensions.list" })).tileKinds ?? [];
  // The row by that name; else the last kind to take the name, as `screens.list` resolves a screen's tiles.
  const row = kinds.find(k => k.kind === request.kind) ?? [...kinds].reverse().find(k => k.replaces?.includes(request.kind));
  if (!row) throw new Refusal("not-found", `no extension here serves a ${request.kind} tile · the bar's Extensions lists what is installed and what can be`);
  if (!row.render) throw new Refusal("invalid", `a ${row.kind} tile isn't drawn by a script: tiles.view answers the kinds an extension renders`);
  const rendered = await own.request<Rendered>({ action: "scripts.render", of: row.render, props: propsOf(request.fields), deadlineMs: 15_000 });
  const view: PagePrimitive = rendered.view ? withActs(rendered.view as PagePrimitive) : { type: "markdown", text: rendered.markdown };
  const titled = "title" in view && typeof view.title === "string" ? view.title.trim() : "";
  return { kind: row.kind, extension: row.extension, title: titled || row.name, view, anyChange: true };
}
