# 0007: Surfaces about the current thing are shared parts: the attached surface, the glass and the strip

Status: accepted, 2026-10-21 (Evan's framing and calls, Oct 20 and 21; the designs linked below).

## Context

**The problem:** the door grew several surfaces that each do the same job their own way. The comment box, the edit preview, the
sources panel and the tune inspector each place themselves; hover previews drew a band across other tiles; tabs, breadcrumbs, the
tune panel's rows, the power bar's scopes and the status line each cut themselves short differently. Every new one was a new place
to get placement, keys, overflow and the way back wrong.
**The source:** Evan, Oct 21 3:15 AM, on the comment box: "the container to do things related to the current thing, but not the
actual current thing"; Oct 20, on hover: "a layer above the tiles … not aggressively chase after my cursor"; on narrow rows: tabs
"collapsed so short they fail to convey anything meaningful".
**Designs:** the element panel and bar (pie `056753fc`), the glass (pie `e5811240`), one strip (pie `03cc2e43`).

## Decision

**The attached surface:** work about the note in front of you, without leaving it (a comment, its sources, the edit preview, the
element panel, tune for this note), is one part with one set of placements: inline, floating within the tile's borders, split
either way and resizable, popup, its own tile. One placement menu, the same keys, the same way back. A new surface of this kind uses
it; it never places itself (PIE-1138 makes sources its second user).
**The glass:** things you keep above every screen are floats on the host layer (the drawer's layer), through the layout module's
`apply`, never a separate overlay list. Hover is a wire verb beside select, open and alt; its target defaults to a post-it on the
glass, whose history is the hover stack. A post-it is an ordinary tile: peel, pin, dock, tuck into the drawer.
**The strip:** a one-row run of segments with one current (tile tabs, breadcrumbs, tune's level and width rows, the power bar's
scopes, status chips, hint rows) is one part with one overflow rule: the current keeps its name, the others shrink to a number,
then ‹ › and a `+N` that opens a list; one set of keys.
**Clicks in collections:** only a link in prose navigates on the first click; a row, card or list item in any collection selects
and previews on a click and opens on a second click or ⏎ (UI-GRAMMAR, wire).
**Placement is state, not code:** where a surface sits is kept per person and per kind, changed by the menu or `act`, and visible to
peek; no client hard-codes where one goes.

## Consequences

- New surfaces of these kinds are built on the part, and a review asks which part they use; a second implementation is a finding.
- The parts land in slices (attached surface with PIE-1138; strip and glass from their designs), each with a kitchen sink
  section driven by its test.
- Overflow, placement and hover behave the same everywhere, so one fix reaches every user of a part.
