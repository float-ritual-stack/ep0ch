# Collection workbench

Put `workbench::` in a saved view note. Its `[query::…]` is the one membership question. The service answers that question, watches it, and passes the answer to this extension. The extension presents the same rows as a linked table, cards and a filterable list with previews. Every row opens its source note through the reader's normal open action.

```
Garden work [type::virtual-branch] [query::type=workbench-seed] [group::stage] [sort::due] [direction::asc] [columns::stage,due]
workbench::
```

Edit the note's query, group, sort, direction or columns in the ordinary editor. `group`, `sort` and `columns` take any property name written in the outline. The service's query completion and this extension's component schema describe them while you type; `ep0ch library` and `components.schemas` give an agent the same example. `resources.projection.read` returns the component's data, including row IDs, facets, completeness and the live answer. Agents edit the same source note with the same revision and attribution rules. A reader keeps its own selection and filter when the answer changes.

This is an installable experiment in the accepted Collections direction. It uses the existing saved view, `blocks.query`, `QueryWatches`, projection slot, shared primitives and `ListView`; it defines no collection index or query language of its own. Try the demo notes on this extension's page, change one seed's property, then uninstall it from the extensions screen. The saved notes remain ordinary notes and views.
