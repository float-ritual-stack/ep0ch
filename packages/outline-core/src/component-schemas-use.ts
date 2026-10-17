// The schema of `::use` (PIE-533 S4): a template drawn live in the note that writes the line. One schema in its own file,
// registered by one line in component-schema.ts. The call's grammar is template-use.ts (the line) and props-spec.ts (the
// template's props and the check); the service answers `template.use` and every client draws it. Pure: no I/O; types
// only from component-schema.ts.
import type { ComponentSchema } from "./component-schema";

export const USE: ComponentSchema = {
  id: "use",
  title: "Template (::use)",
  intro: "A template drawn live where this line is written: `::use{of=[[meeting-template]] date=2026-10-14 with=Jay}`. The template's body is drawn in place with `this` the note the line is in, so `{{this.title}}` in it is this page's title, also inside a figure, `::fields` or `::if` in its body; `{{props.with}}` is what the call passed. Edit the template and every page that uses it redraws. A template is a note with `[form-field::with text]` chips (name, type, `default=`, `required`) declaring its props; a prop written on the line that the template doesn't declare is a warning with the nearest name, and a required one left out is asked for. A prop's value may be a path: `status={{parent.status}}` or `owner=[[evan]].name`. `template.stamp` writes the filled text as a new note instead, for editing. The template here is illustrative, so the library draws what a missing one gets.",
  where: "a line of a note: `::use{of=…}` with its props in the braces",
  props: [
    { key: "of", where: "line", type: "ref", token: "of={value}", meaning: "the template: a [[page]], a ((block)), a Work ID, or `type:meeting` for the one note that says `[template-for::meeting]`", samples: ["[[meeting-template]]", "type:meeting"] },
  ],
  source: { use: "::use{of=[[meeting-template]]}" }, example: {}, sweep: [], grids: [], space: [],
};
