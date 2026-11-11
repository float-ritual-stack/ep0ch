// `notes.page`: a note as parts a client draws (outline-core's note-page.ts has the shape). The walk is the published
// page's own (publish-live.ts): the same component finders, the same questions asked of the service (`site.answer`,
// `blocks.query`, `blocks.authored-links`, `references.backlinks`), the same props a figure draws from. Where a page
// turns each answer into HTML, this hands it over as data, so a client that can't run outline-core draws any note
// and re-implements none of it.
import { componentBlocks, noteStructure } from "@ep0ch/outline-core/component-block";
import { graphKind } from "@ep0ch/outline-core/figure-props";
import { figureResultsMarkdown } from "@ep0ch/outline-core/figure-results";
import { headerLine, titleWords } from "@ep0ch/outline-core/header-line";
import { linkBlockAt } from "@ep0ch/outline-core/link-blocks";
import { proseMarkdown, unlabelledReferences, type NotePage, type PagePart } from "@ep0ch/outline-core/note-page";
import type { SiteProduced } from "@ep0ch/outline-core/site";
import { siteBlockAt } from "@ep0ch/outline-core/site-blocks";
import { viewSpec } from "@ep0ch/outline-core/view-spec";
import { holds, produced, readFigure, readLinks, type LiveHost } from "./publish-live";

/** Where the page was read: named in a figure's "the rest" command. */
interface PageAddress { outline?: string | undefined; machine?: string }

/**
 * `notes.page` as the service answers it: the page of the note `blockId` names, read by the service asking itself
 * (`own`) for a reader who sees every note, titled as every list titles it. A note in Trash is refused.
 */
export async function servedPage(
  own: { request<T>(input: { action: string } & Record<string, unknown>): Promise<T> },
  require: (id: string) => { id: string; text: string; revision: number; effectiveDeletedRootId?: string | null },
  blockId: unknown, address: PageAddress,
): Promise<NotePage> {
  if (typeof blockId !== "string") throw new Error("notes.page needs blockId");
  const block = require(blockId);
  if (block.effectiveDeletedRootId) throw new Error(`Block ${block.id} is in Trash`);
  const titles = async (ids: readonly string[]) => new Map(ids.length
    ? (await own.request<{ blocks: { id: string; title?: string }[] }>({ action: "blocks.read", ids: [...new Set(ids)], fields: ["title"] })).blocks.map(b => [b.id, b.title ?? ""] as const)
    : []);
  const host: LiveHost = { request: input => own.request(input as { action: string }), shown: async ids => new Set(ids), titles, href: id => id };
  const page = await notePage(host, block, address);
  const title = (await titles([block.id])).get(block.id);
  return title ? { ...page, title } : page;
}

const said = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The page of `note`, its components answered through `host` (the service's own requests, for a reader who sees every note). */
async function notePage(host: LiveHost, note: { id: string; text: string; revision: number }, address: PageAddress): Promise<NotePage> {
  const header = headerLine(note.text);
  const all = note.text.split("\n");
  // The body is every line after the header line; a component is found where it stands in the whole note, as a page finds it.
  const first = header.line + 1;
  const structure = noteStructure(all);
  const byStart = new Map(componentBlocks(all).map(block => [block.start, block]));
  const titles = new Map<string, string>();
  const ids = unlabelledReferences(all.slice(first).join("\n"));
  if (ids.length) for (const [id, title] of await host.titles(ids)) titles.set(id, title);

  const parts: PagePart[] = [];
  let prose: string[] = [];
  const flush = () => {
    const text = prose.join("\n").replace(/^\n+|\n+$/g, "");
    if (text.trim()) parts.push({ kind: "prose", markdown: proseMarkdown(text, titles) });
    prose = [];
  };
  for (let i = first; i < all.length; i++) {
    if (structure[i] !== -1 && structure[i] !== i) { prose.push(all[i]!); continue; }
    const links = linkBlockAt(all, i, byStart);
    const block = byStart.get(i), kind = block && graphKind(block);
    const collection = block && viewSpec(block, all);
    const site = !collection && !links && !kind ? siteBlockAt(all, i, byStart) : null;
    // `::if`: its body stays in the prose when `this` matches (only its two lines go), else it all goes.
    if (site?.kind === "if") {
      if (await holds(host, note.id, site.spec.where, site.spec.problem)) prose.push(...all.slice(i + 1, site.end));
      i = site.end;
      continue;
    }
    // Any other component (a button, a box, an extension's) the service has no answer for here: its source, as written.
    if (!collection && !links && !kind && !site) {
      if (!block) { prose.push(all[i]!); continue; }
      flush();
      parts.push({ kind: "component", name: block.name, source: all.slice(i, block.end + 1).join("\n") });
      i = block.end;
      continue;
    }
    const end = links ? links.end : site ? site.end : block!.end;
    const source = all.slice(i, end + 1).join("\n");
    flush();
    try {
      if (collection) {
        const name = block!.name, query = typeof collection.props.query === "string" ? collection.props.query : undefined;
        const a = await produced(host, note.id, { kind: "view", props: collection.props }, collection.args) as Extract<SiteProduced, { kind: "view" }>;
        const error = collection.error ?? a.error ?? a.hint;
        parts.push({ kind: "view", name, title: a.title, source, view: a.view, ...(query ? { query } : {}), ...(a.truncated ? { truncated: true } : {}),
          status: `live · ${a.view.rows.length} result${a.view.rows.length === 1 ? "" : "s"}${a.truncated ? " · more matches" : ""}`, ...(error ? { error } : {}) });
      } else if (site) {
        const { spec } = site, title = spec.title ?? spec.key;
        if (spec.problem) parts.push({ kind: "rows", name: "fields", title, source, groups: [], error: spec.problem });
        else {
          const a = await produced(host, note.id, { kind: "fields", key: spec.key, ...(spec.of ? { of: spec.of } : {}) }) as Extract<SiteProduced, { kind: "fields" }>;
          const rows = a.rows.map(row => row.link ? { text: row.link.title, id: row.link.id } : { text: row.value });
          parts.push({ kind: "rows", name: "fields", title, source, groups: [{ name: spec.key, rows }], status: `live · ${rows.length} occurrence${rows.length === 1 ? "" : "s"}`, ...(a.problem ? { error: a.problem.message } : {}) });
        }
      } else if (links) {
        const read = await readLinks(host, links.spec, note.id);
        const error = read.problem ?? read.unread ?? (read.hidden ? "a note not shown here" : undefined);
        parts.push({ kind: "rows", name: links.spec.kind, title: read.title, source, ...(links.spec.query ? { query: links.spec.query } : {}),
          groups: read.groups.map(g => ({ name: g.name, empty: g.note, rows: g.rows.map(r => ({ text: r.text, ...(r.id ? { id: r.id } : {}), ...(r.note ? { note: r.note } : {}) })) })),
          ...(read.status ? { status: read.status } : {}), ...(error ? { error } : {}) });
      } else {
        const read = await readFigure(host, kind!, all.slice(i + 1, end), note.id, all.slice(0, i).every(line => !line.trim()), block!.attrs);
        if ("unreadable" in read) parts.push({ kind: "figure", name: block!.name, figure: kind!, source, props: {}, error: read.unreadable });
        else {
          // The same results as Markdown, for a client with no drawing of this kind (a page copy writes these lines).
          const md = read.found || read.error ? figureResultsMarkdown(kind!, read.props, read.found ?? null, { ...(address.outline ? { outline: address.outline } : {}), ...(address.machine ? { machine: address.machine } : {}), note: note.id, at: Date.now() }, read.error || undefined) : null;
          parts.push({ kind: "figure", name: block!.name, figure: kind!, source, props: read.props, ...(typeof read.props.title === "string" ? { title: read.props.title } : {}),
            ...(md ? { markdown: proseMarkdown(md.lines.join("\n"), titles) } : {}), ...(read.foot ? { status: read.foot } : {}), ...(read.error ? { error: read.error } : {}) });
        }
      }
    } catch (error) {
      parts.push({ kind: "component", name: block?.name ?? links?.spec.kind ?? "component", source, error: `couldn't ask the outline: ${said(error)}` });
    }
    i = end;
  }
  flush();
  return { blockId: note.id, revision: note.revision, title: titleWords(note.text), chips: header.chips.map(c => ({ key: c.key, value: c.value })), text: note.text, parts };
}
