# 0001: Ids, names and roles

Status: accepted, 2026-10-04.

## Context

Four bugs in one day (PR #172 and its reviews) had one cause: code used a **name**, the thing shown on screen,
where it meant an **identity** or a **role**:

- A preview moved to another screen followed "whatever tile is called `detail`" there, not the tile it followed
  before the move.
- A screen tile and a drawer tab (then called the dock) both named `kettle`: `tile.type tile=kettle` typed into the wrong terminal.
- `ep0ch where` trusted a tile id carried in a moved terminal's environment after the id had been reused.
- The Herdr pane label `door-claude` was treated as an identity, so a session for an outline named `claude`
  produced the same label and its pane was never closed.

Names get reached for first because they are what the screen shows. They are also the one kind of reference
that can collide, change, or come back meaning something else.

## Decision

Every reference to a tile, pane, note, outline, view or session is one of three kinds. Code says which.

| kind | answers | examples | survives |
|---|---|---|---|
| **id** | this exact one | a tile id (`t37`), a block `((uuid))`, a Herdr pane id, a session pid | renames and moves; ends with the thing |
| **name** | the one people call X | a tile name (`preview`), `[[page]]`, a pane label, an outline name | until renamed; can collide |
| **role** | whichever one does this job now | where opens from this reader land (`from=$EP0CH_TILE`), the drawer's agent, today's daily brief, `[welcome::1]`, a view's results | everything; resolved at the moment of use |

Rules:

1. **Store what the reference means.** When the code means *this exact one* (a follower, a link between tiles, a
   saved layout's references, a pane that must be closed later), keep the id. When it means *whichever does this
   job*, keep the role and resolve it each time. Store a name only when *the name itself* is what was meant: a
   person's `[[page]]` link, an outline named in `.ep0ch` (`ws = "<name>"`), a layout saved as `daily`. Those
   are chosen by a person, resolved by name on purpose, and renaming is their business (pages keep their old
   addresses as aliases). The bug is a name stored as a stand-in for an identity.
2. **Actions accept all three, and keep them apart.** An id is exact. A name is looked up in one scope, and an
   ambiguous name is refused with the candidates and their ids, never guessed. A role is resolved fresh where it's
   used (as `from=$EP0CH_TILE` already is for opens).
3. **Something outside the door is tracked by its own id.** Herdr panes by pane id, processes by pid, the
   outline's blocks by uuid. Labels and titles are display.
4. **Reserved names can't be produced by user data.** If a name is special (a legacy pane label, a built-in
   tile), names derived from user input must not be able to equal it (prefix or hash them).
5. **The outline side already works this way:** a block has an id, `[[page]]` is a name that keeps its old
   addresses as aliases, and views and `[welcome::n]` are roles. Keep it that way.

## Consequences

- New features say, for each reference they keep: id, name or role. The review checklist asks.
- Existing places that store a name as identity are bugs to fix as they're found (start with the four above, all
  fixed in #172).
- A name that is ambiguous is an error the person can act on, with the ids to pick from.
