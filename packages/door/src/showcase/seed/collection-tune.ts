export const COLLECTION_TUNE = [
  "Tune the garden collection",
  "Press , over the view, or click ≡ settings. Layout is a toggle question; add board, then hide table. Group, Sort and summary-properties offer the properties these four notes carry. Space shows or hides; J/K moves a shown choice; typing filters. Each choice saves immediately, and the garden redraws under the card.",
  "",
  '::view{query="collection=garden" layout=table group=area sort="owner asc, stage desc" summary-properties="title, owner, stage"} ^garden',
  "::",
  "",
  "The keys stay here in this note. An agent uses settings.toggle key=layout value=board or settings.set key=sort value=\"stage desc, owner asc\"; its write is attributed and your cursor stays yours. settings lists the read revision; binding.set revision=<that revision> checks it.",
].join("\n");
