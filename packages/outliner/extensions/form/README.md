# Form

A form written in the note it's used on: one action asks for its fields and writes your answers as an entry under the note.

```text
Reading log
[form-field::book text required] [form-field::pages number] [form-field::mood choice gripping|slow|abandoned default=slow]
  └─ The Lantern Shed [book::The Lantern Shed] [pages::212] [mood::gripping]   ← written by ext:form
```

## What you do

- **Fill it in:** `ctrl+k`, type `fill`, then Enter or click the row.
  - It runs on the note in front of you and asks for each field in turn.
  - A choice's options are rows, default first.
  - Text or a number is typed; a field that isn't `required` can be left empty.
- **Write a form:** put one `[form-field::…]` chip per field on the note.
- **Change it:** edit the note's chips; the next run asks the new fields.
- **As an agent:** give the answers at once and never be asked.
  - `ep0ch act ext.form.fill block=<id> with='{"book":"Moss","pages":"90"}'`
  - Or `ep0ch ext act form fill --block <id> --arg book=Moss --arg pages=90`.

## Fields

- **Shape:** `[form-field::<name> <type> [<options>] [required] [default=<value>]]`.
- **`text`, `number`:** typed.
- **`choice`:** its options after it, split by `|`: `good|meh|rough`.
- **`property`:** a property's name.
- **`note`:** a note, found by its words.
- **`tag`:** a `#tag`.
- **`required`:** asks until it has an answer.
- **`default=`:** lit first.

## Good to know

- **The service checks answers** as it does an action's declared arguments.
  - A choice is among its options, a number is a number, a required one is present.
- **A chip it can't read** is saved as written and said on the save, with what it may have meant.
  - For example `[form-field::mood choise good|meh]` says `did you mean choice?`, and the action refuses with the same words.

## Setup

- **Install:** `ep0ch ext add form`.

## How it works

- **One action,** **Fill in the form**, shared by every form: a reading log, a bug report and a sprint check each write their own fields (PIE-828).
- **Fields come from the note:** `"fieldsFrom": "block"` in `extension.json` (the contract's [declared arguments](../../docs/extensions/README.md)).
- **The action is told them too** (`input.fields`, in the note's order), so it knows which answers are the note's.
