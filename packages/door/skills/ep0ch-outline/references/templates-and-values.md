# Templates: `::use` (live) and `template.stamp` (written out)

A template is a note you write once and use two ways. `{{ }}` values in prose are in SKILL.md ("Values in prose");
this page is the template half: live with `::use`, as a new note with `template.stamp`, the props between them.

## A template

A note, usually marked `[type::template]`. It declares its props with `[form-field::…]` chips and says what it makes
with `[template-for::…]` (optional: its word becomes the stamped note's `[type::…]`, and `of=type:<word>` finds it; a template with none is stamped by `[[page]]` or `((id))`):

```text
Meeting {{props.with}} {{props.date}} [page::meeting-template] [type::template] [template-for::meeting]
[form-field::with text required]
[form-field::mood choice good|meh|rough default=good]
[form-field::date text default={{now.date}}]
Present: {{props.with}}. Mood: {{props.mood}}. Page: {{this.title}}, under {{parent.title}}.
::graph-table
---
query: type=action project={{this.project}}
---
::
```

- A prop is `name type [options] [required] [default=value]`. Types: `text`, `number`, `choice` (its options `a|b|c`),
  `note` (a note found by its words), `tag`. A name can't be one of the call-site words: `of`, `act`, `at`, `mode`,
  `as`, `label`, `txn`, `motion`, `create`, `freeze`, `for`. (`with` and `color` are fine here, though an action's form
  can't use them.)
- A default is text and may be a path read where the template is used: `default={{parent.owner}}`.
- `this.*`, `parent.*` and a bare key read the note the template lands in, never the template.
- `props.*` are the call's. `self.*` is the template note itself.

## Live: `::use`

```text
::use{of=[[meeting-template]] date=2026-10-14 with=Jay}
```

The template's body is drawn where the line is, with `this` the page the line is on: `{{this.title}}` is *this* page's
title, and a figure over `{{this.project}}` lists this page's own, on every page that uses the template. Edit the
template and every page redraws. Nothing is written to the page.

- `of=` names the template: `[[page]]`, `((id))`, a Work ID, or `type:meeting`, the one note that says
  `[template-for::meeting]` (no copy of a skeleton: the shape is found by what it is).
- A prop is any other `name=value` in the braces (`k="two words"` quotes). Its value may be a path read in the page's own
  Site: `status={{parent.status}}`, `owner="[[evan schultz]].firstName"`, `ref=((id)).status`.
- A `::use` inside a template body is drawn in the outer call's props: `owner={{props.who}}`. A template that draws
  itself is refused (a cycle).
- **Mistakes never lose the save.** `::use{of=[[meeting-template]] wiht=Jay}` is drawn with the warning
  `meeting-template has no prop `wiht`; did you mean `with`?` and the call that works. A choice outside its options says
  the nearest option. A required prop left out is drawn as "needs: with", and a press on it (⏎, or a click) opens the
  picker of its kind in the power bar, then writes the answers onto the `::use` line (ctrl+z takes them back).
- `outline_site` on the page returns `uses`: each call as the service reads it, for an agent writing one.

## Written out: `template.stamp`

```text
ep0ch act template.stamp of='[[daily-template]]' as=new parent='[[Daily notes]]' title='{{now.date}}'
ep0ch act template.stamp of='type:meeting' with='{"with":"Jay"}'
ep0ch act template.stamp of='[[ticket-template]]' parent='[[Asks]]' for='kind=ask'
ep0ch act template.stamp of='[[week-log]]' as=new freeze=all
```

A new note (with the template's subtree) whose text is the person's from then on.

| Written now | Stays `{{ }}` |
|---|---|
| `props.*`, `self.*`, `now.*` (`{{now.date}}`, `{{now.week}}`, `{{now.date-1d}}`) | `this.*`, `parent.*`, a bare key, `((id))`, `[[page]]`: they keep their meaning where the note lands |

- `freeze=all` writes the others too, for a scaffold with no braces left. A value that can't be read is left as
  written and listed in `warnings`.
- `title=` replaces the first line's words and may use the stamp's own values (`{{now.date}}`, `{{props.for.title}}`).
- `parent=` is the note it goes under (`[[page]]`, `((id))`, a Work ID); left out, beside the template (the top of Inbox when the template has no parent). `parent=inbox` explicitly chooses Inbox.
- `for=<query>` (the views' grammar) stamps once per match, at most 50; each match is `props.for`
  (`{{props.for.number}}`, `{{props.for.title}}`). A match already stamped from this template is skipped, so running it
  again adds only what is new.
- The template's own chips (`[type::template]`, `[template-for::meeting]`, `[form-field::…]`, its own `[page::…]`) are not
  stamped. `[template-for::meeting]` becomes `[type::meeting]`; `[from-template::((id))]` says where it came from (and
  `[stamped-for::((match))]` which match, for `for=`).
- Props are checked before anything is written: an unknown one says the nearest, a required one left out says the call
  that works, and nothing is made.
- The person is asked in the power bar for the template (`ctrl+k`, `template.stamp`) and for a choice, a note or a needed
  prop; the first new note opens. An agent's stamp is attributed to it and opens nothing.
- `into=((id^anchor))` (writing into a note's anchor) arrives with placement; it is refused until then, saying so.

## Worked example: a status card used on two pages

```text
Status card [page::status-card] [type::template]
[form-field::status choice active|paused|done default=active]
[form-field::owner text required]
{{this.title}}: {{props.status}}, owned by {{props.owner}}.
```

```text
Beds page
::use{of=[[status-card]] owner=Ada}

Traps page
::use{of=[[status-card]] owner=Jay status=paused}
```

The beds page draws `Beds page: active, owned by Ada.` (`status` took its default), the traps page `Traps page: paused,
owned by Jay.` Leave `owner` off a call and the line says `needs owner [fill it in]`; write `owner=Ada stauts=paused`
and it says ``Status card has no prop `stauts`; did you mean `status`?``. Check a call before you rely on it with
`outline_site` on the page: `uses` lists each `::use` with the `props` it gets, `problems` (with the nearest name and a
call that works) and the `missing` props; a write also warns about the same after the save.

## Which one

| You want | Use |
|---|---|
| Every page of a kind shows the same thing, kept in step with the template | `::use` |
| A figure or `::fields` that reads each page it is drawn on | `::use` (`this` is the host) |
| A note to start from and then change | `template.stamp as=new` |
| One note per client, ticket or day | `template.stamp … for=` / `as=new` with `title={{now.date}}` |


## Fields and scope

**Roll up:** `::fields{key=connectTo}` lists this note's occurrences; `of=parent` lists its parent's, and `of=<id>` or `of=((id))` names another note (full ID or its first eight characters).
**Positions:** the figure labels lines from 1; the API's `fields[].line` counts from 0.
**Bare field:** `connectTo:: value` starts a line; inside prose use `[connectTo::value]`.
**Worked examples:** [Programmable notes](../../../../outliner/docs/PROGRAMMABLE-NOTES.md) walks through parent fields, live templates, scripts and held drafts on a scratch outline.
