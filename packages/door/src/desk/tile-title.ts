// What a tile is called on screen (PIE-1778): the one answer the tile bar, its tabs, a spine, the frame's title, x-ray
// and `layout.get` read. Pure over the tile and what the desk knows of its place (its name, its number, its tabs), so a
// title fix lands here and not in the desk. Addressing and links keep the tile's name; this is display only.
import { subtitleOf, valuesOf } from "@ep0ch/outline-core/block-record";
import { interpolate } from "@ep0ch/outline-core/interpolation";
import { isOutlineNote } from "../authored";
import { headedTitle, subject, type Msg } from "../board";
import { visible as visibleText } from "../style";
import { ReaderPane, type Pane } from "./panes";
import { kindOf } from "./tile-kinds";

/** The note a tile is named for: a reader's outline note, never a list that only has one selected (the river's Library, a #tag column: its border names the list). */
export function tileNote(p: Pane | undefined): Msg | null {
  return p instanceof ReaderPane && p.msg && isOutlineNote(p.msg) && !p.msg.id.startsWith("file:") && !kindOf(p)?.lists?.(p) ? p.titleNote : null;
}

/** Tile `p`'s title: a written one (`tile.title`, its `{{this.key}}` and `{{tile.n}}` filled), else its note's own name, else its own. `n` reads its number on the screen, asked only when the title says it. */
export function tileTitle(p: Pane, n: () => number): string {
  const shownNote = tileNote(p);
  const note = p.titleNote ?? shownNote ?? kindOf(p)?.shows?.(p) ?? null;
  // A note's own name, its Work ID first (PIE-1356): the tile bar, its tabs and a spine say it as the header does.
  // An embed-only note is named by the note it embeds (PIE-1458), as the reader's own answers resolve it.
  const system = p.headName?.() ?? (shownNote ? headedTitle(shownNote, p instanceof ReaderPane ? p.surface.src : null) : p.title());
  if (!p.writtenTitle || p.systemTitle) return system;
  return interpolate(p.writtenTitle, span => {
    const missing = () => span.default === undefined ? [`⚠ {{${span.expression}}}`] : undefined;
    if (span.path === "tile.kind") return [p.kind];
    if (span.path === "tile.n") return [String(n())];
    const path = span.parsed;
    if (!note || path?.head !== "this" || path.steps.length !== 1 || !("key" in path.steps[0]!)) return missing();
    const key = path.steps[0].key;
    if (key === "title") return [subject(note)];
    if (key === "subtitle") { const subtitle = subtitleOf(note); return subtitle ? [subtitle] : missing(); }
    const values = valuesOf(note, key);
    return values.length ? values : missing();
  });
}

/** Tile `p` named `name` is called what it is (its kind's word, numbered or not; a held reader named detail, detail2: the glossary's word, PIE-705). */
function plainTileName(p: Pane, name: string): boolean {
  const k = kindOf(p)?.word ?? p.kind;
  return name === k || new RegExp(`^${k}\\d+$`).test(name) || (p instanceof ReaderPane && p.kind === "reader" && /^detail\d*$/.test(name));
}

/**
 * The title on tile `p`'s frame: its title (`tileTitle`) when one is written, it shows no note or it's a tab set's;
 * else what its own title says past the note's name, its name first unless that's plain. `rows` is the tile's height.
 */
export function frameTitle(p: Pane, at: { name: string; n: () => number; tabs: number; rows?: number }): string {
  const m = tileNote(p);
  if ((p.writtenTitle && !p.systemTitle) || !m || at.tabs > 1) return tileTitle(p, at.n);
  if (at.rows !== undefined && p instanceof ReaderPane && !p.surface.titleShown(at.rows - 2, p.tileHeader)) {
    // A note that leaves its title out (PIE-1319) is named here alone, its Work ID first as everywhere (PIE-1356).
    return [p.surface.state(), headedTitle(m, p.surface.src)].filter(Boolean).join(" · ");
  }
  const own = visibleText(p.title()), sub = headedTitle(m, p instanceof ReaderPane ? p.surface.src : null);
  const rest = own.startsWith(sub) ? own.slice(sub.length).replace(/^\s*·\s*/, "") : null;
  const kindWord = kindOf(p)?.word ?? p.kind;
  const word = rest === null ? own : !rest ? kindWord : /^\d/.test(rest) ? `${kindWord} ${rest}` : rest;
  return plainTileName(p, at.name) || word === at.name ? word : `${at.name} · ${word}`;
}
