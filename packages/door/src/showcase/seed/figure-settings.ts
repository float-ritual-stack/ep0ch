// The figure settings seed (PIE-1513): a sprint-like note with one live ::graph-table in its YAML form, so the showcase
// can open the table's own settings (≡, or `,`) and switch it to a feed. Fictional garden work; the showcase's rules.
export const FIGURE_SETTINGS = [
  "Sprint: the garden week",
  "Comma or ≡ opens this table's own settings: the keys a ::graph-table reads, written into its YAML.",
  "",
  "::graph-table ^sprint",
  "---",
  "title: This week's garden work",
  "query: collection=garden",
  "columns: [title, owner, stage]",
  "sort: title",
  "direction: asc",
  "---",
  "::",
  "",
  "Pick layout, then space on feed: table and feed become tabs over the same rows, as in a view, drawn by the views' renderer, and `layout: \"feed, table\"` is written into the block above (ctrl+z takes it back); click a tab to switch. Drag the table's bottom edge: it follows the pointer and says its rows until you let go. Reopen the note: still a feed. columns offers the properties these notes carry; a key the table doesn't take (write `layot:` by hand) is said under the figure and on the write, with the one it may mean.",
  "",
  "An agent does the same with settings list=^sprint, then settings.set key=layout value=feed; its write is attributed and your cursor stays yours.",
].join("\n");
