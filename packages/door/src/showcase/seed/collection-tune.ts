export const COLLECTION_TUNE = [
  "Tune the garden collection",
  "Comma tunes this view. Ctrl+o places the card; Esc returns to its picked row.",
  "",
  '::view{query="collection=garden" layout=table group=area sort="owner asc, stage desc" summary-properties="title, owner, stage"} ^garden',
  "::",
  "",
  "Press , over the view, or click ≡ on its single control row. A plain view reveals that row when entered or hovered. Enter edits the selected field; Esc closes the card. Choose which layouts to show: add board, then hide table. Group, Sort and summary-properties offer the properties these four notes carry; each row keeps its title even without a title column. Space shows or hides; J/K moves a shown choice; typing filters. Each choice saves immediately, and the garden redraws under the card.",
  "",
  "The placement chip or ctrl+o puts this same card inline, floating, split, in a popup or in its own tile. Choose split and change layout while watching the collection. The query wraps to show its whole value. Esc closes settings and returns to the picked note. Open Sources to see the collection's question, layout, row count and when it was asked; r asks again.",
  "",
  "The keys stay here in this note. An agent uses settings.toggle key=layout value=board or settings.set key=sort value=\"stage desc, owner asc\"; its write is attributed and your cursor stays yours. settings lists the read revision; binding.set revision=<that revision> checks it.",
].join("\n");
