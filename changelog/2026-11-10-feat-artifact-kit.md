### Artifact deploy on save is a kit you install per outline (PIE-1509)

- **Artifact deploy is on the extensions screen:** ctrl+k, `&artifact`, install; a saved note naming an `ep0ch-artifacts` repo deploys it, as before. Its remove row (or `ep0ch act extensions.uninstall id=artifact-deploy demo=keep`) turns it off in that outline alone.
- **The host no longer writes a deploy rule and script into every outline at start.** A fresh outline deploys nothing until the kit is installed.
- **Outlines that deploy today carry on with nothing to redo:** at the next start the host installs the kit in the outline's own folder and moves the two seeded notes to Trash. Seeded notes someone edited stay as their own rule.
- **A manifest rule can run a script its extension ships:** `"on": { "start": "script:<name>" }`, with no `run` program (docs/extensions, `on`).
- **`installs: "outline"`** on a built-in puts it in the outline's own folder when the install row doesn't say where; `ep0ch ext add <id>` asks the outline's host to install it there too.
- **The install row's preview no longer says "for every outline this host serves"** for every built-in: where it goes is in what it adds.
- **Run:** `ep0ch install --apply`. PROTOCOL, GRAMMAR and the schema don't move.
