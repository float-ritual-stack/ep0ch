// The panels the reader draws under an element or into its body, as pure functions of what they show: a step's status
// choice and a callout's type choice (the choice open under an element), a comment thread's card with its controls,
// and the rows they're put into the body with (withRows, rowsOfLines). The reader (note.ts) keeps their state.
import type { CalloutRef } from "../refs";
import type { CalloutRegistry } from "@ep0ch/outline-core/callouts";
import type { SurfaceHost } from "./note";
import { C, drawEllipsized, fg, type LinkRange, pad, RESET, width } from "../style";
import { ITEM_BG } from "./selection";
import { LINE_BOX, stringFrame } from "../canvas";
import { ListPicker } from "./picker";
import { STEP_BOXES, type StepRef, stepTitle } from "../steps";
import { TONE } from "../callouts";
import { ago, wrap } from "../text";
import { authorName, type Comment } from "../socket";
import { buttonText } from "./button";
import { calloutTitle } from "./link-model";
import { cardBg, kindOf, onCard } from "./margin";
import { chooseKeys, hintOf, rk } from "./attached-keys";
import { codeSpans, type Doc, type DocImage } from "../doc";
import { editedMark } from "../comment";
import { printable } from "../props";

/**
 * The controls of a comment thread expanded inline (PIE-420): Select, Reply, Seen (or Bring back), Keep (or Unkeep), TL;DR;
 * Quote (the thread's mark, or a reply's: `value` names the reply); a "quoted in" line opens the block quoting it.
 */
export type ThreadControl = "select" | "reply" | "edit" | "seen" | "keep" | "tldr" | "untldr" | "toggle" | "card" | "quote" | "quoted";
/** A thread control where the last render drew it: its body row, and columns in the body's own cells (no margin). */
export interface Control { thread: string; control: ThreadControl; row: number; from: number; to: number; label: string; value?: string }
/**
 * The choice open under an element: a step's status (PIE-472) or a callout's type (PIE-538). The element (its key),
 * the choices as a list picker, what the last choice said. The person's alone (an agent sets a status by `task.status`).
 */
export interface Choice { id: string; label: string; key: string }
export interface Picker { key: string; kind?: "callout"; list: ListPicker<Choice, SurfaceHost>; note: string; busy: boolean; types?: CalloutRegistry }
/**
 * A step's status choice (PIE-472), `W` cells wide: Detail's choices in its order, each with its key, the
 * one the keys are on lit, the step's current status marked, and what the last choice said.
 */
export function pickerPanel(ref: StepRef, choices: readonly Choice[], sel: number, note: string, busy: boolean, W: number): { lines: string[]; rows: number[] } {
  const edge = fg(C.yellow), inner = Math.max(8, W - 2), f = stringFrame(W, { glyphs: LINE_BOX, ink: edge, pad: 0, open: true });
  const lines = [f.top(fg(C.white) + ` ${STEP_BOXES[ref.step.status]} ${printable(stepTitle(ref.step))} `)];
  const rows: number[] = [];
  // The list's own choices (on a live row, each says what it writes): the panel draws them, never a second copy.
  choices.forEach((c, i) => {
    const now = (c.id === ref.step.status ? " · now" : "");
    const text = pad(` ${c.label}${now}`, Math.max(1, inner - 3)) + ` ${c.key} `;
    rows.push(lines.length);
    lines.push(f.row((i === sel ? ITEM_BG + fg(C.white) : fg(C.lcyan)) + pad(text, inner)));
  });
  if (note) lines.push(f.row(fg(busy ? C.dark : C.lred) + pad(` ${printable(note)}`, inner)));
  const foot = ` ${hintOf(chooseKeys("task.status").slice(2))}${ref.via ? ` · in ${ref.via}` : ""} `;
  lines.push(f.bottom(fg(C.dark) + foot));
  return { lines, rows };
}

/**
 * A callout's type choice (PIE-538), `W` cells wide: the outline's types (the one list, src/callouts.ts), each with its
 * icon in its tone and its other names, its type now marked; then whether it starts folded or open, the `-` or `+`.
 */
export function calloutPanel(ref: CalloutRef, P: Picker, W: number): { lines: string[]; rows: number[] } {
  const edge = fg(C.yellow), inner = Math.max(8, W - 2), types = P.types!, f = stringFrame(W, { glyphs: LINE_BOX, ink: edge, pad: 0, open: true });
  const now = types.resolve(ref.type)?.name ?? ref.type;
  const lines = [f.top(fg(C.white) + ` [!${printable(ref.type)}] ${printable(calloutTitle(ref))} `)];
  // Every choice drawn, as the step choice draws its own, so each is a click away; the reader brings the panel into
  // view when it opens, and scrolls (the wheel) over a tall one.
  const items = P.list.items, rows: number[] = [];
  items.forEach((c, i) => {
    const t = c.id.startsWith("type:") ? types.resolve(c.id.slice(5)) : null;
    const on = i === P.list.sel, base = on ? ITEM_BG + fg(C.white) : fg(C.lcyan);
    const icon = t ? (on ? "" : fg(TONE[t.tone])) + t.icon + base + " " : "  ";
    // "now" next to the name, before the aliases a narrow reader cuts.
    const mark = t?.name === now ? " · now" : "";
    const label = t ? `${t.name}${mark}${t.aliases.length ? ` · ${t.aliases.join(", ")}` : ""}${t.block ? " · this outline's" : ""}` : c.label;
    rows.push(lines.length);
    lines.push(f.row(base + " " + icon + pad(label, Math.max(1, inner - 3 - (c.key ? 3 : 0))) + (c.key ? ` ${c.key} ` : "")));
  });
  if (P.note) lines.push(f.row(fg(P.busy ? C.dark : C.lred) + pad(` ${printable(P.note)}`, inner)));
  const foot = ` ${hintOf([...chooseKeys("callout.type").slice(2, 3), rk("-", "callout.start", "folded", { folded: true }), rk("+", "callout.start", "open"), ...chooseKeys("callout.type").slice(3)])} `;
  lines.push(f.bottom(fg(C.dark) + foot));
  return { lines, rows };
}

/** A thread control's element key: stable across renders while its thread stays expanded. */
export const controlKey = (thread: string, c: ThreadControl, value?: string) => `ctl:${thread}:${c}${value ? `:${value}` : ""}`;
/**
 * A comment thread drawn under its passage (PIE-420), `W` cells wide: who and when, open or resolved, the
 * comment and its replies, and the Select, Reply and Resolve (or Reopen) controls, the current one lit.
 * Controls' rows and columns are the panel's own (no margin).
 */
export function threadPanel(c: Comment, W: number, cur: string | null, drawDoc?: (text: string, width: number) => string[] | { lines: string[]; images?: DocImage[]; links?: LinkRange[] }, trim = false): { lines: string[]; bg: string; controls: Control[]; images: DocImage[]; links: LinkRange[] } {
  // Its pictures (PIE-846), on the panel's own rows: `col` cells in from the panel's left.
  const images: DocImage[] = [];
  const links: LinkRange[] = [];
  const draw = drawDoc && ((text: string, w: number, col = 2, interactive = true): string[] => {
    const r = drawDoc(text, w);
    if (Array.isArray(r)) return r;
    if (interactive) for (const l of r.links ?? []) links.push({ ...l, line: lines.length + l.line, from: col + l.from, to: col + l.to });
    for (const im of r.images ?? []) images.push({ ...im, line: lines.length + im.line, col: col + im.col });
    return r.lines;
  });
  const edge = fg(c.open ? C.yellow : C.dark), bg = cardBg(c.props);
  const inner = Math.max(4, W - 2);
  const n = c.replies.length;
  const title = ` ${kindOf(c)} · ${c.open ? "■" : "·"} ${printable(authorName(c.author))} · ${ago(c.at)}${editedMark(c)} · ${c.lifecycle}${n ? ` · ${n} repl${n === 1 ? "y" : "ies"}` : ""} `;
  const f = stringFrame(W, { glyphs: LINE_BOX, ink: edge, open: true });
  const lines = [f.top(fg(c.open ? C.white : C.grey) + title, fg(C.lcyan) + "[–]")];
  const text = (s: string, w: number) => printable(s.replace(/\t/g, " "), "", { lines: true }).split("\n").flatMap(l => (l ? wrap(l, w) : [""]));
  // The body and replies as the reader draws a note (PIE-770): references by title, embeds transcluded; else as typed.
  const body = (s: string, w: number, col = 2) => (draw ? draw(s, w, col) : text(s, w));
  if (trim) {
    const summary = c.tldr ? `TL;DR ${c.tldr.body}` : c.replies.at(-1)?.body ?? c.body;
    lines.push(edge + "│ " + fg(C.grey) + drawEllipsized(body(summary, inner).join(" "), inner) + RESET);
    return { lines: lines.map(l => onCard(l, W, bg)), bg, images: [], links: [], controls: [
      { thread: c.id, control: "toggle", row: 0, from: W - 3, to: W, label: "Fold thread" },
      { thread: c.id, control: "card", row: 0, from: 0, to: W - 3, label: "Open thread" },
      { thread: c.id, control: "card", row: 1, from: 0, to: W, label: "Open thread" },
    ] };
  }
  // Its TL;DR first: the thread's face, the discussion under it.
  if (c.tldr) for (const l of body(`TL;DR ${c.tldr.body}`, inner)) lines.push(edge + "│ " + fg(C.lgreen) + l + RESET);
  for (const l of body(c.body, inner)) lines.push(edge + "│ " + fg(c.open ? C.white : C.grey) + l + RESET);
  if (c.start === null && c.quote) lines.push(edge + "│ " + fg(C.brown) + "(the quoted words moved; the service couldn't place them)" + RESET);
  const controls: Control[] = [{ thread: c.id, control: "toggle", row: 0, from: W - 3, to: W, label: "Fold thread" }];
  // Where a mark was quoted (quote): a line each, opening the block that quotes it.
  const quotedIn = (ids: readonly string[] | undefined, indent: string) => {
    for (const id of ids ?? []) {
      const said = `quoted in ${draw ? (draw(`((${id}))`, Math.max(4, inner - 12), 2, false)[0] ?? "") : id.slice(0, 8)}`;
      const shown = drawEllipsized(said, Math.max(4, inner - indent.length));
      const on = cur === controlKey(c.id, "quoted", id);
      controls.push({ thread: c.id, control: "quoted", value: id, row: lines.length, from: 2 + indent.length, to: 2 + indent.length + width(shown), label: "quoted in" });
      lines.push(edge + "│ " + indent + (on ? ITEM_BG + fg(C.white) : fg(C.lcyan)) + shown + RESET);
    }
  };
  quotedIn(c.quotedIn, "");
  // A TL;DR is shown once, as the face above (PIE-860): its reply (and any it replaced) isn't listed again under it.
  for (const r of c.replies.filter(x => !x.tldr)) {
    // Each reply is a mark too: its own [Quote].
    // Each reply is a mark too: its own [Edit] (PIE-763) and [Quote].
    const stamp = " · " + ago(r.at) + editedMark(r);
    const head = "└ " + drawEllipsized(printable(authorName(r.author)), Math.max(1, inner - 2 - width(stamp))) + stamp;
    let row = edge + "│ " + fg(C.cyan) + drawEllipsized(head, inner) + RESET, col = 2 + Math.min(width(head), inner);
    for (const [k, q, label] of [["edit", "[Edit]", "Edit the reply"], ["quote", "[Quote]", "Quote the reply"]] as const) {
      if (col + 1 + q.length > W) { lines.push(row); row = edge + "│ "; col = 2; }
      controls.push({ thread: c.id, control: k, value: r.id, row: lines.length, from: col + 1, to: col + 1 + q.length, label });
      row += " " + (cur === controlKey(c.id, k, r.id) ? ITEM_BG + fg(C.white) : fg(C.lcyan)) + q + RESET;
      col += 1 + q.length;
    }
    lines.push(row);
    for (const l of body(r.body, Math.max(2, inner - 2), 4)) lines.push(edge + "│ " + fg(C.cyan) + "  " + RESET + l + RESET);
    quotedIn(r.quotedIn, "  ");
  }
  // The controls on one row, or as many as a narrow reader needs: each is whole, never cut off.
  let row = edge + "│ ", col = 2;
  // A thread on the whole note has no words to select (PIE-846).
  // With a TL;DR: edit it, ask for it again, or take it away (PIE-860).
  const all: [ThreadControl, string, string?][] = [
    ...(isWholeNote(c) ? [] : [["select", "Select"] as [ThreadControl, string]]), ["reply", "Reply"], ...(c.body.trim() ? [["edit", "Edit"] as [ThreadControl, string]] : []),
    ["seen", c.open ? "Seen" : "Bring back"], ["keep", c.lifecycle === "kept" ? "Unkeep" : "Keep"],
    ...(c.tldr ? [["edit", "Edit TL;DR", c.tldr.id], ["tldr", "TL;DR again"], ["untldr", "No TL;DR"]] as [ThreadControl, string, string?][] : [["tldr", "TL;DR"] as [ThreadControl, string]]),
    ["quote", "Quote"],
  ];
  all.forEach(([k, label, value]) => {
    const shown = `[${label}]`, on = cur === controlKey(c.id, k, value);
    if (col > 2 && col + 3 + shown.length > W) { lines.push(row + RESET); row = edge + "│ "; col = 2; }
    if (col > 2) { row += fg(C.dark) + " · "; col += 3; }
    row += on ? ITEM_BG + fg(C.white) + shown + RESET : buttonText(label);
    controls.push({ thread: c.id, control: k, row: lines.length, from: col, to: col + shown.length, label, ...(value ? { value } : {}) });
    col += shown.length;
  });
  lines.push(row + RESET, f.bottom());
  return { lines: lines.map(l => onCard(l, W, bg)), bg, controls, images, links };
}
/**
 * `doc` with rows put in: each insert's `lines` before body row `at` (in order, for the same `at`), drawn
 * from no note line (source -1), so selection, focus and fold lookups pass over them. Links, images,
 * media rows and fold heads move down with the rows under them. `starts[i]`: where insert i landed.
 * `inserts`' `images` (on their own rows) go with them: a thread's panel, a comment's box.
 */
export function withRows(doc: Doc, inserts: readonly { at: number; lines: readonly string[]; images?: readonly DocImage[]; links?: readonly LinkRange[] }[]): { doc: Doc; starts: number[] } {
  const order = inserts.map((p, i) => ({ ...p, i })).sort((a, b) => a.at - b.at || a.i - b.i);
  const starts: number[] = [], lines: string[] = [], source: number[] = [], moved: number[] = [];
  let k = 0;
  for (let r = 0; r <= doc.lines.length; r++) {
    for (; k < order.length && order[k]!.at <= r; k++) { starts[order[k]!.i] = lines.length; for (const l of order[k]!.lines) { lines.push(l); source.push(-1); } }
    if (r < doc.lines.length) { moved[r] = lines.length; lines.push(doc.lines[r]!); source.push(doc.source[r]!); }
  }
  const mv = (r: number) => (r < doc.lines.length ? moved[r]! : r + lines.length - doc.lines.length);
  return {
    doc: {
      lines, source,
      links: [...doc.links.map(l => ({ ...l, line: mv(l.line) })), ...inserts.flatMap((p, i) => (p.links ?? []).map(l => ({ ...l, line: starts[i]! + l.line })))],
      images: [...doc.images.map(im => ({ ...im, line: mv(im.line) })), ...inserts.flatMap((p, i) => (p.images ?? []).map(im => ({ ...im, line: starts[i]! + im.line })))],
      media: doc.media.map(x => ({ ...x, row: mv(x.row) })),
      parts: doc.parts?.map(p => ({ ...p, row: mv(p.row), ...(p.rows ? { rows: mv(p.row + p.rows - 1) + 1 - mv(p.row) } : {}) })),
      heads: doc.heads.map(h => ({ ...h, row: mv(h.row), ...(h.rows ? { rows: mv(h.row + h.rows - 1) + 1 - mv(h.row) } : {}) })),
      ...(doc.regions ? { regions: doc.regions.map(r => ({ ...r, row: mv(r.row), rows: mv(r.row + r.rows - 1) + 1 - mv(r.row) })) } : {}),
      trims: new Map([...doc.trims].map(([r, t]) => [mv(r), t])),
      // A block that rows were put inside (a thread under a quote's passage) grows with them.
      blocks: [
        ...doc.blocks.map(b => ({ ...b, row: mv(b.row), rows: mv(b.row + b.rows - 1) + 1 - mv(b.row), ...(b.cells ? { cells: b.cells.map(c => ({ ...c, row: mv(c.row) })) } : {}) })),
        ...inserts.flatMap((p, i) => codeSpans(p.lines, p.lines.map(() => -1)).map(b => ({
          ...b, row: starts[i]! + b.row, cells: b.cells!.map(c => ({ ...c, row: starts[i]! + c.row })),
        }))),
      ],
    },
    starts,
  };
}
/** The body rows [from, to) drawn from note lines `lo` to `hi` (from 0, the subject), or null when none is drawn. */
export function rowsOfLines(doc: Doc, noteLines: number[], lo: number, hi: number): [number, number] | null {
  let a = -1, b = -1;
  doc.source.forEach((s, r) => { const l = noteLines[s]; if (l !== undefined && l >= lo && l <= hi) { if (a < 0) a = r; b = r; } });
  return a < 0 ? null : [a, b + 1];
}

/** A thread on the whole note (PIE-846): no passage was ever quoted (one whose quoted words moved still has its quote). */
export const isWholeNote = (c: Pick<Comment, "start" | "quote">) => c.start === null && !c.quote;
