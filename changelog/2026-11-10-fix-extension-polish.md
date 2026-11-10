### Installing an extension reads right (PIE-1705)

- **An install row reads from its first word:** with its preview up (under the list at 44 columns, beside it at full width), the lit row's description is cut at its end, `…`, and stays so; the preview reads it whole. It no longer scrolls to rest on its last words, mid-word. With no preview, the lit row still scrolls (PIE-1405).
- **A command setting can say "none":** `ep0ch act ext.yo.settings answer='[]'` (or `[]` in its settings form) is yo with no model; the form and the settings row read it back as `[]`. An empty value still takes the field out, back to its default, as `unset=` does.
- **An extension's arguments are its own:** `ep0ch actions`, an action's docs page and the bar's form leave out the door's own words (`door:via`, `door:asked`); `act` still takes them, and the control socket's `actions` answer names them apart, as `doorWords`.
- **An adoption is said where you look:** when a host restart turns an old outline's seeded deploy rule and script into the Artifact deploy kit, a note under the kit's page links the two notes in Trash and says how to have them back.
- **Run:** `ep0ch install --apply` (door and outliner). PROTOCOL, GRAMMAR and the schema don't move.
