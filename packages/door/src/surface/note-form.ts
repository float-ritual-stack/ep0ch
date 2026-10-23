import { formFields, FORM_FIELD_KEY, type FormField } from "@ep0ch/outline-core/form-fields";
import { parsePropertyRecords } from "@ep0ch/outline-core/property-parse";
import { chipRows } from "./chip-rows";
import { Draft } from "../edit";
import { USER, type Actor } from "../socket";
import { fg, C, pad, RESET, visible, width } from "../style";
import { ActionRefused, asBoundKey, keyName, shownLine } from "./actions";
import { printable, wrap } from "../text";
import { editorLineKey } from "./editor";
import { modeBinding, modeHint, type ModeKey } from "./modes";
import type { Key } from "../term";

export const FORM_KEYS: readonly ModeKey[] = [
  { key: "tab", action: "form.move", args: { by: 1 }, label: "next field" },
  { key: "shift+tab", action: "form.move", args: { by: -1 }, label: "previous" },
  { key: "enter", action: "form.submit", label: "submit" },
  { key: "esc", action: "form.leave", label: "leave" },
];

export const FORM_CHOICE_KEYS: readonly ModeKey[] = [
  { key: "left", action: "form.set", args: { by: -1 }, label: "previous choice" },
  { key: "right", action: "form.set", args: { by: 1 }, label: "next choice" },
  { key: "click", action: "form.set" },
];

export class NoteForm {
  fields: FormField[] = [];
  chips: ReturnType<typeof parsePropertyRecords> = [];
  private answers = new Map<string, Map<string, Draft>>();
  private warnings = new Map<string, string>();
  focus = 0;
  busy = false;
  constructor(readonly block: string, public source: string) { this.update(source); }
  update(source: string) {
    this.source = source;
    const chips = parsePropertyRecords(source).filter(p => p.key === FORM_FIELD_KEY);
    const parsed = formFields(chips.map(p => p.value));
    this.fields = parsed.fields;
    this.chips = chips.filter((_, index) => !parsed.problems.some(p => p.index === index));
    this.focus = Math.min(this.focus, this.fields.length);
  }
  private party(actor: Actor) { return actor.kind === "user" ? "user" : actor.id; }
  draft(field: string, actor = USER) {
    const key = this.party(actor);
    let drafts = this.answers.get(key);
    if (!drafts) { drafts = new Map(this.fields.map(f => [f.name, new Draft(this.block, 0, f.default ?? "")])); this.answers.set(key, drafts); }
    if (!drafts.has(field)) drafts.set(field, new Draft(this.block, 0, this.fields.find(f => f.name === field)!.default ?? ""));
    return drafts.get(field)!;
  }
  values(actor: Actor) { return Object.fromEntries(this.fields.map(f => [f.name, this.draft(f.name, actor).text])); }
  set(field: string, value: string, actor: Actor) {
    if (!this.fields.some(f => f.name === field)) throw new ActionRefused(`the form has no field ${field}; choose ${this.fields.map(f => f.name).join(", ")}`);
    const d = this.draft(field, actor);
    d.splice(0, d.text.length, value, {}, actor);
    this.clearWarning(actor);
  }
  clearWarning(actor: Actor) { this.warnings.delete(this.party(actor)); }
  warning(actor: Actor, text: string) { this.warnings.set(this.party(actor), text); }
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
      editorLineKey(draft, key, copy);
      if (draft.text !== before) this.clearWarning(USER);
    }
  }
  draw(w: number, active: boolean, tag: (field: string, text: string, act: string) => string): string[] {
    const inner = Math.max(16, w - 4), labelWidth = Math.min(16, Math.max(...this.fields.map(f => width(f.name) + (f.required ? 2 : 0))) + 2);
    const room = Math.max(4, inner - labelWidth - 4);
    const rows: string[] = [];
    const line = (text: string) => rows.push(fg(C.dark) + "│ " + RESET + pad(text, inner) + fg(C.dark) + " │" + RESET);
    rows.push(fg(C.dark) + "┌─Fill in the form" + "─".repeat(Math.max(0, inner + 2 - width("─Fill in the form"))) + "┐" + RESET);
    this.fields.forEach((field, index) => {
      const d = this.draft(field.name), label = pad(field.name + (field.required ? " *" : ""), labelWidth);
      if (field.type === "choice") {
        const chips = field.options!.map(value => ({
          label: tag(field.name, `(${d.text === value ? "*" : " "}) ${printable(value)}`, shownLine("form.set", { field: field.name, value })),
          on: d.text === value, cursor: active && this.focus === index && d.text === value, hit: { action: "form.set", args: { field: field.name, value } },
        }));
        for (const row of chipRows(chips, inner, label)) line(row.text);
      } else {
        const box = field.type === "number" ? Math.min(10, room) : room;
        line(" ".repeat(labelWidth) + "┌" + "─".repeat(box) + "┐");
        const drawn = d.render(box, 1)[0] ?? "";
        const text = active && this.focus === index ? drawn : printable(visible(drawn));
        line(label + "│" + tag(field.name, pad(text, box), shownLine("form.focus", { field: field.name })) + "│");
        line(" ".repeat(labelWidth) + "└" + "─".repeat(box) + "┘");
      }
    });
    const indent = " ".repeat(labelWidth), button = "Fill in the form";
    line(indent + "┌" + "─".repeat(width(button) + 2) + "┐");
    line(indent + "│ " + tag("@submit", button, "form.submit") + " │");
    line(indent + "└" + "─".repeat(width(button) + 2) + "┘");
    const warning = this.warnings.get("user");
    if (warning) line(fg(C.yellow) + printable(warning) + RESET);
    for (const text of ["* required", ...wrap(modeHint(FORM_KEYS, () => undefined), inner)]) line(text);
    rows.push(fg(C.dark) + "└" + "─".repeat(inner + 2) + "┘" + RESET);
    return rows;
  }
}
