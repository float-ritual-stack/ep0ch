# Collection workbench

Put `workbench::` in a saved view note and it draws that view's rows three ways: a linked table, cards and a filterable list with previews.

- **The question:** the note's `[query::…]` is the one membership question.
- **The service** answers it, watches it, and passes the answer to this extension.
- **Open a row:** it opens its source note through the reader's normal open action.

```
Garden work [type::virtual-branch] [query::type=workbench-seed] [group::stage] [sort::due] [direction::asc] [columns::stage,due]
workbench::
```

## What you do

- **Change it:** edit the note's query, group, sort, direction or columns in the ordinary editor.
  - `group`, `sort` and `columns` take any property name written in the outline.
  - The service's query completion and this extension's component schema describe them while you type.
- **Keep your place:** a reader keeps its own selection and filter when the answer changes.
- **Try it:** open the demo notes on this extension's page and change one seed's property.
- **Remove:** uninstall it from the extensions screen. The saved notes remain ordinary notes and views.

## For agents

- **The example:** `ep0ch library` and `components.schemas` give the same example.
- **The data:** `resources.projection.read` returns the component's data, with row IDs, facets, completeness and the live answer.
- **Edits:** agents edit the same source note with the same revision and attribution rules.

## How it's made

- **An installable experiment** in the accepted Collections direction.
- **Parts it uses:** the existing saved view, `blocks.query`, `QueryWatches`, the projection slot, shared primitives and `ListView`.
- **What it doesn't add:** a collection index or a query language of its own.
