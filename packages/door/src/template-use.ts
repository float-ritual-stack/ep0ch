// A template drawn live in the reader (PIE-533 S4): the `::use{of=[[meeting-template]] date=… with=…}` line of a note
// becomes a shaded region (an embed's look) holding the template's body, drawn with `this` the note the line is in. The
// service resolves the call (`template.use`, watched: the template found, its props checked and defaulted, the chain
// to draw the body in) and reads the body's `{{ }}`, figures, `::fields` and `::if` in that chain (`site.answer`,
// `produce`); the door asks and draws. A call with something wrong says so in the region, dimmed, with the nearest name
// and a call that works; a required prop left out is an offer, and ⏎ or a click on it asks for the prop in the picker
// of its kind (`use.fill`). Nothing here writes a note: drawing never does.
import type { SiteLink } from "@ep0ch/outline-core/site";
import type { TemplateUseAnswer, UseCall } from "@ep0ch/outline-core/template-use";
import type { Msg } from "./board";
import type { AfterRows } from "./doc";
import { embedState } from "./embeds";
import { regionRows, type RegionBook } from "./output-region";
import type { LiveSite } from "./live";
import { printable, type Source } from "./props";
import { LINK_OFF, LINK_ON, type LinkTarget } from "./refs";
import { C, fg, linkTag, LINK_END, RESET } from "./style";
import { watchedOn, type Watching } from "./watched";

/** The most nested `::use` calls drawn inside each other (the service's chain bound, one short). */
export const MAX_USE_DEPTH = 6;

/** What the call is drawn in: the invocations that draw its note (a `::use` above it) and that call's props. */
export interface UseSite { chain?: SiteLink[]; props?: Record<string, string[]> }

/** The call a `::use` line makes, from the service, watched: it changes when the template, the host or a note a prop reads does. */
export function useAnswer(src: Source | null | undefined, host: string, line: number, site: UseSite = {}): Watching<TemplateUseAnswer> | null {
  if (!src) return null;
  return watchedOn(src.board).read<TemplateUseAnswer>("template.use", { block: host, line, ...(site.chain?.length ? { chain: site.chain } : {}), ...(site.props && Object.keys(site.props).length ? { props: site.props } : {}) }, raw => raw);
}

/** The site a template's body is drawn in: where it sits (the chain) and the props the call gave it. */
export const bodySite = (answer: TemplateUseAnswer): LiveSite => ({ chain: answer.chain, props: answer.props });

/** How a template's body is drawn, `w` wide: the reader's own renderer with the call's Site (src/surface/note.ts). */
export type UseBody = (template: Msg, site: LiveSite, width: number) => string[];

/** Everything a `::use` region needs from the reader that draws it. */
export interface UseDrawing {
  call: UseCall;
  /** The note line (from 0) the `::use` is written on, and the note it is written in. */
  line: number;
  host: string;
  /** The Site that note is drawn in (it is a template's body itself). */
  site?: UseSite;
  /** The note being read (embeds are projected from it: its cycle check). */
  top: string;
  width: number;
  src: Source | null | undefined;
  body: UseBody;
  /** How deep this call sits in others. */
  depth?: number;
  /** Tag a part of the region as a link (without one the region is text). */
  sink?: LinkTarget[];
  /** The reader's book of generated regions: the gutter mark and what is behind it (absent in an embed or a print: the body only). */
  book?: RegionBook;
}

const tagged = (sink: LinkTarget[] | undefined, to: LinkTarget, text: string) => (sink ? linkTag(sink.push(to) - 1) + text + LINK_END : text);

/** `owner=ada mood=meh` as the call passed them, for the region's head. */
const callWords = (props: Record<string, string[]>) => Object.entries(props).map(([k, v]) => `${k}=${v.join(",")}`).join(" ");

/**
 * What a `::use` draws (PIE-956's one output-region rule, src/output-region.ts): the template's body flush with the note's
 * text, what is wrong with the call said in the flow (the nearest name and a call that works, a prop it needs), and the
 * template's name and props behind the gutter mark, where the template's note is one click away.
 */
export function useRegion(d: UseDrawing): string[] | AfterRows {
  const dim = (text: string) => fg(C.dark) + text + RESET;
  const who = d.call.of ?? "(no template)";
  const key = `${d.host}:${d.line}`;
  const only = (...notes: string[]) => regionRows({ key, label: `::use ${who}`, body: [], notes, facts: [`::use ${who}`], controls: [], width: d.width }, d.book);
  if ((d.depth ?? 0) >= MAX_USE_DEPTH) return only(dim(`::use ${who} · nested too deep · at most ${MAX_USE_DEPTH} calls inside each other`));
  const read = useAnswer(d.src, d.host, d.line, d.site);
  if (!read || read.state === "loading") return only(dim(`::use ${who} · reading…`));
  if (read.state === "error" && !read.value) return only(fg(C.lred) + `::use ${who} · ${printable(read.error).slice(0, 200)}` + RESET);
  const answer = read.value!;
  const notes: string[] = [];
  const title = answer.template ? printable(answer.template.title) : printable(who);
  const head = `⧉ ${title}${Object.keys(answer.props).length ? ` · ${callWords(answer.props)}` : ""}`;
  const open: LinkTarget | null = answer.template ? { block: answer.template.id, role: "embed" } : null;
  // What is wrong, said where it is, with the nearest name and a call that works (a save is never refused for it).
  for (const p of answer.problems) {
    if (p.kind === "missing") continue;
    notes.push(fg(C.lred) + `⚠ ${printable(p.message).slice(0, 220)}` + RESET);
    if (p.example && p.kind !== "spec") notes.push(dim(`  for example ${printable(p.example).slice(0, 200)}`));
  }
  if (answer.missing.length) {
    const names = answer.missing.map(m => m.name).join(", ");
    const fill = "[fill it in]";
    notes.push(fg(C.yellow) + `needs ${names} ` + RESET + fg(C.lcyan) + (d.sink ? LINK_ON + tagged(d.sink, { block: d.host, role: "control", label: `fill in ${names}`, use: { block: d.host, line: d.line } }, fill) + LINK_OFF : fill) + RESET);
  }
  const draw = (body: readonly string[]) => regionRows({ key, label: title, ...(open ? { target: open } : {}), body, notes, notesFirst: true, facts: [head], controls: [], width: d.width }, d.book);
  if (!answer.template) return draw([]);
  // The template's note: kept read by the embed machinery (its text, revision and change events); its body is drawn here.
  const st = embedState(answer.template.id, undefined, d.src, d.top);
  if (st.kind === "loading") { notes.push(dim("reading the template…")); return draw([]); }
  if (st.kind === "failed") { notes.push(fg(C.lred) + `the template: ${printable(st.error).slice(0, 200)}` + RESET); return draw([]); }
  const node = st.node;
  if (node.status !== "ready" || !node.block) { notes.push(fg(C.lred) + `the template: ${printable(node.message ?? node.status).slice(0, 200)}` + RESET); return draw([]); }
  // A template with a prop missing or wrong is drawn anyway (the call is the person's to fix); the body shows what it can.
  return draw(d.body(node.block, bodySite(answer), Math.max(4, d.width)));
}
