# Form

A form written in the note it's used on (PIE-828). The note says its fields, one chip per field; one action, **Fill in
the form**, asks for them and writes an entry under the note, each answer a property on it. A reading log, a bug
report and a sprint check each write their own fields and share the one action.

```text
Reading log
[form-field::book text required] [form-field::pages number] [form-field::mood choice gripping|slow|abandoned default=slow]
  └─ The Lantern Shed [book::The Lantern Shed] [pages::212] [mood::gripping]   ← written by ext:form
```

- **A field** is `[form-field::<name> <type> [<options>] [required] [default=<value>]]`. The type is `text`, `number`,
  `choice` (its options after it, split by `|`: `good|meh|rough`), `property` (a property's name), `note` (a note, found
  by its words) or `tag` (a `#tag`). `required` asks
  until it has an answer; `default=` is lit first.
- **Checked by the service,** as an action's declared arguments are: a choice among its options, a number a number, a
  required one present. A chip it can't read (`[form-field::mood choise good|meh]`) is saved as written and said on the
  save, with what it may have meant (`did you mean choice?`); the action refuses with the same words.
- **In the door:** the power bar (`ctrl+k`, type `fill`, ⏎ or a click on the row) runs it on the note in front of you,
  then asks for each field in turn: a choice's options as rows (its default first), a text or number typed, one that
  isn't `required` left empty. An agent gives them at once and is never asked:
  `ep0ch act ext.form.fill block=<id> with='{"book":"Moss","pages":"90"}'`
  (`ep0ch ext act form fill --block <id> --arg book=Moss --arg pages=90`).
- **Change the form where it's used:** edit the note's chips, and the next run asks the new fields. The action is told
  them too (`input.fields`, in the note's order), so it knows which answers are the note's.

How an action asks for a note's fields: `"fieldsFrom": "block"` in `extension.json` (the contract's
[declared arguments](../../docs/extensions/README.md)). Install: `outliner ext add form`.
