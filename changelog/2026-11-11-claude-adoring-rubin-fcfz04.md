### ep0ch in a native window, and a note as parts any client can draw (`notes.page`)

- **New: `ep0ch-native`,** the outline in a native GPU window drawn with Rune (`packages/native`): the tree, the open note with its links, live figures and query-backed components, the details the service has on it, find (⌘K), query with facets (⌘L), and writing at the revision that was read (⌘E, ⌘S). `cargo run --release -- -- --ws <outline>` in `packages/native`.
- **New: `notes.page`** answers a note as parts: its title and chips, prose as Markdown, and each component with the service's answer in it (a figure's props and its results as Markdown, a view's list, a links block's groups). A client that can't run outline-core draws any note and parses no Blockdown. The published page and `notes.page` read figures and links through the same readers.
- **Run:** `ep0ch install --apply` (PROTOCOL 321: host and clients together).
