import { formFields, FORM_FIELD_KEY, type FormField } from "@ep0ch/outline-core/form-fields";
import { keyTable } from "./keymap";
import { parsePropertyRecords } from "@ep0ch/outline-core/property-parse";
import { tabStrip } from "./chip-rows";
import { LineField } from "./line";
import { partyOf } from "../steps";
import { USER, type Actor } from "../socket";
import { LINE_BOX, stringFrame } from "../canvas";
import { fg, C, pad, RESET, visible, width } from "../style";
import { ActionRefused, asBoundKey, keyName, shownLine } from "./actions";
import { printable, wrap } from "../text";
import { modeBinding, modeHint, type ModeKey } from "./modes";
import type { Key } from "../term";

export const FORM_KEYS: readonly ModeKey[] = keyTable("form", "a note form being filled", [
  { key: "tab", action: "form.move", args: { by: 1 }, label: "next field" },
  { key: "shift+tab", action: "form.move", args: { by: -1 }, label: "previous" },
  { key: "enter", action: "form.submit", label: "submit" },
  { key: "esc", action: "form.leave", label: "leave" },
]);

export const FORM_CHOICE_KEYS: readonly ModeKey[] = keyTable("form choice", "a choice in a note form", [
  { key: "left", action: "form.set", args: { by: -1 }, label: "previous choice" },
  { key: "right", action: "form.set", args: { by: 1 }, label: "next choice" },
  { key: "click", action: "form.set" },
]);

export class NoteForm {
  fields: FormField[] = [];
  chips: ReturnType<typeof parsePropertyRecords> = [];
  private answers = new Map<string, Map<string, LineField>>();
  private warnings = new Map<string, string>();
  focus = 0;
  busy = false;
  constructor(readonly block: string, public source: string) { this.update(source); }
  update(source: string) {
    const focused = this.fields[this.focus]?.name;
    this.source = source;
    const chips = parsePropertyRecords(source).filter(p => p.key === FORM_FIELD_KEY);
    const parsed = formFields(chips.map(p => p.value));
    this.fields = parsed.fields;
    this.chips = chips.filter((_, index) => !parsed.problems.some(p => p.index === index));
    const at = this.fields.findIndex(f => f.name === focused);
    this.focus = at < 0 ? Math.min(this.focus, this.fields.length) : at;
  }
  draft(field: string, actor = USER) {
    const key = partyOf(actor);
    let drafts = this.answers.get(key);
    if (!drafts) { drafts = new Map(this.fields.map(f => [f.name, new LineField(f.default ?? "", false, { complete: false, id: this.block })])); this.answers.set(key, drafts); }
    if (!drafts.has(field)) drafts.set(field, new LineField(this.fields.find(f => f.name === field)!.default ?? "", false, { complete: false, id: this.block }));
    return drafts.get(field)!;
  }
  values(actor: Actor) { return Object.fromEntries(this.fields.map(f => [f.name, this.draft(f.name, actor).text])); }
  set(field: string, value: string, actor: Actor) {
    if (!this.fields.some(f => f.name === field)) throw new ActionRefused(`the form has no field ${field}; choose ${this.fields.map(f => f.name).join(", ")}`);
    const d = this.draft(field, actor);
    d.splice(0, d.text.length, value, {}, actor);
    this.clearWarning(actor);
  }
  clearWarning(actor: Actor) { this.warnings.delete(partyOf(actor)); }
  warning(actor: Actor, text: string) { this.warnings.set(partyOf(actor), text); }
  check(actor: Actor) {
    const missing = this.fields.find(f => f.required && !this.draft(f.name, actor).text.trim());
    return missing ? `${missing.name} is required` : null;
  }
  key(k: Key, run: (action: string, args?: Record<string, unknown>) => void) {
    const binding = modeBinding(FORM_KEYS, k);
    if (binding) { run(binding.action, binding.args); return true; }
    const field = this.fields[this.focus];
    if (!field) return true;
    if (field.type === "choice") {
      const choice = modeBinding(FORM_CHOICE_KEYS, k);
      if (choice) {
        const options = field.options!, index = options.indexOf(this.draft(field.name).text);
        const by = choice.args!.by as number;
        run(choice.action, { field: field.name, value: options[(index + by + options.length) % options.length] });
      }
      return true;
    }
    asBoundKey(keyName(k)!, () => run("form.input", { key: JSON.stringify(k) }));
    return true;
  }
  input(key: Key, copy: (text: string) => void) {
    const field = this.fields[this.focus];
    if (field && field.type !== "choice") {
      const draft = this.draft(field.name), before = draft.text;
      draft.copy = copy;
      draft.take(key);
      if (draft.text !== before) this.clearWarning(USER);
    }
  }
  draw(w: number, active: boolean, tag: (field: string, text: string, act: string) => string): string[] {
    const inner = Math.max(16, w - 4), labelWidth = Math.min(16, Math.max(...this.fields.map(f => width(f.name) + (f.required ? 2 : 0))) + 2);
    const room = Math.max(4, inner - labelWidth - 4);
    const rows: string[] = [];
    const f = stringFrame(inner + 4, { glyphs: LINE_BOX, ink: fg(C.dark) }), line = (text: string) => rows.push(f.row(text));
    rows.push(f.top("Fill in the form"));
    this.fields.forEach((field, index) => {
      const d = this.draft(field.name), label = pad(field.name + (field.required ? " *" : ""), labelWidth);
      if (field.type === "choice") {
        const chips = field.options!.map(value => ({
          label: tag(field.name, `(${d.text === value ? "*" : " "}) ${printable(value)}`, shownLine("form.set", { field: field.name, value })),
          on: d.text === value, cursor: active && this.focus === index && d.text === value, hit: { action: "form.set", args: { field: field.name, value } },
        }));
        for (const row of tabStrip(chips, { width: inner, lead: label })) line(row.text);
      } else {
        const box = field.type === "number" ? Math.min(10, room) : room;
        const cell = stringFrame(box + 2, { glyphs: LINE_BOX, pad: 0 });
        line(" ".repeat(labelWidth) + cell.top());
        const drawn = d.render(box, 1)[0] ?? "";
        const text = active && this.focus === index ? drawn : printable(visible(drawn));
        line(label + cell.row(tag(field.name, pad(text, box), shownLine("form.focus", { field: field.name }))));
        line(" ".repeat(labelWidth) + cell.bottom());
      }
    });
    const indent = " ".repeat(labelWidth), button = "Fill in the form";
    const submit = stringFrame(width(button) + 4, { glyphs: LINE_BOX });
    for (const l of [submit.top(), submit.row(tag("@submit", button, "form.submit")), submit.bottom()]) line(indent + l);
    const warning = this.warnings.get(partyOf(USER));
    if (warning) line(fg(C.yellow) + printable(warning) + RESET);
    for (const text of ["* required", ...wrap(modeHint(FORM_KEYS, () => undefined), inner)]) line(text);
    rows.push(f.bottom());
    return rows;
  }
}
