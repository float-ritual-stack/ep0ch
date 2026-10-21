import { buttonCallsOf } from "@ep0ch/outline-core/button-call";
import { noteCodeFences } from "@ep0ch/outline-core/component-block";
import type { Msg } from "./board";
import type { Actor, SocketBoard } from "./socket";
import { ActionRefused, actionSet, def, type ActRequest } from "./surface/actions";
import { width } from "./style";

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

/** The note is ordinary outline content: edits, trash and reconnects all read it through the service. */
export class StatusBarNote {
  note: Msg | null = null;
  private lines: StatusItem[] | null = null;
  private reading: Promise<void> | null = null;
  private stale = false;
  private said = "";
  constructor(private board: SocketBoard, private changed: () => void, private warn: (text: string) => void) {}

  refresh(builtins: StatusItem[]): Promise<void> {
    this.stale = true;
    if (this.reading) return this.reading;
    this.reading = (async () => {
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
    })().finally(() => { this.reading = null; });
    return this.reading;
  }

  private read(note: Msg, builtins: StatusItem[]): StatusItem[] {
    const lines = note.text.split("\n"), buttons = buttonCallsOf(note.text);
    const fenced = new Set<number>();
    for (const f of noteCodeFences(lines)) for (let i = f.start; i <= f.end; i++) fenced.add(i);
    const out: StatusItem[] = [];
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
        if (button.problem) throw new Error(`line ${i + 1}: ${button.problem}`);
        const alt = button.alt;
        out.push({ id: `button:${i}`, text: button.label, place: "left", after: " │ ", click: { action: "button.press", args: { note: note.id, label: button.label } }, ...(alt ? { alt: { action: "button.press", args: { note: note.id, label: button.label, alt: true } } } : {}) });
      } else throw new Error(`line ${i + 1}: use - <built-in id> or ::button{label="Collapse" act="tile.collapse tile=screen"}`);
    }
    return out;
  }

  items(builtins: StatusItem[]): StatusItem[] {
    if (!this.lines) return builtins;
    // Built-in state changes independently of edits (recording, waiting, drawer, time).
    return this.lines.map(i => i.id.startsWith("button:") ? i : builtins.find(b => b.id === i.id)!);
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
    if (!buttonCallsOf(line).some(b => b.act)) throw new ActionRefused("pin a ::button line with act= or of=");
    const note = await this.ensure(builtins, actor);
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
