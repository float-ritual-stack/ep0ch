# Image lines: `img::` reference

A picture in a note is a line of its own: the picture's path and, beside it, its layout as properties. This page is
the whole of it in one place: the grammar, the properties, the paths it takes and where it draws. The grammar is
outline-core's (`src/media-line.ts`, `parseMediaLine` and `MediaSpec`), so the door, the outliner, the publisher and
the image actions read a line the same way; the door draws it (`src/doc.ts` `mediaRows`, `src/media.ts`).

## The line

A media line is a line that is only a media reference and its layout, after an optional list mark (`- `, `* `) and
indent, perhaps ending in a block anchor (` ^plot`). Two forms:

```
[img::~/shots/plot-at-dusk.png] [size::50%] [align::center] [alt::the plot at dusk]
img:: ~/shots/plot-at-dusk.png [size::50%]
```

- `[img::path]` (or `[image::path]`), then any of the layout properties, separated by blanks.
- `img:: path` (floatty's form): the path runs up to the first layout property.
- `[video::path]` is the same with a poster frame; `[artifact::path]` is a file claude.ai would run, drawn as a card
  (the door README, "Artifacts").

Anything else on the line (words, a property that isn't a layout one) makes it an ordinary line: `[img::…]` in a
sentence is not drawn. A media line is content, never a note's block properties, even right under its title.

## Properties

| Property | Values | What it does |
|---|---|---|
| `size` | cells (`40`), a share of the reader (`40%`), `full` | its width; the aspect is kept |
| `height` | rows (`12`) | its height; with `size` too, it fits inside both |
| `align` | `left` (default), `center`, `right` | where it sits across the reader |
| `layout` | `hero` | the note's header: drawn above the title, the full width; the first hero counts |
| `fit` | `cover` (default for a header), `contain` | a header taller than its room: cropped to fill, or shown whole |
| `dim` | `0` (as it is) … `1` (black) | how much it's dimmed; left out, a bright image is dimmed so it never outshines the door |
| `hero-focus` | `x,y` as fractions (`0.3,0.6`) or percents (`30%,60%`) | the point a header's crop and the header backdrop keep in view |
| `alt` | words | what it shows: said on its caption, and a page's alt text |

Left out, an image is about half its own pixels wide (at least 24 cells, never past the reader), at most about four
fifths of the reader tall. A value that isn't one of these is said on its caption in yellow (`size::huge isn't a
size`), and the line is still drawn. A property written twice: the first counts, and the caption says so.

## Paths

- An absolute path, or `~/…` (the home folder of the machine the door runs on).
- Quoted, as a dropped or copied path with spaces arrives: `[img::'/shots/plot at dusk.png']` or `"…"`.
- `\ ` for a space, as a shell writes it: `[img::/shots/plot\ at\ dusk.png]`.
- macOS screenshot names: the narrow no-break space before AM/PM is found either way.
- A relative path is read from the door's own folder, so write it absolute (or `~/…`); a picture pasted into a draft
  (`ctrl+v`, `draft.image`) is copied into the outline's folder (`media/<day>-<hash>.<ext>`) and written absolute.
- In an extension's view, an `image` primitive's `src` is the same path, or a `file:/absolute/path` Resource ref.

The file is read on the machine the door runs on. PNG, JPEG, WebP and GIF (its first frame) decode through sharp;
video needs `ffmpeg` (Quick Look on a Mac). A web page serves a picture only from inside the publish roots.

## Where it draws

| Where | How |
|---|---|
| A reader, a detail tile, the river (the door) | Under Kitty graphics: the picture, scaled to its box and dimmed dark-first, its rows kept dark while it loads, its caption under it (name, size, layout, `[−][+] [◂][▸] [▀]`). Without graphics (`alt+v` to cells, or a terminal without them): the caption, saying why |
| The header (`[layout::hero]`) | Above the title, the full width; as it scrolls under the sticky header, the header takes a muted crop of it as its background |
| An extension's view (`image` primitive, PIE-827) | Laid out as a note's image line, inside the view's card, box or row; `caption: false` draws the picture alone (a card's cover) |
| A web page (the publisher) | `<figure>` with the served image and its alt as the caption (none for a view's image with `caption: false`), or its words and file name where it may not be served |
| Elsewhere (Markdown, an export, MCP) | Its words and its file, never the picture: those readers can't reach the outline's files |
| Detail (the outliner's Herdr console) | The line as written |

A picture is placed under the text, and its cells are drawn on the terminal's own background, whatever tints the
rows around it (an extension's region, the ruler, a box): a terminal that draws pictures under every cell with a
background of its own (Tern) would otherwise show an empty box (PIE-839).

## Changing one

In the door, an image's caption is its `[ ]` element: `⏎` opens the file, `+` `-` step its width, `←` `→` move it,
`H` makes it the header, `=` shows a header whole or cropped; the caption's controls do the same by mouse. Each
rewrites the line through the note's save (attributed, revision-checked, undoable). Agents: `images` lists a note's
images, then `image.size`, `image.align`, `image.hero`, `image.fit`, `image.dim` (`ep0ch act …`).
