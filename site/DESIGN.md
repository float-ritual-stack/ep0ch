# The ep0ch docs site: design system

The system for the docs site PIE-523 asks for: one shell with two jobs, **Showcase** (what the door does, in
motion) and **Build** (guides for adding to it). This file is the spec. [kitchen-sink.html](kitchen-sink.html) draws
every token and component. [showcase/callouts.html](showcase/callouts.html) (a feature, PIE-538) and
[build/callout-type.html](build/callout-type.html) (a guide) are the two sample pages.

Out of scope here: the full docs content, the tour recording pipeline (`docs/tours/*.ts`, PIE-523) and hosting.

```
site/
  DESIGN.md            this spec
  kitchen-sink.html    every component, with purpose, anatomy, do and don't
  showcase/*.html      feature pages, one per showcase section
  build/*.html         guides
  assets/tokens.css    written by tokens.ts from packages/door/src/theme.ts; don't edit
  assets/site.css      the shell and the components, from tokens only
  assets/site.js       cast players, copy, try-it ticks, the calm/night switch
  casts/*.cast         asciicast v2, one per showcase section, chapters as `m` markers
  vendor/              asciinema-player 3.10.0 (Apache-2.0), self-hosted
  tokens.ts            bun site/tokens.ts
  still.ts             bun site/still.ts <file.ansi | file.cast> [frame]
  check.ts             bun site/check.ts: the done-check
```

## Decisions this inherits

From the brief and PIE-523. They're settled.

- **Show, don't tell.** A feature page leads with a scrubbable cast with chapters. Prose explains what the cast
  can't.
- **Dark only.** No light theme, and no white flash on load or navigation. The door's two dark themes, calm and
  night, are both offered (night for late hours and sensitive eyes).
- **The terminal look is the product's own,** so the door's palette and type are the source tokens.
- **Concise examples:** every sample is the smallest complete thing that runs, with no `...` elisions.
- **One demo source.** Casts are the showcase's sections (`ep0ch --showcase`, `packages/door/src/showcase/`),
  driven through `act`. The site never stages a demo of its own.
- **asciinema `.cast` files and the self-hosted player,** recorded in plain cells mode (the player can't draw
  Kitty graphics or the CRT).
- **The glossary's words** (docs/UI-GRAMMAR.md): block, tile, container, screen. "Pane" is Herdr's or tmux's box.

## 1. Information architecture

| Section | Holds | Its pages come from |
|---|---|---|
| **Showcase** | Feature pages, grouped the way the showcase groups its needs: reading, writing, tiles and screens, agents, outlines and machines | One page per showcase section; its cast is that section driven by a tour |
| **Build** | Guides in two halves. *Configure* is a note: callout types, screens, key bindings. *Extend* is a folder: data, inline output, rich component, tile, `@agent`, a door of your own | The extension contract (packages/outliner `docs/extensions/README.md`) and the built-in examples |
| **Reference** | Actions, properties, `extension.json`, wire methods, the CLIs | Generated from `ep0ch actions`, outline-core's types and `--help` output, never hand-written |
| **Concepts** | Block, tile, container, screen; actors and attribution; two clients, one outline; outlines by name | The glossary |

The app is moving to a small kernel, with features as configuration plus deletable extensions, so Build is as
large as Showcase, not an appendix. Every feature page links to the guide that extends it, and every guide links
back to the feature it extends.

URLs: `/showcase/<section key>.html` (the showcase's own key: `callouts`), `/build/<what you make>.html`,
`/reference/<action or file>.html`, `/concepts/<word>.html`.

### Page types, and what the first screen answers

"First screen" means without scrolling, at 1280×900 and at 400×860.

| Type | The first screen answers | Then, in this order |
|---|---|---|
| **Feature** | What it is and why you'd use it, in a lede of two or three sentences; the start of its cast, with its chapters visible | Try it · write or use it · every action three ways · the types or options · reference |
| **Guide** | What you'll make (the finished result, drawn as a still); why you'd want it; its kind (configure or extend) and size (steps, code or not) | Concept · example as steps · change it · reference |
| **Reference** | The signature or grammar, what it touches, where it's defined | Arguments · errors and refusals · related actions |
| **Concept** | A one-sentence definition, and when you'll need it | A drawing · how the parts fit · the guides that use it |

Every page has a `kind` eyebrow (Feature, Guide, Reference, Concept), an h1, a lede, and a meta line with its
source: the showcase section, the work id, the kind of extension.

## 2. Tokens

### Colour roles

Pages and components ask for **roles**, never colours. `bun site/tokens.ts` writes every role from
`packages/door/src/theme.ts`: calm on `:root` and night on `:root[data-tone="night"]`. A theme change in the
door is one command away from the site. The roles follow the door's own reading of its palette (theme.ts's
comments, outline-core's callout tones, the door's `TONE`).

| Role | From the door | Used for |
|---|---|---|
| `surface-ground` | the ground (palette 0) | the page, the terminal well |
| `surface-sunk` | the ground, darker | code and cast wells |
| `surface-raised` | `tint.embed` | callouts, signatures, chips |
| `surface-bar` | the bars (palette 1) | status bar, player controls |
| `surface-select` | `tint.select` | the current chapter, the current page |
| `surface-ruler` | `tint.ruler` | the line in focus |
| `surface-agent` | `tint.agent` | an agent's selection |
| `line-frame`, `line-quiet` | bars toward dim | frames; rules inside a frame |
| `ink-body` | grey (7) | running text |
| `ink-strong` | white (15), never #fff | titles, code |
| `ink-dim` | dark (8) | metadata, hints, captions |
| `ink-heading` | yellow (14) | section headings, as the door draws `##` |
| `ink-link` | light cyan (11) | links and focus |
| `ink-agent` | light magenta (13) | `act`, and anything an agent did |
| `ink-key` | light blue (9) | a key's glyph |
| `ink-add`, `ink-remove` | light green, light red | diff lines, done steps, errors |
| `tone-blue` … `tone-neutral` | the six callout tones | callouts, through the type |
| `term-0` … `term-15` | the 16 palette entries | the cast player, stills |

The page's ground is `#0d1016` (calm) and its brightest text is off-white. Every text and background pair is the
door's, which `test/theme-contrast.test.ts` checks against WCAG 2.

### Type

The door is set in cells, so the site is too wherever it speaks for the door: headings, chrome, code, keys and
stills use **JetBrains Mono**. Prose uses **Atkinson Hyperlegible Next**, built for legibility, at a 68-character
measure. Both come from Google Fonts, with system fallbacks.

| Step | Size | Face | Used for |
|---|---|---|---|
| h1 | 33px | mono 700 | the page's title |
| h2 | 23px | mono 700, `ink-heading` | sections, drawn as a tile header with its rule running to the edge |
| h3 | 19px | mono 600 | at most one level inside a section |
| lede | 19px | prose | the page's opening two or three sentences |
| body | 17px | prose, line height 1.6 | running text |
| small | 15px | mono | code, tables, the index |
| caption | 13px | mono, `ink-dim` | meta lines, chips, cast source line |

Guides number their h2s (1 A type is a note, 2 Make one…) because their order is the reading order. Feature
pages don't.

### Spacing

A 4px base: `--s1` 4, `--s2` 8, `--s3` 12, `--s4` 16, `--s5` 24, `--s6` 32, `--s7` 48, `--s8` 64. Inside a
frame is 12 to 16; between blocks of a section, 24; the side gutter never goes under 16. Corners are 2px
(terminals barely have them); callouts are 6px, as the door's rounded frames.

### Surfaces

- **Code well** (`surface-sunk`, framed, with a file label): text you copy.
- **Terminal well** (`surface-ground`, framed): what the door drew, cell for cell, from `ep0ch show --ansi` or a
  cast frame, made HTML by `still.ts`. Palette colours become `var(--term-N)`, so a still follows the
  calm/night switch. A glyph a mono face may lack (♨, ℹ, ※) is held to one cell, as the door holds it, so frames
  stay square. Never a screenshot where a still can go.
- **Raised** (`surface-raised`): an object set apart, such as a callout or a signature.

### No light flash

Every page's head starts with this, before any link, script or font:

```html
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#0d1016">
<style>html{background:#0d1016;color:#c8cace;color-scheme:dark}</style>
<script>try{if(localStorage.getItem("ep0ch-docs-tone")==="night")document.documentElement.dataset.tone="night"}catch(e){}</script>
```

The ground is painted before anything loads, so navigating between pages goes dark to dark. A cast shows its
first frame as text before the player loads.

## 3. Components

Each is drawn in the kitchen sink, with its anatomy and its do and don't. In short:

| Component | Purpose | Anatomy | Do / don't |
|---|---|---|---|
| **Cast player with chapters** | Show a feature working, as a recording you pause, scrub and jump through | head (what, who drives it, length) · screen (asciinema-player; the first frame as text until it loads) · chapters (the cast's own `m` markers; click seeks and plays; current one selected) · foot (keys; where recorded: section, size, theme) | Do: record a showcase section through a tour; name chapters by what happens; under a minute and eight chapters. Don't: GIFs or video; a real outline; autoplay; "Step 3" |
| **Code example** | The smallest complete thing that runs, ready to copy | file label (`shell`, a path, or `note · title`) · language · copy (copies what's shown; a diff copies its result; falls back to selecting) · optional "says" line | Do: one command per block; made-up notes; find notes by an exact property. Don't: `...`; a `$` prompt; `<id>` placeholders |
| **Keybinding chip** | Name how to do it, all three ways | key chip (the door's names: `⏎`, `^W`, `ctrl`) · mouse chip (dashed: the thing you click) · act chip (the action and arguments exactly as `ep0ch act` takes them) · the three-ways table | Do: every action gets keys, mouse and act, with "none" where a way doesn't exist; copy keys from `ep0ch actions`. Don't: "Cmd" in prose; a key that screen doesn't bind |
| **Callout set** | Set apart the few lines a reader mustn't miss | the door's own types, icons and six tones; title row with the type's name at the end; a foldable one is a `<details>` | Do: warning and danger only for real risk; short. Don't: stack them; use one as a heading; invent a tone |
| **API signature block** | One action, method or type at a glance | signature as `act` or the wire takes it · about · facts (touches, draft, replay, keys) · arguments · source file | Do: generate it from the registry; show what it touches. Don't: hand-write what the registry prints |
| **"Try it" step list** | Do it yourself, knowing each step worked | `[ ]` box and number (a click ticks it, kept in this browser) · one action · optional command · "you see" | Do: three to six steps, with what you see after each. Don't: hide a decision in a step |
| **Breadcrumb, prev/next** | Where the page sits; where to go next | crumbs: section › group › page (the door's crumb line) · prev/next cards in reading order | Do: pair a feature with the guide that extends it. Don't: link the last crumb; point at an unwritten page |

The shell around them: a masthead (`─=[ ep0ch docs ]=─`, the showcase's own banner, and the four sections), an
index tile on the left (the showcase's index: groups, the current page selected, planned pages listed dim
without links, after the page on a phone), and the door's status bar at the foot (where you are, and the
calm/night switch).

## 4. Content rules

- **Headings go two deep:** the title, sections (h2), and at most one level inside (h3). Something that wants an
  h4 is a second page.
- **One idea per section.** If its heading needs "and", split it.
- **A guide goes concept, example, reference.** One short concept section that names the parts and how they
  connect. Then the example as steps that run, each saying what you'll see. Then how to change it. Then the full
  reference: every property or argument, what happens when it's wrong, the types.
- **Show, then tell.** The cast first; prose for the why, the grammar and the edge cases.
- **Every action, three ways:** keys, mouse, `act`. Mouse and agents are first-class.
- **An agent's action is attributed.** Pages say what an agent may and may not do (the type choice is the
  person's; an agent uses `callout.type`), and show the on-screen attribution.
- **Made-up notes** in every example, cast and still: an allotment, a kitchen, a bike shed. Never a real outline.
- **Link, don't direct.** A link to the section, never "see below".
- **Plain sentences from the reader's side:** "the type choice opens", not "the ListPicker is instantiated".

## 5. Casts

- **Source:** one showcase section per feature page, driven through the door's control socket (`act`, plus keys
  and SGR mouse where the mouse is the point), on the showcase's scratch outline. A test already drives each
  section (`packages/door/test/showcase.test.ts`); the tour drives the same actions, so the demo, its test and its
  cast agree.
- **Chapters:** one `m` marker per tour step, labelled by what happens. The page draws its chapter list from the
  cast's markers once it loads (the list in the HTML is the at-rest copy), so a re-recorded tour can't leave stale
  chapters behind.
- **Size:** 110×40 cells, the calm theme, cells mode. Under a minute, at most eight chapters.
- **Today:** `casts/callouts.cast` was recorded by a one-off script that drove a test door's showcase (`section`,
  `fold`, `unfold`, `callout.type`, `callout.undo`, `scroll`) and captured each state. PIE-523's tours replace it
  with `docs/tours/callouts.ts` and one command that re-records every tour.

## 6. Checks

`bun site/check.ts` is the done-check.

- **Pages:** every page paints its ground before its first link or script, in the calm theme's own ground and
  text colours, and declares `color-scheme: dark`.
  Each page is screenshotted in headless Chromium three ways: with every stylesheet and script stripped (what
  paints before they arrive), at 1280×900 and at 400×860. Each must have a dark ground and under 3% light
  pixels.
- **Samples:** on a scratch outline host it starts under a temp dir (ready when it answers
  `ep0ch outline create`, not when its socket appears), it runs every example marked to run, in page order, with
  only what a reader has: `ep0ch` on PATH, and no `outliner`:
  - `data-run="sh"`: the block's text in bash;
  - `data-run="note"` with `data-query`: the block's text made a note (what a reader writes in the door), then
    drawn with `ep0ch show`;
  - `data-run="edit"` with `data-query`: a diff's `+` lines become the first lines of the note the query finds,
    done when the host reads the note back changed.

  `data-expect` is text the output must contain. Examples that need a running door (`act` lines) are the actions
  `showcase.test.ts` drives.
