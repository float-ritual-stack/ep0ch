import { RowView } from "../scroll";
import { paintRange, rowsOf, SELECT_BG, Selection, type Pos } from "./selection";
import { DraftSession, type SessionEnv } from "../draft-session";
import { USER } from "../socket";
import { DRAFT_ACTIONS } from "../edit";
import { ActionRefused, keyName, keyOfName } from "./actions";
import type { Key } from "../term";
import { rowLines } from "../text";

export interface InspectorField {
  key: string;
  session: DraftSession;
  choices: string[];
  selected: number;
  multiple: boolean;
  note: string;
  saving: boolean;
  /** The save in flight: the next edit waits for it to land instead of refusing (a quick second click). */
  landing?: Promise<unknown>;

}

/** The viewport and text selection shared by the tune and source inspectors. */
export class Inspector extends RowView {
  lines: readonly string[] = [];
  selection: Selection | null = null;
  pressed: Pos | null = null;
  field: InspectorField | null = null;
  editorPressed = false;
  private editorRect = { x: 4, y: 0, w: 0, h: 0 };

  async edit(key: string, value: string, choices: string[], multiple: boolean, place: string, write: (value: string) => Promise<unknown>, env: SessionEnv = {}) {
    // A save still landing: wait for it. Saved, the field is gone; refused, its text stays and says why.
    if (this.field?.saving) {
      const f = this.field;
      await f.landing?.catch(() => undefined);
      if (this.field === f && f.note) throw new ActionRefused(`${f.key} didn't save: ${f.note} · its text stays here`);
    }
    if (this.field) await this.field.session.leave(USER);
    const session = DraftSession.open({
      place, back: `e on ${key} brings it back`, label: "inspector-field", what: `${key} in the inspector`, verb: "save", leaveWrites: false,
      submit: async s => { try { return { ok: true, result: await write(s.draft.text) }; } catch (e) { return { ok: false, why: e instanceof Error ? e.message : String(e) }; } },
    }, { text: value }, env);
    if (session.draft.restored === null && value) session.draft.anchor = { row: 0, col: 0 };
    this.field = { key, session, choices, selected: multiple ? 0 : choices.indexOf(value), multiple, note: "", saving: false };
  }
  unsaved() { return !!this.field?.session.dirty; }
  keep() { return this.field?.session.dirty ? [this.field.session.keep()] : []; }
  async input(op: string, value?: string, n?: number, row?: number, col?: number) {
    const f = this.field;
    if (!f || f.saving) return;
    if (op === "start") { this.begin({ row: row!, col: col! }); return; }
    if (op === "drag") { this.extend({ row: row!, col: col! }); return; }
    if (op === "release") { const text = this.text(); this.release(); return text; }
    if (op === "cancel") { await f.session.leave(USER); this.field = null; return; }
    if (op === "pick") { f.selected = Math.max(0, Math.min(f.choices.length - 1, n ?? f.selected)); return; }
    if (op === "key") { const key = keyOfName(value!); if (key) f.session.draft.key(key); return; }
    if (op === "text") { f.session.draft.key({ kind: "paste", text: value ?? "" }); return; }
    if (op === "toggle" && f.multiple) {
      if (n !== undefined) f.selected = n;
      const values = JSON.parse(f.session.draft.text || "[]") as string[], choice = f.choices[f.selected]!;
      f.session.replace(JSON.stringify(values.includes(choice) ? values.filter(x => x !== choice) : [...values, choice]), USER);
      return;
    }
    if (op === "save") {
      f.saving = true;
      const landing = (async () => {
        try {
          if (f.choices.length && !f.multiple && f.selected >= 0) f.session.replace(f.choices[f.selected]!, USER);
          const result = await f.session.submit(USER);
          if (result.ok) { if (this.field === f) this.field = null; } else f.note = result.why;
        } finally { f.saving = false; }
      })();
      f.landing = landing;
      await landing;
    }
  }
  intent(k: Key): { op: string; value?: string; n?: number } | null {
    const f = this.field;
    if (!f) return null;
    if (k.kind === "esc") return { op: "cancel" };
    if (k.kind === "enter" || k.kind === "char" && k.ctrl && k.ch === "s") return { op: "save" };
    if (f.choices.length && (k.kind === "up" || k.kind === "down" || k.kind === "char" && (k.ch === "j" || k.ch === "k"))) return { op: "pick", n: f.selected + (k.kind === "up" || k.kind === "char" && k.ch === "k" ? -1 : 1) };
    if (f.multiple && k.kind === "char" && k.ch === " ") return { op: "toggle" };
    if (k.kind === "paste") return { op: "text", value: k.text };
    if (k.kind === "char" && k.pasted) return { op: "text", value: k.ch };
    const name = keyName(k);
    return name ? { op: "key", value: name } : null;
  }
  fieldDraw(w: number, at = 0) {
    const f = this.field!, d = f.session.draft;
    const room = Math.max(1, rowLines(d.text, Math.max(4, w - 4)).length);
    const head = rowLines(`    ${f.key}:`, w), input = d.render(Math.max(4, w - 4), room);
    this.editorRect = { x: 4, y: at + head.length, w: Math.max(4, w - 4), h: input.length };
    const lines = [...head, ...input.map(l => `    ${l}`)];
    const hits: { row: number; from: number; to: number; args: { op: string; n?: number } }[] = [];
    let focus = lines.length - 1;
    f.choices.forEach((c, n) => {
      if (n === f.selected) focus = lines.length;
      const start = lines.length;
      lines.push(...rowLines(`    ${n === f.selected ? ">" : " "} ${c}`, w));
      for (let row = start; row < lines.length; row++) hits.push({ row, from: 0, to: w, args: { op: f.multiple ? "toggle" : "pick", n } });
    });
    lines.push(...rowLines(`    ${f.note || (f.multiple ? "space toggle · Enter save · Esc keeps" : "Enter save · Esc keeps")}`, w));
    hits.push({ row: lines.length, from: 4, to: 10, args: { op: "save" } }, { row: lines.length, from: 12, to: 20, args: { op: "cancel" } });
    lines.push("    [save]  [cancel]");
    return { lines, hits, focus };
  }

  remapEditor(dx: number, dy: number) {
    this.editorRect = { ...this.editorRect, x: this.editorRect.x + dx, y: this.editorRect.y + dy };
  }

  private placeField(at: Pos, extend: boolean) {
    const d = this.field!.session.draft, r = this.editorRect;
    const p = d.posAt(at.col - r.x, Math.max(0, Math.min(r.h - 1, at.row - r.y)));
    void DRAFT_ACTIONS.run("draft.place", { line: p.row + 1, col: p.col + 1, extend }, d, USER);
  }
  begin(at: Pos) {
    this.pressed = at; this.selection = null;
    const r = this.editorRect;
    this.editorPressed = !!this.field && at.col >= r.x && at.col < r.x + r.w && at.row >= r.y && at.row < r.y + r.h;
    if (this.editorPressed) this.placeField(at, false);
  }
  extend(at: Pos) { if (this.editorPressed) this.placeField(at, true); else if (this.pressed) this.selection = new Selection(this.pressed, at); }
  release() { this.pressed = null; this.editorPressed = false; }
  text() { return this.selection?.text(rowsOf(this.lines)) ?? this.field?.session.draft.selectedText() ?? ""; }
  paint(line: string, row: number) {
    const span = this.selection?.span(row);
    return span ? paintRange(line, span[0], span[1], SELECT_BG) : line;
  }
}
