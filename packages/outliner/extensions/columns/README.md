# Columns

Write `columns::` on a note and the notes under it become sections drawn side by side. When the reader is too
narrow they stack, one under the other.

- `columns::` takes one column per section (at most four). `columns:: 2` shows the first two.
- Or write the sections in the block itself under the line, split by a line of `|||`: editing them redraws at once.
- Each child note is a section: its first line is the section's title, the rest is its words.
- The sections stay ordinary notes; the line only decides how a reader lays them out.
- Where a client can't lay them out, the notes under the line read in order, as they are written.
