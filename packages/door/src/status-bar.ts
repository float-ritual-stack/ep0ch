import { buttonCallsOf } from "@ep0ch/outline-core/button-call";
import { noteCodeFences } from "@ep0ch/outline-core/component-block";
import type { Msg } from "./board";
import type { Actor, SocketBoard } from "./socket";
import { ActionRefused, actionSet, def, type ActRequest } from "./surface/actions";
import { bg, C, fg, width } from "./style";
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

/** The note is ordinary outline content: edits, trash and reconnects all read it through the service. */
export class StatusBarNote {
  note: Msg | null = null;
  private lines: StatusItem[] | null = null;
  private reading: Promise<void> | null = null;
  private stale = false;
  private said = "";
  private duplicateWarnings = new Set<string>();
  constructor(private board: SocketBoard, private changed: () => void, private warn: (text: string) => void) {}

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
            this.lines = this.note ? this.read(this.note, builtins) : null;
            this.said = "";
          } catch (e) {
            this.lines = null;
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

  private read(note: Msg, builtins: StatusItem[]): StatusItem[] {
    const lines = note.text.split("\n"), buttons = buttonCallsOf(note.text);
    const fenced = new Set<number>();
    for (const f of noteCodeFences(lines)) for (let i = f.start; i <= f.end; i++) fenced.add(i);
    const out: StatusItem[] = [];
    const labels = new Map<string, number>();
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]!;
      if (fenced.has(i) || !line.trim() || line.trimStart().startsWith("<!--")) continue;
      const id = /^\s*-\s+(\S+)\s*$/.exec(line)?.[1];
      const button = buttons.find(b => b.line === i);
      if (id) {
        const builtin = builtins.find(b => b.id === id);
        if (!builtin) throw new Error(`line ${i + 1}: no built-in "${id}"; status.bar.items lists their ids`);
        out.push(builtin);
      } else if (button) {
        if (button.act === null) throw new Error(`line ${i + 1}: ${button.problem}`);
        const key = button.label.toLowerCase(), first = labels.get(key);
        if (first !== undefined) {
          const warning = `Status bar: line ${i + 1}: duplicate label="${button.label}"; line ${first} already has it; choose a different label=`;
          const warningId = `${note.id}:${warning}`;
          if (!this.duplicateWarnings.has(warningId)) this.warn(warning);
          this.duplicateWarnings.add(warningId);
          i = button.endLine;
          continue;
        }
        labels.set(key, i + 1);
        const alt = button.alt;
        out.push({ id: `button:${i}`, text: button.label, button: { look: button.look, line: i }, place: "left", after: " │ ", click: { action: "button.press", args: { note: note.id, label: button.label, line: i + 1 } }, ...(alt ? { alt: { action: "button.press", args: { note: note.id, label: button.label, line: i + 1, alt: true } } } : {}) });
        i = button.endLine;
      } else throw new Error(`line ${i + 1}: use - <built-in id> or ::button{label="Collapse" act="tile.collapse tile=screen"}`);
    }
    return out;
  }

  items(builtins: StatusItem[]): StatusItem[] {
    if (!this.lines) return builtins;
    // Built-in state changes independently of edits (recording, waiting, drawer, time).
    const out: StatusItem[] = [];
    for (const line of this.lines) {
      if (!line.id.startsWith("button:")) { out.push(builtins.find(b => b.id === line.id)!); continue; }
      // A button sits where its line is: after the item above it in the note, on that item's side of the bar.
      const place = out.at(-1)?.place ?? "left";
      const b = line.button!, text = buttonText(line.text, { ...b.look, ...pressState(this.note!.id, b.line) }) + STATUS_INK;
      out.push({ ...line, text, place, after: place === "right" ? RIGHT_AFTER : " │ " });
    }
    return out;
  }

  async ensure(builtins: StatusItem[], actor: Actor): Promise<Msg> {
    await this.refresh(builtins);
    if (this.note) return this.note;
    this.note = await this.board.createBlock(null, [
      "Your status bar [status-bar::true]", "", ...builtins.map(i => `- ${i.id}`), "",
      '<!-- ::button{label="Collapse" act="tile.collapse tile=screen"} -->',
    ].join("\n"), actor);
    await this.refresh(builtins);
    return this.note!;
  }

  async pin(line: string, builtins: StatusItem[], actor: Actor) {
    const button = buttonCallsOf(line).find(b => b.act);
    if (!button) throw new ActionRefused("pin a ::button line with act= or of=");
    const note = await this.ensure(builtins, actor);
    const duplicate = buttonCallsOf(note.text).find(b => b.label.toLowerCase() === button.label.toLowerCase());
    if (duplicate) throw new ActionRefused(`line ${duplicate.line + 1} already has label="${duplicate.label}"; choose a different label=`);
    const updated = await this.board.update(note.id, `${note.text}\n${line}`, note.revision!, actor);
    await this.refresh(builtins);
    return { note: updated.id };
  }
}

interface StatusOn {
  note: StatusBarNote;
  builtins(): StatusItem[];
  items(): unknown;
  open(id: string, actor: Actor): Promise<unknown>;
}
export const STATUS_BAR_ACTIONS = actionSet<StatusOn>()("status bar", {
  "status.bar.items": def({
    summary: "describe the status bar's declared items, their current text, place, click and alternate ActionDefs, and visible hit boxes; ids also name the built-ins in your [status-bar::true] note",
    touches: "nothing", replay: "safe", args: {},
    run(_, on) { return on.items(); },
  }),
  "status.bar.edit": def({
    summary: "status bar: edit your [status-bar::true] note; made on first use with today's built-ins and a commented Collapse button. Order or hide built-ins with - <id> lines; ::button lines pin actions; alt= names their alternate action. Edits redraw the bar live",
    keys: "right-click or alt+click an empty part of the status bar; the power bar's status bar: edit",
    touches: "nothing", replay: "ask", args: {},
    async run(_, on, actor) { const note = await on.note.ensure(on.builtins(), actor); await on.open(note.id, actor); return { note: note.id }; },
  }),
  "status.bar.pin": def({
    summary: "pin a ::button line to your status bar, appending it to the [status-bar::true] note; made on first use, with the existing bar's items",
    touches: "nothing", replay: "ask",
    args: { line: { type: "string", about: "the ::button line to append" } },
    examples: [{ act: 'status.bar.pin line=\'::button{label="Collapse" act="tile.collapse tile=screen"}\'', does: "pins Collapse to your status bar" }],
    run({ line }, on, actor) { return on.note.pin(line, on.builtins(), actor); },
  }),
});
