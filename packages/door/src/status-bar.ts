import { buttonCallsOf, type ButtonCall } from "@ep0ch/outline-core/button-call";
import { noteCodeFences } from "@ep0ch/outline-core/component-block";
import { closest } from "@ep0ch/outline-core/tool-args";
import type { Msg } from "./board";
import type { Actor, SocketBoard } from "./socket";
import { ActionRefused, actionSet, def, type ActRequest } from "./surface/actions";
import { bg, C, fg, visible, width } from "./style";
import type { MenuRow } from "./surface/dispatch";
import type { Reveal } from "./reveal";
import { buttonText, pressState } from "./surface/button";
import type { ButtonLookWords } from "@ep0ch/outline-core/button-call";

/** Bindings name the existing ActionDefs; the dispatcher owns their execution and descriptions. */
export interface StatusItem {
  id: string;
  text: string;
  place: "left" | "right";
  before?: string;
  after?: string;
  click?: ActRequest;
  alt?: ActRequest;
  lastCell?: ActRequest;
  /** A note's `::button` (its label is `text`): drawn by the button part, in its press's state, one row high. */
  button?: { look: ButtonLookWords; line: number };
  /** How long it stays when the bar is narrow (`RANK`, PIE-1213): the lowest goes into the overflow first. */
  rank?: number;
  /** Its words when the bar is narrow (the drawer chip without what it's doing, `+3` for `+3 machine`): used before anything goes. */
  short?: string;
  /** Shorter still, taken only before a pinned item would go (the drawer chip's arrow). */
  tiny?: string;
}
export interface StatusHit { item: StatusItem; from: number; to: number }

/** Position the same records that are drawn, excluding separators and clipped or displaced text. */
export function statusHits(items: StatusItem[], from: number, limit: number): StatusHit[] {
  const hits: StatusHit[] = [];
  let x = from;
  for (const item of items) {
    x += width(item.before ?? "");
    const to = x + width(item.text);
    if (x >= 0 && to <= limit) hits.push({ item, from: x, to });
    x = to + width(item.after ?? "");
  }
  return hits;
}
export const statusText = (items: StatusItem[]) => items.map(i => (i.before ?? "") + i.text + (i.after ?? "")).join("");

/** The bar's own colours: what a drawn part that ends in RESET (a button) is followed by, so the band goes on. */
export const STATUS_INK = bg(C.blue) + fg(C.lcyan);

/** The bar's separator between items on its right. */
export const RIGHT_AFTER = ` ${fg(C.lcyan)}│ `;

/**
 * One side's items with the bar's separators where the note put an item next to one that leaves no gap: on the left, an
 * item after one with no `after` (the location) is set off by `│`; on the right, every item but the last ends in `│` and
 * the last in a space, so a button pinned after the clock reads `16:12 │ Collapse`.
 */
export function separated(items: StatusItem[], side: "left" | "right"): StatusItem[] {
  if (side === "left") return items.map((item, i) => i > 0 && !items[i - 1]!.after && !item.before ? { ...item, before: " │ " } : item);
  return items.map((item, i) => i === items.length - 1 ? { ...item, after: " " } : (item.after ?? "").includes("│") ? item : { ...item, after: RIGHT_AFTER });
}

/** One entry of the status-bar note as read: a built-in by id, a button, or a group of entries; `line` is its line (from 0). */
export type StatusEntry =
  | { kind: "builtin"; id: string; line: number }
  | { kind: "button"; call: ButtonCall; line: number }
  | { kind: "group"; label: string; line: number; children: StatusEntry[] };
/** A line the reader skipped: its line (from 0) and what's wrong with it, with what to write instead. */
export interface StatusProblem { line: number; message: string }

const LIST_ITEM = /^(\s*)(?:[-*+]|\d{1,9}[.)])\s+(.*?)\s*$/;
const indentOf = (line: string) => /^\s*/.exec(line)![0].length;

/**
 * The status-bar note as a list (PIE-1224, PIE-1227): each top-level item is an item on the bar (`- <built-in id>`, a
 * `::button` on its own line or in a list item), and an item with items nested under it is a group, its children a menu.
 * Capture first: a line it can't read is skipped and said (with a did-you-mean), and the rest is the bar as written.
 */
export function readStatusNote(text: string, builtinIds: readonly string[]): { entries: StatusEntry[]; problems: StatusProblem[] } {
  const lines = text.split("\n");
  const skip = new Set<number>();
  for (const f of noteCodeFences(lines)) for (let i = f.start; i <= f.end; i++) skip.add(i);
  const problems: StatusProblem[] = [];
  // An HTML comment (the made note's commented example) is no line of the bar, over as many lines as it runs; one that
  // never closes hides only its own line, and says so (the lines after it stay on the bar).
  for (let i = 1; i < lines.length; i++) {
    if (skip.has(i) || !lines[i]!.trimStart().startsWith("<!--")) continue;
    let j = i;
    while (j < lines.length && !lines[j]!.includes("-->")) j++;
    if (j === lines.length) { skip.add(i); problems.push({ line: i, message: "this <!-- comment never closes: end it with --> (the lines after it are read)" }); continue; }
    for (let k = i; k <= j; k++) skip.add(k);
    i = j;
  }
  const buttons = new Map(buttonCallsOf(text).map(b => [b.line, b]));
  const content = (i: number) => !skip.has(i) && !!lines[i]!.trim();
  const entries: StatusEntry[] = [];
  const labels = new Map<string, number>(), listed = new Map<string, number>();
  // The open groups, innermost last: an item goes into the last one it is indented under.
  const stack: { indent: number; children: StatusEntry[] }[] = [{ indent: -1, children: entries }];
  const place = (indent: number, entry: StatusEntry) => {
    while (stack.length > 1 && stack.at(-1)!.indent >= indent) stack.pop();
    stack.at(-1)!.children.push(entry);
  };
  const problem = (i: number, message: string) => problems.push({ line: i, message });
  for (let i = 1; i < lines.length; i++) {
    if (!content(i)) continue;
    const line = lines[i]!, indent = indentOf(line), button = buttons.get(i);
    if (button) {
      const end = button.endLine;
      if (button.act === null) problem(i, button.problem ?? "this ::button runs nothing");
      else {
        const key = button.label.toLowerCase(), first = labels.get(key);
        if (first !== undefined) problem(i, `duplicate label="${button.label}"; line ${first + 1} already has it; choose a different label=`);
        else { labels.set(key, i); place(indent, { kind: "button", call: button, line: i }); }
      }
      i = end;
      continue;
    }
    const item = LIST_ITEM.exec(line);
    if (item) {
      const word = item[2]!;
      let next = i + 1;
      while (next < lines.length && !content(next)) next++;
      // Items nested under it make it a group, whatever its words.
      if (next < lines.length && indentOf(lines[next]!) > indent && (LIST_ITEM.test(lines[next]!) || buttons.has(next))) {
        const group: StatusEntry = { kind: "group", label: word, line: i, children: [] };
        place(indent, group);
        stack.push({ indent, children: group.children });
      } else if (builtinIds.includes(word)) {
        // One place each: the bar knows a built-in by its id.
        const first = listed.get(word);
        if (first !== undefined) problem(i, `- ${word} is already on line ${first + 1}; a built-in sits in one place`);
        else { listed.set(word, i); place(indent, { kind: "builtin", id: word, line: i }); }
      } else {
        const near = closest(word, builtinIds);
        problem(i, near ? `no built-in "${word}"; did you mean - ${near}?` : `no built-in "${word}"; status.bar.items lists their ids, or nest items under it for a group`);
      }
      continue;
    }
    const bare = line.trim(), near = builtinIds.includes(bare) ? bare : closest(bare, builtinIds);
    problem(i, near ? `"${bare}" isn't a list item; did you mean - ${near}?` : 'use - <built-in id>, a ::button{label="Collapse" act="tile.collapse tile=screen"}, or nested items for a group');
  }
  return { entries, problems: problems.sort((a, b) => a.line - b.line) };
}

/** Ranks on the bar (PIE-1213): what the person pinned outlasts a built-in they listed, which outlasts one nobody listed. */
export const RANK = { builtin: 0, listed: 1, pinned: 2 } as const;

/** The note is ordinary outline content: edits, trash and reconnects all read it through the service. */
export class StatusBarNote {
  note: Msg | null = null;
  private read: { entries: StatusEntry[]; problems: StatusProblem[] } | null = null;
  private reading: Promise<void> | null = null;
  private stale = false;
  private said = "";
  constructor(private board: SocketBoard, private changed: () => void, private warn: (text: string) => void) {}

  /** The lines the reader skipped, with what to write (PIE-1227): shown on the bar as one `!` item. */
  get problems(): readonly StatusProblem[] { return this.read?.problems ?? []; }

  refresh(builtins: StatusItem[]): Promise<void> {
    this.stale = true;
    if (this.reading) return this.reading;
    this.reading = (async () => {
      try {
        while (this.stale) {
          this.stale = false;
          try {
            const notes = await this.board.byProp("status-bar", "true");
            if (notes.length > 1) throw new Error(`more than one [status-bar::true] note: ${notes.map(n => n.id).join(", ")}; keep the property on one`);
            this.note = notes[0] ?? null;
            this.read = this.note ? readStatusNote(this.note.text, builtins.map(b => b.id)) : null;
            // Said once for each set of skipped lines: the bar's `!` item keeps showing it until the line is fixed.
            const text = this.read?.problems.length ? `Status bar: skipped ${this.read.problems.map(p => `line ${p.line + 1}: ${p.message}`).join("; ")}` : "";
            if (text && text !== this.said) this.warn(text);
            this.said = text;
          } catch (e) {
            this.read = null;
            const text = `Status bar: ${e instanceof Error ? e.message : String(e)}`;
            if (text !== this.said) this.warn(text);
            this.said = text;
          }
          this.changed();
        }
      } finally {
        // Release before resolving: the next microtask must not join a reader whose loop has already ended.
        this.reading = null;
      }
    })();
    return this.reading;
  }

  /** A note entry as a bar item (a group draws its label and opens its children); built-ins are read live. */
  private itemOf(entry: StatusEntry, builtins: StatusItem[], place: "left" | "right", path: string[]): StatusItem | null {
    const after = place === "right" ? RIGHT_AFTER : " │ ";
    if (entry.kind === "builtin") { const b = builtins.find(x => x.id === entry.id); return b ? { ...b, rank: RANK.listed } : null; }
    if (entry.kind === "group") return { id: `group:${entry.line}`, text: `${entry.label} ${fg(C.yellow)}▲${fg(C.lcyan)}`, place, after, rank: RANK.pinned, click: { action: "status.bar.menu", args: { group: [...path, entry.label].join("/") } } };
    const b = entry.call, line = entry.line, note = this.note!.id;
    const text = buttonText(b.label, { ...b.look, ...pressState(note, line, b.label) }) + STATUS_INK;
    return { id: `button:${line}`, text, place, after, rank: RANK.pinned, button: { look: b.look, line },
      click: { action: "button.press", args: { note, label: b.label, line: line + 1 } }, ...(b.alt ? { alt: { action: "button.press", args: { note, label: b.label, line: line + 1, alt: true } } } : {}) };
  }

  items(builtins: StatusItem[]): StatusItem[] {
    if (!this.read) return builtins;
    // Built-in state changes independently of edits (recording, waiting, drawer, time).
    const out: StatusItem[] = [];
    for (const entry of this.read.entries) {
      // A button or a group sits where its line is: after the item above it in the note, on that item's side of the bar.
      const place = entry.kind === "builtin" ? builtins.find(b => b.id === entry.id)?.place ?? "left" : out.at(-1)?.place ?? "left";
      const item = this.itemOf(entry, builtins, place, []);
      if (item) out.push(item);
    }
    // A skipped line says so on the bar itself, after the left side's items: a click opens the note at that line.
    const bad = this.read.problems[0];
    if (bad) {
      const at = out.findLastIndex(i => i.place === "left") + 1;
      const more = this.read.problems.length > 1 ? ` +${this.read.problems.length - 1}` : "";
      out.splice(at, 0, { id: "problems", text: `${fg(C.yellow)}! line ${bad.line + 1}${more}${fg(C.lcyan)}`, place: "left", after: " │ ", rank: RANK.pinned, click: { action: "status.bar.edit", args: { line: bad.line + 1 } } });
    }
    return out;
  }

  /** The group at `path` (its labels from the bar, `/` between): its children as items, for its menu. */
  group(path: string, builtins: StatusItem[]): { label: string; items: StatusItem[] } {
    const names = path.split("/").map(n => n.trim()).filter(Boolean);
    if (!names.length) throw new ActionRefused("name a group: group=<its label>, or overflow=true for what the bar has no room for");
    let entries = this.read?.entries ?? [], label = "";
    const labels: string[] = [];
    for (let n = 0; n < names.length;) {
      // A label may hold a `/` itself (`- Build/Test`): the longest run of names that is one group's label wins.
      let k = names.length, g: Extract<StatusEntry, { kind: "group" }> | undefined;
      for (; k > n && !g; k--) {
        const want = names.slice(n, k).join("/").toLowerCase();
        g = entries.find((e): e is Extract<StatusEntry, { kind: "group" }> => e.kind === "group" && e.label.split("/").map(x => x.trim()).join("/").toLowerCase() === want);
      }
      if (!g) {
        const here = entries.filter(e => e.kind === "group").map(e => (e as { label: string }).label);
        throw new ActionRefused(`no group "${names[n]}"${n ? ` in ${labels.join("/")}` : " on the status bar"}${here.length ? `; its groups: ${here.join(", ")}` : ""}`);
      }
      entries = g.children; label = g.label; labels.push(g.label); n = k + 1;
    }
    return { label, items: entries.flatMap(e => this.itemOf(e, builtins, "left", labels) ?? []) };
  }

  async ensure(builtins: StatusItem[], actor: Actor): Promise<Msg> {
    await this.refresh(builtins);
    if (this.note) return this.note;
    this.note = await this.board.createBlock(null, [
      "Your status bar [status-bar::true]", "", ...builtins.map(i => `- ${i.id}`), "",
      '<!-- ::button{label="Collapse" act="tile.collapse tile=screen"} -->',
      "<!-- A group: - Tools, with - theme or - ::button{…} items indented under it, opens them as a menu -->",
    ].join("\n"), actor);
    await this.refresh(builtins);
    return this.note!;
  }

  async pin(line: string, builtins: StatusItem[], actor: Actor) {
    const button = buttonCallsOf(line).find(b => b.act);
    if (!button) throw new ActionRefused("pin a ::button line with act= or of=");
    const note = await this.ensure(builtins, actor);
    // The bar's own reading (in a group, not in a comment): what the note would press.
    const calls = (es: StatusEntry[]): ButtonCall[] => es.flatMap(e => (e.kind === "button" ? [e.call] : e.kind === "group" ? calls(e.children) : []));
    const duplicate = calls(readStatusNote(note.text, builtins.map(b => b.id)).entries).find(b => b.label.toLowerCase() === button.label.toLowerCase());
    if (duplicate) throw new ActionRefused(`line ${duplicate.line + 1} already has label="${duplicate.label}"; choose a different label=`);
    const updated = await this.board.update(note.id, `${note.text}\n${line}`, note.revision!, actor);
    await this.refresh(builtins);
    return { note: updated.id };
  }
}

const pathOf = (p: string) => p.split("/").map(x => x.trim()).join("/").toLowerCase();
/**
 * The bar's group a menu for group path `path` opens from: that group, or the outer group it is nested in (`Tools` for
 * `Tools/More`, PIE-1415: an inner group isn't on the bar, so its menu stands where its outer group's did). Case and the
 * spaces around a `/` aside.
 */
const opensFrom = (bar: string, path: string) => { const a = pathOf(bar), b = pathOf(path); return a === b || b.startsWith(`${a}/`); };

/** A bar item as a menu row: its words, and what a click on it runs. */
export function menuRowOf(item: StatusItem, group: string): MenuRow {
  const label = visible(item.text).trim() || item.id;
  return item.click
    ? { action: item.click.action, args: item.click.args ?? {}, tile: item.click.tile ?? "", label, group, ...(item.click.action === "status.bar.menu" && item.click.args?.group !== undefined ? { submenu: true as const } : {}) }
    : { action: "status.log", args: {}, tile: "", label, group, refused: `${label} does nothing on a click` };
}

interface StatusOn {
  note: StatusBarNote;
  builtins(): StatusItem[];
  items(): unknown;
  /** What the bar had no room for, in its order (the `+N` chip's). */
  hidden(): StatusItem[];
  open(id: string, actor: Actor, reveal?: Reveal): Promise<unknown>;
  /**
   * Show the person a menu of `rows` over the screen, above the bar's item `anchor` picks; false when no screen can hold one.
   * `group`: the group's path (Tools/More): a nested group's menu opens beside its parent's, which stays open (PIE-1428).
   */
  menu(title: string, rows: MenuRow[], anchor: (item: StatusItem) => boolean, group?: string): boolean;
  flash(text: string): void;
}
export const STATUS_BAR_ACTIONS = actionSet<StatusOn>()("status bar", {
  "status.bar.items": def({
    summary: "describe the status bar's declared items, their current text, place, click and alternate ActionDefs, and visible hit boxes; ids also name the built-ins in your [status-bar::true] note",
    touches: "nothing", replay: "safe", args: {},
    run(_, on) { return on.items(); },
  }),
  "status.bar.edit": def({
    summary: "status bar: edit your [status-bar::true] note; made on first use with today's built-ins and a commented Collapse button. Order or hide built-ins with - <id> lines; ::button lines (or - ::button items) pin actions; alt= names their alternate action; items nested under one make a group, a menu on the bar. A line it can't read is skipped and shown as the bar's ! item; line= opens the note there. Edits redraw the bar live",
    keys: [{ keys: "right-click alt-click", does: "on an empty part of the status bar" }, { keys: "click", does: "on its ! item" }, { via: "the power bar's status bar: edit" }],
    touches: "nothing", replay: "ask",
    args: { line: { type: "number", optional: true, about: "the note's line to open it at (1 is the title): the bar's ! item gives its first skipped line" } },
    examples: [
      { act: "status.bar.edit", does: "opens your status-bar note, making it with today's built-ins if it's new" },
      { act: "status.bar.edit line=21", does: "opens it at line 21, the line the bar's ! item names" },
    ],
    async run({ line }, on, actor) {
      const note = await on.note.ensure(on.builtins(), actor);
      const lines = note.text.split("\n"), n = line && line >= 1 && line <= lines.length ? line - 1 : null;
      const why = n === null ? undefined : on.note.problems.find(p => p.line === n)?.message;
      await on.open(note.id, actor, n === null ? undefined : { at: lines.slice(0, n).reduce((a, l) => a + l.length + 1, 0), ...(why ? { says: why } : {}) });
      return { note: note.id, ...(n === null ? {} : { line: n + 1 }) };
    },
  }),
  "status.bar.menu": def({
    summary: "open a status-bar group's items as a menu (group=<label>, nested groups as Tools/More), or with overflow=true what the bar has no room for (its +N chip). The person's opens over the screen, each row runs that item's click; an agent's answers the rows (label, action, args) without opening anything",
    keys: [{ keys: "click", does: "on a status-bar group or on its +N overflow chip" }],
    touches: "nothing", replay: "safe",
    args: {
      group: { type: "string", optional: true, about: "the group's label as the bar shows it; Outer/Inner for a nested group" },
      overflow: { type: "boolean", optional: true, about: "the items the bar has no room for now" },
    },
    answer: { title: { type: "string", about: "the menu's title" }, rows: { type: "array", about: "each item: label, action and args a click runs (refused: why it can't)" } },
    examples: [
      { act: "status.bar.menu group=Tools", does: "the items nested under - Tools in your status-bar note" },
      { act: "status.bar.menu overflow=true", does: "what the narrow bar put in its +N chip" },
    ],
    run({ group, overflow }, on, actor) {
      const g = overflow ? { label: "not shown: no room", items: on.hidden() } : on.note.group(group ?? "", on.builtins());
      const rows = g.items.map(i => menuRowOf(i, g.label));
      // The overflow also opens the note, where the bar is arranged.
      if (overflow) rows.push({ action: "status.bar.edit", args: {}, tile: "", label: "edit the status bar", group: "the bar" });
      const title = overflow ? "status bar" : g.label, answer = { title, rows: rows.map(({ tile: _t, group: _g, ...r }) => r) };
      if (actor.kind === "agent") return answer;
      if (!on.menu(title, rows, i => (overflow ? i.id === "overflow" : i.click?.action === "status.bar.menu" && opensFrom(String(i.click.args?.group ?? ""), group ?? "")), overflow ? undefined : pathOf(group ?? ""))) on.flash(`${title}: ${rows.map(r => r.label).join(" · ")}`);
      return answer;
    },
  }),
  "status.bar.pin": def({
    words: "pin a note's line to the status bar",
    summary: "pin a ::button line to your status bar, appending it to the [status-bar::true] note; made on first use, with the existing bar's items",
    touches: "nothing", replay: "ask",
    args: { line: { type: "string", about: "the ::button line to append" } },
    examples: [{ act: 'status.bar.pin line=\'::button{label="Collapse" act="tile.collapse tile=screen"}\'', does: "pins Collapse to your status bar" }],
    run({ line }, on, actor) { return on.note.pin(line, on.builtins(), actor); },
  }),
});
