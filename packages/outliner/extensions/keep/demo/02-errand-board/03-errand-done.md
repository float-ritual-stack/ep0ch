Errand done [script::errand-done] [effects::write] [form-field::note note required]
Marks an errand done: what a card on the board runs when pressed.

```ts
const errand = await read(props.note[0])
await tools.outline_set_property({ ref: errand.id, key: "status", value: "done", revision: errand.revision })
return `${errand.title} done`
```
