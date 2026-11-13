// `notes.page`: a note as parts a client draws (outline-core's note-page.ts has the shape). The walk is the published
// page's own (publish-live.ts): the same component finder (outline-core's `componentAt`), the same questions asked of the service (`site.answer`,
// `blocks.query`, `blocks.authored-links`, `references.backlinks`), the same props a figure draws from. Where a page
// turns each answer into HTML, this hands it over as data, so a client that can't run outline-core draws any note
// and re-implements none of it.
import { BUTTON_NAME } from "@ep0ch/outline-core/button-call";
import { sourceLines } from "@ep0ch/outline-core/code-ranges";
import { componentAt, componentStarts, type ComponentAt } from "@ep0ch/outline-core/component-at";
import { noteCodeFences, noteStructure } from "@ep0ch/outline-core/component-block";
import { figurePrimitive } from "@ep0ch/outline-core/figure-primitive";
import { figureResultsMarkdown } from "@ep0ch/outline-core/figure-results";
import { isMarkType } from "@ep0ch/outline-core/annotation-marks";
import type { BlockRecord } from "@ep0ch/outline-core/block-record";
import { headerLine } from "@ep0ch/outline-core/header-line";
import type { ListGroup, ListRow } from "@ep0ch/outline-core/list-row";
import { noteMediaLines, parsePictureFence } from "@ep0ch/outline-core/media-line";
import { pageAddresses, pagePicture, proseMarkdown, unlabelledReferences, withActs, type NotePage, type NoteRow, type PagePart, type PagePicture, type PagePrimitive } from "@ep0ch/outline-core/note-page";
import type { Tone } from "@ep0ch/outline-core/primitive";
import type { SiteProduced } from "@ep0ch/outline-core/site";
import { USE_NAME, type TemplateUseAnswer } from "@ep0ch/outline-core/template-use";
import { holds, produced, readFigure, readLinks, type LiveHost } from "./publish-live";
import type { BacklinkCollection } from "./types";

/** Where the page was read: named in a figure's "the rest" command. */
interface PageAddress { outline?: string | undefined; machine?: string }

type Own = { request<T>(input: { action: string } & Record<string, unknown>): Promise<T> };
type Listed = { id: string; title?: string; hasChildren?: boolean; properties?: { key: string; value: string }[] };

/**
 * `notes.page` as the service answers it: everything a client draws of the note `blockId` names, read by the service
 * asking itself (`own`) for a reader who sees every note. One reading of every title: the lists' (`blocks.read`).
 * A note in Trash is refused.
 */
export async function servedPage(
  own: Own, require: (id: string) => { id: string; text: string; revision: number; effectiveDeletedRootId?: string | null },
  blockId: unknown, address: PageAddress,
): Promise<NotePage> {
  if (typeof blockId !== "string") throw new Error("notes.page needs blockId");
  const block = require(blockId);
  if (block.effectiveDeletedRootId) throw new Error(`Block ${block.id} is in Trash`);
  const { host, listed } = reader(own);
  const [body, { records }, context, back] = await Promise.all([
    noteParts(host, block, address),
    own.request<{ records: BlockRecord[] }>({ action: "blocks.records", ids: [block.id] }),
    own.request<{ ancestors: { id: string }[] }>({ action: "blocks.context", blockId: block.id }),
    own.request<BacklinkCollection>({ action: "references.backlinks", query: { targetBlockId: block.id, limit: 50 } }),
  ]);
  const record = records[0]!;
  const row = (b: Listed): NoteRow => ({ id: b.id, title: b.title || "untitled", ...(b.hasChildren ? { hasChildren: true } : {}) });
  const [self, above, kids] = await Promise.all([listed([block.id]), listed(context.ancestors.map(a => a.id)), listed(record.children, ["properties"])]);
  const ordered = (ids: readonly string[], rows: Listed[]) => ids.flatMap(id => rows.filter(r => r.id === id).map(row));
  // A comment on the note is a block under it and no note of it (outline-core's `isMarkType`): its threads list it
  // (`lists.read from=threads`), as a published page leaves it out of the notes under.
  const under = ordered(record.children, kids.filter(kid => !isMarkType(kid.properties?.find(p => p.key === "type")?.value)));
  return {
    blockId: block.id, revision: block.revision, title: self[0]?.title ?? "", chips: headerLine(block.text).chips.map(c => ({ key: c.key, value: c.value })),
    properties: record.properties.flatMap(p => p.values.map(value => ({ key: p.key, value }))), text: block.text, ...body,
    ancestors: ordered(context.ancestors.map(a => a.id), above), children: under,
    // The notes under it as the one list every client draws: a row says what a pick runs, as a row of any list does.
    ...(under.length ? { under: withActs({ type: "list", title: `Under this note · ${under.length}`, rows: under.map((r): ListRow => ({ id: r.id, label: r.title, ...(r.hasChildren ? { folds: true } : {}), do: { open: r.id } })), filter: false, enter: false }) } : {}),
    backlinks: back.sources.filter(s => s.blockId !== block.id).map(s => ({ id: s.blockId, title: s.title || "untitled", ...(s.parentContext ? { context: s.parentContext } : {}) })),
    updated: record.updated, author: record.actor ?? record.author,
  };
}

/** The service asking itself, as the walk asks: for a reader who sees every note, with one reading of every title (the lists'). */
function reader(own: Own): { host: LiveHost; listed(ids: readonly string[], more?: readonly string[]): Promise<Listed[]> } {
  const listed = async (ids: readonly string[], more: readonly string[] = []): Promise<Listed[]> => ids.length
    ? (await own.request<{ blocks: Listed[] }>({ action: "blocks.read", ids: [...new Set(ids)], fields: ["title", "hasChildren", ...more] })).blocks : [];
  const titles = async (ids: readonly string[]) => new Map((await listed(ids)).map(b => [b.id, b.title ?? ""] as const));
  return { host: { request: input => own.request(input as { action: string }), shown: async ids => new Set(ids), titles, href: id => id }, listed };
}

/**
 * A text nobody saved, as the parts a page would answer for a note that held it: `text` (its first line the header
 * line) walked as note `about`, which is the note its questions ask about (`this`). What a component's own example
 * draws as (`lists.read from=components`).
 */
export async function drawnParts(own: Own, about: string, text: string): Promise<PagePart[]> {
  return (await noteParts(reader(own).host, { id: about, text }, {})).parts;
}

const said = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** A button's tone as a primitive's: a theme role either way. */
const BUTTON_TONE: Record<string, Tone> = { primary: "accent", danger: "bad" };

/** The body of `note` as parts, its components answered through `host`, and its header image when it has one. */
async function noteParts(host: LiveHost, note: { id: string; text: string }, address: PageAddress): Promise<{ parts: PagePart[]; hero?: PagePicture }> {
  const header = headerLine(note.text);
  const all = note.text.split("\n");
  // The body is every line after the header line; a component is found where it stands in the whole note, as a page finds it.
  const first = header.line + 1;
  const structure = noteStructure(all);
  const starts = componentStarts(all), offsets = sourceLines(note.text);
  const titles = new Map<string, string>();
  const written = all.slice(first).join("\n");
  const ids = unlabelledReferences(written);
  if (ids.length) for (const [id, title] of await host.titles(ids)) titles.set(id, title);
  // A page link is written to the note its page is, when there is one.
  const pages = new Map<string, string>();
  await Promise.all(pageAddresses(written).map(async at => {
    const found = await host.request<{ status: string; block?: { id: string } }>({ action: "pages.resolve", address: at }).catch(() => null);
    if (found?.status === "resolved" && found.block) pages.set(at, found.block.id);
  }));

  // Pictures: the note's media lines, and its ```svg fences (the fence's text is the picture).
  const media = noteMediaLines(note.text);
  const fences = new Map(noteCodeFences(all).map(fence => [fence.start, fence]));
  let hero: PagePicture | undefined;
  const lines = (from: number, to: number) => all.slice(from, to + 1).join("\n");
  /** A part written on lines `from` to `to` (inclusive). */
  const part = (kind: PagePart["kind"], from: number, to: number, view: PagePrimitive, frame: Partial<PagePart> = {}): PagePart =>
    ({ type: "part", kind, block: note.id, span: { start: offsets[from]?.start ?? note.text.length, end: offsets[to]?.contentEnd ?? note.text.length }, line: from, ...frame, view: withActs(view) });
  /** A row's id among its list's: the note it opens, when that is its alone; else its place. (What a client keys and presses it by.) */
  const keyed = <R extends { opens?: string | null }>(rows: readonly R[], place: (row: R, n: number) => string): string[] => {
    const seen = new Set<string>();
    return rows.map((r, n) => { const id = r.opens && !seen.has(r.opens) ? r.opens : place(r, n); seen.add(id); return id; });
  };
  const asWritten = (from: number, to: number): PagePrimitive => ({ type: "source", text: lines(from, to) });

  /** The component `found` at line `i`, answered. */
  const answered = async (found: Exclude<ComponentAt, { kind: "if" | "box" }>, i: number): Promise<PagePart> => {
    const end = found.end;
    switch (found.kind) {
      case "view": {
        const { spec, block } = found, query = typeof spec.props.query === "string" ? spec.props.query : undefined;
        const a = await produced(host, note.id, { kind: "view", props: spec.props }, spec.args) as Extract<SiteProduced, { kind: "view" }>;
        const error = spec.error ?? a.error ?? a.hint;
        return part("view", i, end, a.view, { name: block.name, title: a.title, ...(query ? { query } : {}), ...(a.truncated ? { truncated: true } : {}),
          status: `live · ${a.view.rows.length} result${a.view.rows.length === 1 ? "" : "s"}${a.truncated ? " · more matches" : ""}`, ...(error ? { error } : {}) });
      }
      case "fields": {
        const { spec } = found.site, title = spec.title ?? spec.key;
        if (spec.problem) return part("fields", i, end, asWritten(i, end), { name: "fields", title, error: spec.problem });
        const a = await produced(host, note.id, { kind: "fields", key: spec.key, ...(spec.of ? { of: spec.of } : {}) }) as Extract<SiteProduced, { kind: "fields" }>;
        const ids = keyed(a.rows.map(row => ({ opens: row.link?.id })), (_, n) => `${n}`);
        const rows: ListRow[] = a.rows.map((row, n) => row.link ? { id: ids[n]!, label: row.link.title, do: { open: row.link.id } } : { id: ids[n]!, label: row.value });
        return part("fields", i, end, { type: "list", rows, filter: false, enter: false }, { name: "fields", title, status: `live · ${rows.length} occurrence${rows.length === 1 ? "" : "s"}`, ...(a.problem ? { error: a.problem.message } : {}) });
      }
      case "links": {
        const { spec } = found, read = await readLinks(host, spec, note.id);
        const error = read.problem ?? read.unread ?? (read.hidden ? "a note not shown here" : undefined);
        // One list, a group a named run of rows: a row that opens a note says so (`do`), one that opens nothing is words;
        // a group with no rows says what it would hold (its `note`).
        const flat = read.groups.flatMap((g, at) => g.rows.map((r, n) => ({ ...r, opens: r.id, group: g.name, place: `${at}.${n}` })));
        const ids = keyed(flat, r => r.place);
        const rows: ListRow[] = flat.map((r, n): ListRow => ({ id: ids[n]!, label: r.text, group: r.group, ...(r.note ? { detail: r.note } : {}), ...(r.id ? { do: { open: r.id } } : {}) }));
        const groups: ListGroup[] = read.groups.map(g => ({ name: g.name, label: g.name, glyph: g.glyph, count: g.rows.length, ...(g.note && !g.rows.length ? { note: g.note } : {}) }));
        return part("links", i, end, { type: "list", rows, groups, filter: false, enter: false }, { name: spec.kind, title: read.title, ...(spec.query ? { query: spec.query } : {}), ...(read.status ? { status: read.status } : {}), ...(error ? { error } : {}) });
      }
      case "figure": {
        const { block, figure } = found;
        const read = await readFigure(host, figure, all.slice(i + 1, end), note.id, all.slice(0, i).every(line => !line.trim()), block.attrs);
        if ("unreadable" in read) return part("figure", i, end, asWritten(i, end), { name: block.name, figure, error: read.unreadable });
        // A kind with no primitive form: the same results as Markdown (a page copy writes these lines), else its lines.
        const drawn = figurePrimitive(figure, read.props);
        const md = drawn || !(read.found || read.error) ? null : figureResultsMarkdown(figure, read.props, read.found ?? null, { ...(address.outline ? { outline: address.outline } : {}), ...(address.machine ? { machine: address.machine } : {}), note: note.id, at: Date.now() }, read.error || undefined);
        return part("figure", i, end, drawn ?? (md ? { type: "markdown", text: proseMarkdown(md.lines.join("\n"), titles, pages) } : asWritten(i, end)), { name: block.name, figure,
          ...(typeof read.props.title === "string" ? { title: read.props.title } : {}), ...(typeof read.props.query === "string" ? { query: read.props.query } : {}),
          ...(read.foot ? { status: read.foot } : {}), ...(read.error ? { error: read.error } : {}) });
      }
      case "button": {
        const { call } = found, tone = call.look.tone && BUTTON_TONE[call.look.tone];
        // A button that names nothing to run is its lines, with what to write: a press of it would run nothing.
        if (call.act === null) return part("button", i, end, asWritten(i, end), { name: BUTTON_NAME, error: call.problem ?? "this button names nothing to run: write act= on its line" });
        // What stops a press and what doesn't are said apart: an empty slot is what the button `needs` (a press has
        // nothing to fill it with); a look word it doesn't read is only said, as the door draws the rest and runs it.
        const wrong = [call.empty.length ? `no ${call.empty.join(" or ")} yet: write ${call.empty[0]}= on its line` : undefined, call.lookProblem].filter(Boolean).join(" · ");
        return part("button", i, end, { type: "button", label: call.label, act: call.act, ...(tone ? { tone } : {}) }, { name: BUTTON_NAME, ...(call.sequence ? { sequence: true } : {}), ...(call.empty.length ? { needs: call.empty } : {}), ...(wrong ? { error: wrong } : {}) });
      }
      case "use": {
        // The template's own body is drawn through its Site chain, which a page doesn't walk yet: the call, as written, with what is wrong with it.
        const a = found.call.problem ? null : await host.request<TemplateUseAnswer>({ action: "template.use", block: note.id, line: i });
        const wrong = found.call.problem ?? a?.problems[0]?.message;
        return part("use", i, end, asWritten(i, end), { name: USE_NAME, ...(a?.template ? { title: a.template.title } : {}), ...(wrong ? { error: wrong } : {}) });
      }
      case "component":
        // A component the service has no answer for here (an extension's, one nobody knows): its source, as written.
        return part("component", i, end, asWritten(i, end), { name: found.block.name });
    }
  };

  /** The parts written on lines `from` up to `to` (exclusive): the body, a box's, an `::if`'s. */
  const walk = async (from: number, to: number): Promise<PagePart[]> => {
    const parts: PagePart[] = [];
    let prose: number[] = [];
    const flush = () => {
      // Blank lines around a run of prose are the space between parts, not prose.
      while (prose.length && !all[prose[0]!]!.trim()) prose.shift();
      while (prose.length && !all[prose[prose.length - 1]!]!.trim()) prose.pop();
      if (prose.length) parts.push(part("prose", prose[0]!, prose[prose.length - 1]!, { type: "markdown", text: proseMarkdown(prose.map(n => all[n]!).join("\n"), titles, pages) }));
      prose = [];
    };
    for (let i = from; i < to; i++) {
      if (structure[i] !== -1 && structure[i] !== i) { prose.push(i); continue; }
      const shown = media.get(i);
      if (shown?.kind === "img") {
        // The header image is the page's own, above the title; any other picture stands where it was written.
        if (shown.layout === "hero") hero = pagePicture(shown);
        else { flush(); parts.push(part("picture", i, i, { type: "picture", ...pagePicture(shown) })); }
        continue;
      }
      const fence = fences.get(i), drawn = fence && parsePictureFence(all[i]!);
      if (fence && drawn?.fence === "svg") {
        flush();
        parts.push(part("picture", fence.start, fence.end, { type: "picture", ...pagePicture(drawn, all.slice(fence.start + 1, fence.end).join("\n")) }));
        i = fence.end;
        continue;
      }
      const found = componentAt(all, i, starts);
      if (!found) { prose.push(i); continue; }
      flush();
      // `::if`: its body is drawn in its place when `this` matches (only its two lines go), else it all goes.
      if (found.kind === "if") {
        if (await holds(host, note.id, found.site.spec.where, found.site.spec.problem)) parts.push(...await walk(i + 1, found.end));
      } else if (found.kind === "box") {
        parts.push(part("box", i, found.end, { type: "box", children: await walk(i + 1, found.end) }, { name: found.block.name }));
      } else {
        try { parts.push(await answered(found, i)); }
        catch (error) { parts.push(part(found.kind, i, found.end, asWritten(i, found.end), { name: "block" in found && found.block ? found.block.name : found.kind, error: `couldn't ask the outline: ${said(error)}` })); }
      }
      i = found.end;
    }
    flush();
    return parts;
  };
  const parts = await walk(first, all.length);
  return { parts, ...(hero ? { hero } : {}) };
}
