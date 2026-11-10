// form.* and ask.beside: filling a note's form (its [form-field::…] properties) with the shared editor, and the
// question asked beside it.
import type { Key } from "../../term";
import type { On } from "./shared";
import { FORM_CHOICE_KEYS, FORM_KEYS } from "../note-form";
import { modeActionKeys } from "../modes";
import { type ActionDef, ActionRefused, def } from "../actions";

export const FORM_DEFS = {
  "form.focus": def({
    summary: "fill a field in the note's form", touches: "tile", replay: "safe", person: "the person's form focus",
    args: { field: { type: "string", about: "field name, or @submit" } },
    examples: [{ act: "form.focus field=book", does: "starts filling the book field in this note" }],
    run({ field }, { surface, host }) { surface.focusForm(field, host); },
  }),
  "form.move": def({
    summary: "move between the form's fields", keys: modeActionKeys([FORM_KEYS], "form.move"), touches: "tile", replay: "safe", person: "the person's form focus",
    args: { by: { type: "number", about: "1 next, -1 previous" } },
    examples: [{ act: "form.move by=1", does: "moves to the next form field, keeping the answers" }],
    run({ by }, { surface, host }) { const f = surface.form; if (!f) throw new ActionRefused("this note has no form-field properties; write [form-field::name text] in its edit"); const at = (f.focus + by + f.fields.length + 1) % (f.fields.length + 1); surface.focusForm(f.fields[at]?.name ?? "@submit", host); },
  }),
  "form.leave": def({
    summary: "leave the form with its answers kept", keys: modeActionKeys([FORM_KEYS], "form.leave"), touches: "tile", replay: "safe", person: "the person's form focus", args: {},
    run(_, { surface, host }) { surface.leaveForm(); host.redraw(); },
  }),
  "form.place": def({
    summary: "place or extend the shared editor's cursor in a form field", keys: "click, drag", touches: "tile", replay: "safe", person: "the person's form cursor",
    args: { field: { type: "string", about: "field name" }, col: { type: "number", about: "zero-based column" }, extend: { type: "boolean", optional: true, about: "extend selection" } },
    examples: [{ act: "form.place field=book col=0", does: "places the cursor at the start of the book answer" }],
    run({ field, col, extend }, { surface, host }) { surface.focusForm(field, host); const d = surface.form!.draft(field); d.place(0, d.oneRow.posAt(col), extend); host.redraw(); },
  }),
  "form.input": def({
    summary: "type in the form with the shared editor", touches: "tile", replay: "ask", person: "the person's form editor",
    args: { key: { type: "string", about: "editor key as JSON" } },
    examples: [{ act: `form.input key='{"kind":"paste","text":"Piranesi"}'`, does: "pastes a book title into the focused field with the shared editor" }],
    run({ key }, { surface, host }) { const f = surface.form; if (!f) throw new ActionRefused("this note has no form-field properties; write [form-field::name text] in its edit"); f.input(JSON.parse(key) as Key, text => host.ctx.copy?.(text)); host.redraw(); },
  }),
  "form.set": def({
    summary: "answer one field of this note's form; agents keep their own answers", keys: modeActionKeys([FORM_CHOICE_KEYS], "form.set"), touches: "nothing", replay: "safe",
    args: { field: { type: "string", about: "field name" }, value: { type: "string", about: "answer" } },
    examples: [{ act: "form.set field=book value=Piranesi", does: "answers the book field for the actor submitting the form" }],
    run({ field, value }, { surface, host }, actor) { const f = surface.form; if (!f) throw new ActionRefused("this note has no form-field properties"); f.set(field, value, actor); if (actor.kind === "user") surface.focusForm(field, host); host.redraw(); return { answers: f.values(actor) }; },
  }),
  "form.submit": def({
    summary: "submit this note's form through ext.form.fill", keys: modeActionKeys([FORM_KEYS], "form.submit"), touches: "nothing", replay: "ask", args: {},
    async run(_, { surface, host }, actor) {
      const f = surface.form;
      if (!f) throw new ActionRefused("this note has no form-field properties");
      const warning = f.check(actor);
      if (warning) { f.warning(actor, warning); host.redraw(); return { warning }; }
      if (f.busy) throw new ActionRefused("the form is still submitting");
      f.busy = true;
      try {
        const sent = f.values(actor);
        const result = await host.ctx.dispatch!.act({ action: "ext.form.fill", args: { block: f.block, with: JSON.stringify(sent) } }, actor);
        // It landed: the form clears for the next entry, so a second press can't write the same one again (a refusal keeps it).
        f.reset(actor, sent);
        return result;
      } catch (error) { f.warning(actor, error instanceof Error ? error.message : String(error)); throw error; }
      finally { f.busy = false; host.redraw(); }
    },
  }),
  "ask.beside": def({
    summary: "show this ask's answer beside the note, keeping the person's keys in the note",
    touches: "shape", replay: "safe",
    args: { ask: { type: "string", about: "the ask line as written" }, fold: { type: "string", optional: true, about: "the selected answer's fold identity" } },
    examples: [
      { act: 'ask.beside ask="@margin which beds need mulch?"', does: "shows that ask's answer in a tile beside the note, keys staying in the note" },
    ],
    async run({ ask, fold }, { host }, actor) { return host.answerTile?.(ask, actor, fold) ?? null; },
  }),
} satisfies Record<string, ActionDef<any, On>>;
