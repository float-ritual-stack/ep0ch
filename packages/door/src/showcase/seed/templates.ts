// The showcase seed's "Templates" (PIE-533 S4): a meeting template with typed props, three pages that use it live (`::use`),
// and a daily-note template stamped as a new note (`template.stamp`). Fictional.

/** A template: `[form-field::…]` chips declare its props, `[template-for::meeting]` says what it makes. `this` is the page that uses it. */
export const MEETING_TEMPLATE = [
  "Meeting note template [page::meeting-template] [type::template] [template-for::meeting]",
  "[form-field::with text required]",
  "[form-field::mood choice good|meh|rough default=good]",
  "[form-field::date text default={{now.date}}]",
  "{{props.date}}: met {{props.with}}, mood {{props.mood}}. Filed on {{this.title}}.",
  "",
  "::graph-table",
  "---",
  "title: Actions for this project",
  "query: type=action project={{this.project}}",
  "columns: [title]",
  "---",
  "::",
].join("\n");

/** The template `template.stamp` writes out: its first line becomes the title the stamp is given. */
export const DAILY_TEMPLATE = [
  "Daily note template [page::daily-template] [type::template] [template-for::daily]",
  "Planned for {{now.weekday}}, in {{parent.title}}; its owner is {{owner}}.",
  "- Water the beds",
  "- Check the traps",
].join("\n");

/** Where a stamped daily note lands: it reads `{{owner}}` from here. */
export const DAILY_NOTES = "Daily notes [page::daily notes] [owner::Ada]\n\n## Stamped log ^log\n\nTemplates can also land here: use template.stamp with into= pointing to this note's log anchor.";

/** Three pages: each its own project, the same template. The third has two mistakes to see the warnings. */
export const MEETING_PAGES = [
  { title: "Sowing meeting", project: "sowing", call: "::use{of=[[meeting-template]] with=Ada date=2026-10-14}" },
  { title: "Potting meeting", project: "potting", call: "::use{of=[[meeting-template]] with=Jay mood=meh}" },
  { title: "Unfinished meeting", project: "pruning", call: "::use{of=[[meeting-template]] mood=gud wiht=Kit}" },
] as const;

/** The actions the figure in the template lists, per project. */
export const MEETING_ACTIONS = [
  { title: "Prune the roses", project: "sowing" },
  { title: "Sow the carrots", project: "sowing" },
  { title: "Pot up the tomatoes", project: "potting" },
] as const;
