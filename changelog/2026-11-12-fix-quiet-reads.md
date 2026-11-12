### An agent's reads stay quiet, and closing a reader keeps its note on screen (PIE-1772)

- **Reads say nothing:** an agent's `layout.get`, `view.get`, `layout.list`, `marks.list` and the other reads no longer flash "an agent (…) · layout.get" on the person's screen. Writes are still said, with the agent's name.
- **The action says it's a read:** `ActionDef.reads` declares it (no list in the toast code); `actions` lists it as `reads: true`, and its action page says "only reads". Quiet in yolo too; an action that opens something for whoever stands as the person (`search`, `revisions`) isn't a read and is still said.
- **A close keeps the note:** `^W v` on a reader, then `^W x` (or its ×) on the reader while the detail beside it is still empty: the detail takes the note and the reader's back and forward. Before, it was left "detail · empty". A detail already showing a note keeps its own.
- **Run:** nothing; no PROTOCOL, GRAMMAR or schema change.
