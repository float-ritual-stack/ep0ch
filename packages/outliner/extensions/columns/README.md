# Columns

Write `columns::` on a note and the notes under it become sections drawn side by side. When the reader is too
narrow they stack, one under the other: under 24 characters a column, in the door, Detail and on the web alike.

- `columns::` takes one column per section (at most four). `columns:: 2` shows the first two.
- Or write the sections in the block itself under the line, split by a line of `|||`.
- Each child note is a section: its first line is the section's title, the rest is its words, drawn as each reader
  draws a note (headings, lists, links and properties read as written).
- Editing a section, adding one or moving one away redraws the line by itself.
- The sections stay ordinary notes; the line only decides how a reader lays them out. A Markdown export reads them in
  order, as they are written.
