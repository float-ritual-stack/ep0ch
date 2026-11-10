### A recorded comment you typed replays with its words (PIE-1718)

- **A typed comment records as one line:** `C`, your words, `^S` saves `comment.note body="…"` (whole note) or `comment quote="…" body="…"` (words selected with the mouse) at the tile it was written in, so the macro's key posts it again. A reply you type records as `reply thread=… body="…"`. Before, the recording saved `comment.note` without the words, and replay stopped there ("say body=").
- **A macro begun with the threads already open runs whole:** the close of threads opened before recording began is left out; replayed with nothing open, it refused. A close of threads the recording saw open stays.
- **A copy of your mouse selection is left out of a recording:** the selection itself is never a step, so the replayed copy found nothing selected.
- **Session keys (`C`, `m`, `e`) record their tile's id,** not `tile="reader"`, which named no tile on replay.
- **alt+Q records from your drawer too:** in the drawer it did nothing; it starts and stops a recording there as on a screen (never in a terminal tile).
- **Actions say how they record:** `ActionDef.record` takes a function of the finished step (its arguments and answer) besides `false`; `comment.send` answers with what it sent (`body`, `whole` or `quote`/`near`, `thread`).
- **Run:** `ep0ch install --apply` when it merges. PROTOCOL, GRAMMAR and the schema don't move.
