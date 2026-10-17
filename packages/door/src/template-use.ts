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
import { embedState, shade } from "./embeds";
import type { LiveSite } from "./live";
import { printable, type Source } from "./props";
import { LINK_OFF, LINK_ON, type LinkTarget } from "./refs";
import { C, ellipsize, fg, linkTag, LINK_END, RESET } from "./style";
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
}

const tagged = (sink: LinkTarget[] | undefined, to: LinkTarget, text: string) => (sink ? linkTag(sink.push(to) - 1) + text + LINK_END : text);

/** `owner=ada mood=meh` as the call passed them, for the region's head. */
const callWords = (props: Record<string, string[]>) => Object.entries(props).map(([k, v]) => `${k}=${v.join(",")}`).join(" ");

/** The lines a `::use` draws: its head, what is wrong with it, and the template's body. */
export function useRegion(d: UseDrawing): string[] {
  const S = (line: string) => shade(line, d.width);
  const dim = (text: string) => S(fg(C.dark) + text + RESET);
  const who = d.call.of ?? "(no template)";
  if ((d.depth ?? 0) >= MAX_USE_DEPTH) return [dim(`::use ${who} · nested too deep · at most ${MAX_USE_DEPTH} calls inside each other`)];
  const read = useAnswer(d.src, d.host, d.line, d.site);
  if (!read || read.state === "loading") return [dim(`::use ${who} · reading…`)];
  if (read.state === "error" && !read.value) return [S(fg(C.lred) + `::use ${who} · ${printable(read.error).slice(0, 200)}` + RESET)];
  const answer = read.value!;
  const out: string[] = [];
  const title = answer.template ? printable(answer.template.title) : printable(who);
  const head = `⧉ ${title}${Object.keys(answer.props).length ? ` · ${callWords(answer.props)}` : ""}`;
  const open: LinkTarget | null = answer.template ? { block: answer.template.id, role: "embed" } : null;
  out.push(S(fg(C.dark) + (open ? tagged(d.sink, open, ellipsize(head, Math.max(8, d.width - 2))) : ellipsize(head, Math.max(8, d.width - 2))) + RESET));
  // What is wrong, said where it is, with the nearest name and a call that works (a save is never refused for it).
  for (const p of answer.problems) {
    if (p.kind === "missing") continue;
    out.push(S(fg(C.lred) + `⚠ ${printable(p.message).slice(0, 220)}` + RESET));
    if (p.example && p.kind !== "spec") out.push(S(fg(C.dark) + `  for example ${printable(p.example).slice(0, 200)}` + RESET));
  }
  if (answer.missing.length) {
    const names = answer.missing.map(m => m.name).join(", ");
    const offer = `needs ${names} · ⏎ asks`;
    out.push(S(fg(C.yellow) + (d.sink ? LINK_ON + tagged(d.sink, { block: d.host, role: "control", label: `fill ${names}`, use: { block: d.host, line: d.line } }, offer) + LINK_OFF : offer) + RESET));
  }
  if (!answer.template) return out;
  // The template's note: kept read by the embed machinery (its text, revision and change events); its body is drawn here.
  const st = embedState(answer.template.id, undefined, d.src, d.top);
  if (st.kind === "loading") return [...out, dim("reading the template…")];
  if (st.kind === "failed") return [...out, S(fg(C.lred) + `the template: ${printable(st.error).slice(0, 200)}` + RESET)];
  const node = st.node;
  if (node.status !== "ready" || !node.block) return [...out, S(fg(C.lred) + `the template: ${printable(node.message ?? node.status).slice(0, 200)}` + RESET)];
  // A template with a prop missing or wrong is drawn anyway (the call is the person's to fix); the body shows what it can.
  for (const line of d.body(node.block, bodySite(answer), Math.max(4, d.width - 2))) out.push(S(" " + line));
  return out;
}
