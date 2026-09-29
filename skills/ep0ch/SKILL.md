---
name: ep0ch
description: Use when an agent needs to see or act in an ep0ch door (the BBS-style terminal client for a pi-herdr-outliner outline) — reading what the person sees, opening a note in front of them, editing, commenting, moving cards or pointing at a block — or when running a door of its own to test changes. Covers the ep0ch command, the control socket, attribution and the rules that keep the person's door, focus and drafts safe.
---

# ep0ch: working in a door

ep0ch is a terminal door into an Outliner workspace: the board (kanban), desk, river and BBS screens, all
built on one note surface. Everything the person can do there, an agent can do through the door's control
socket, with the same checks (revisions, property warnings, duplicate-safe comments) and honest attribution.

## Commands

    ep0ch help                       everything below
    ep0ch --ws <name>                open the door on an outline of the outline host (created if none)
    ep0ch outline list [--json]      the host's outlines: name, open, default, adopted, root
    ep0ch outline attach <name> [--json]   open the door on it (--json: only attach, print the answer)
    ep0ch outline create <name> | adopt <path> <name> [--root <dir>] | stop <name> | delete <name> --yes
    ep0ch status [--json]            the host: socket, default outline, open outlines
    ep0ch clients [--ws <root>]      who is connected to the service (every role)
    ep0ch peek                       the screen as text plus structured state
    ep0ch actions                    what the current screen can do, with arguments and keys
    ep0ch act <action> [key=value…] [--as <agent-id>]
    ep0ch open <block-id>            put a block in front of the person (the door says an agent did)
    ep0ch snap [out.png]             exactly what the terminal shows
    ep0ch try --ws <root> --copy --outliner <checkout>   your own door on a private copy of a workspace
    ep0ch --skill [<name>]           the stack's skills, or the path of one

`bun src/main.ts …` in the door's checkout is the same command. The full action table is in the door's
README, section "Letting an agent see what you see, and do what you do" (`ep0ch --skill ep0ch` shows this
file's path; the README is two directories up).

## Which outline a door opens

With an outline host running (one socket per machine, outlines by name, like Herdr sessions):
`--ws <name>` opens that outline and creates it if there is none; `--ws <folder>` or no `--ws` opens the
folder's bound outline (its `client.json` `outline`, or the nearest bound folder above), else the outline
named after the folder; the home folder gets the host's default. `EP0CH_SOCKET` or a socket path overrides
all of this. Opening the door creates an outline; `outline list`, `status` and `clients` never do. The
status bar and `peek` show `host · outline`. Without a host, `--ws <root>` and discovery work as before.
Delete moves a created outline to `deleted/` (an adopted one is only unlinked); pass `--yes` only when the
person asked for it.

## Which door you reach

- The control commands talk to the door on `EP0CH_CONTROL`, or the default socket
  `~/.local/state/ep0ch-door/door.sock` — **usually the person's own door.**
- Act on the person's door only when they asked you to (show them something, make an edit they
  requested). Otherwise run your own: set `EP0CH_STATE` and `EP0CH_CONTROL` under a temp directory, start
  it with `ep0ch try … --copy` or against a scratch service, and pass the same `EP0CH_CONTROL` to every
  command.
- Name yourself: `EP0CH_AGENT=<your-id>` once, or `--as` on each `act`. The door records and shows it.

## Rules the door enforces, and you should expect

- An agent never takes the person's focus, keys, selection or the reader they're typing in; such actions
  are refused with the reason. Your selection, focus marks and backlinks views are your own.
- Writes carry the revision they read; a changed note is refused, never overwritten. Read again and retry.
- Drafts are never discarded: a refused save keeps the text; unsaved text is copied to disk on exit.
- Test data belongs in scratch services with fictional notes, never a real outline.

## When something looks wrong

`ep0ch peek` first (it shows the state the door acts on), then `ep0ch actions` for what's possible right
now. A refusal message says why and what to do instead.
