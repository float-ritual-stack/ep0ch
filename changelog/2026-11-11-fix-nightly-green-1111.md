### Main's nightly is green again, and `ep0ch show` draws in half the time (PIE-1736, PIE-1735, PIE-1692)

- **An agent's block-id target goes to its own pointer again:** since PIE-1725 a `tile=<note id>` handed on to the screen's desk had lost who asked, so an agent with a pointer got the person's first reader; the id now travels as written and that desk ranks by the agent's pointer (the agent-focus showcase).
- **`ep0ch show` waits once, not twice:** the quiet spell for what a reader reads now runs from the last answer that arrived, not from each draw, and draws again each spell while a render script still runs. A plain note draws in about 290 ms instead of 530 ms, so every agent write's answer, which draws through `show` (PIE-588), is that much quicker.
- **The settings card names its keys from their tables:** its foot says the keymap's own keys for edit, try, clear, the line's clear and the draft's close, so a rebind shows there.
- **Two glyphs read on a CP437 screen:** ⋮ draws as `:`, the settings gear ⚙ as `☼`.
- **Yo's page reads in ten seconds again:** its opening paragraph and two stacked bullets are split.
- **Tests caught up with what shipped:** a render error's advice only on a write (PIE-1604), Tree's refusals by kind (#1397), write answers carrying their view (PIE-588), a refused bar line put under "this session" (PIE-1701), the door's own `door:asked` word (PIE-1676), the log's own row for new messages (PIE-1732), `--prepare`'s line (PIE-1714), the drawer's alt+Q check (PIE-1718), and the mod test's import.
- **Slow tests back near their last green time:** host-stalls warms its host before it times the save and frees its sockets, so a failed check fails instead of holding `server.close()` for 120 s; yo's extension test hears an ask after 80 ms of quiet, as the other agent-request tests do.
- **Run:** `ep0ch install --apply` (the door's `show` and dispatcher; nothing on the host or the wire).
