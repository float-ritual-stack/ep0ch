---
name: ep0ch
description: Use when an agent needs to see or act in an ep0ch door (the BBS-style terminal client for a pi-herdr-outliner outline) — reading what the person sees, opening a note in front of them, editing, commenting, moving cards or pointing at a block — or when running a door of its own. Covers the ep0ch command, the control socket, attribution and the rules that keep the person's door, focus and drafts safe. For writing in the outline itself use ep0ch-outline; for changing the door's or outliner's code, ep0ch-core.
---

# ep0ch: working in a door

ep0ch is a terminal door into an Outliner workspace: the board (kanban), desk, river and BBS screens, all
built on one note surface. Everything the person can do there, an agent can do through the door's control
socket, with the same checks (revisions, property warnings, duplicate-safe comments) and honest attribution.

Two sibling skills: `ep0ch-outline` for working in the outline for the person (notes, properties, views,
pages, publishing, extensions), and `ep0ch-core` for changing this code (including the real-pane test recipe).

## Commands

    ep0ch help                       everything below
    ep0ch --ws <name>                open the door on an outline of the outline host (created if none)
    ep0ch outline list [--json]      the host's outlines: name, open, default, adopted, root
    ep0ch outline attach <name> [--json]   open the door on it (--json: only attach, print the answer)
    ep0ch outline create <name> | adopt <path> <name> [--root <dir>] | stop <name> | delete <name> --yes
    ep0ch status [--json]            the host: socket, default outline, open outlines
    ep0ch where [--json]             which door, tile and Herdr pane this process runs in, and where the keys are
    ep0ch clients [--ws <root>]      who is connected to the service (every role)
    ep0ch peek                       the screen as text plus structured state
    ep0ch actions                    what the current screen can do, with arguments and keys
    ep0ch act <action> [key=value…] [--as <agent-id>]
    ep0ch open <block-id>            put a block in front of the person (the door says an agent did)
    ep0ch snap [out.png]             exactly what the terminal shows
    ep0ch try --ws <root> --copy --outliner <checkout>   your own door on a private copy of a workspace
    ep0ch --skill [<name>]           the stack's skills, or the path of one
    ep0ch doctor [--json]            the whole stack's state (✓ ! ✗) with a fix command for each; read-only
    ep0ch install [--json]           the update plan (a dry run); --apply runs it, --restart-services too

`bun src/main.ts …` in the door's checkout is the same command. The full action table is in the door's
README, section "Letting an agent see what you see, and do what you do" (`ep0ch --skill ep0ch` shows this
file's path; the README is two directories up).

## Checking and updating the stack

`ep0ch doctor --json` is the first thing to run when something in the stack seems off: bun, the Outliner
plugin (linked or managed, its commit against origin/main, its protocol), this checkout, `ep0ch` on PATH,
the outline host and per-folder services (flagging ones running old code), Herdr and its keys, and the
Claude mod. It only reads (`git fetch` aside).

`ep0ch install` without `--apply` is safe to run any time: it prints the plan. Run `--apply` only when the
person asked for the update. It backs up every outline database to `~/backups/ep0ch/` first, then
fast-forwards the plugin and door checkouts and links `ep0ch`. After a plugin update (or when the host runs
old code) it also restarts the outline host through its systemd or launchd unit, and every door and pane on
it reconnects: say so before you run it. `--restart-services` restarts the person's per-folder service
panes: never pass it unless they asked for that too. Install never writes a unit, Herdr's config or
Claude's settings; it reports them as notes.

## Which outline a door opens

With an outline host running (one socket per machine, outlines by name, like Herdr sessions):
`--ws <name>` opens that outline and creates it if there is none; `--ws <folder>` or no `--ws` opens the
nearest bound folder's outline (`client.json` `outline`), else the one named after the git repository
root, else after the folder. `$HOME`, `/` and folders directly under `/` name none: the door opens the
host's default and says so. `EP0CH_SOCKET` or a socket path overrides
all of this. Opening the door creates an outline; `outline list`, `status` and `clients` never do. The
status bar and `peek` show `host · outline`. Without a host, `--ws <root>` and discovery work as before.
Delete moves a created outline to `deleted/` (an adopted one is only unlinked); pass `--yes` only when the
person asked for it.

## Which door you reach

- **Inside a door** (a terminal tile, the agent drawer, the daily agent's Herdr pane, the door's drop shell),
  `EP0CH_CONTROL` is already that door's socket, `EP0CH_TILE` your tile's name and `EP0CH_NEST` the layers
  you run in. Run `ep0ch where` first: it checks each layer and says whether the person is typing in your
  tile. Open notes with `ep0ch act open id=<block> from=$EP0CH_TILE`, so they land where your tile's opens
  go; never name a reader you guessed.
- Otherwise the control commands talk to the door on `EP0CH_CONTROL`, or the default socket
  `~/.local/state/ep0ch-door/door.sock` — **usually the person's own door.**
- Act on the person's door only when they asked you to (show them something, make an edit they
  requested). Otherwise run your own: set `EP0CH_STATE` and `EP0CH_CONTROL` under a temp directory, start
  it with `ep0ch try … --copy` or against a scratch service, and pass the same `EP0CH_CONTROL` to every
  command. Keep that directory short and mode 700 (`mktemp -d /tmp/…`): a long socket path fails, and the
  door serves no socket in a folder others can reach. `ep0ch-core` has the whole recipe, mouse included.
- Name yourself: `EP0CH_AGENT=<your-id>` once, or `--as` on each `act`. The door records and shows it.

## Door tools in Claude

In a Claude session inside a door tile (`EP0CH_CONTROL` set), the Outliner's Claude mod adds `door_where`,
`door_peek`, `door_act` and `door_open`. They run `ep0ch` on that tile's socket. Prefer them to running
`ep0ch act` through Bash. Outside a door tile they aren't there: use the commands above.

**Three ways a door agent starts, one environment.** Each gets the same variables (`agentVars`,
`src/desk/agent-env.ts`): `EP0CH_CONTROL`, `EP0CH_TILE`, `EP0CH_TILE_ID`, `EP0CH_NEST`, `EP0CH_IN_DOOR`, and
the door's `EP0CH_STATE` and `EP0CH_SOCKET` when it has them.
1. `^W o s` on the desk, then `claude` in that shell: a terminal tile's program.
2. `D`, then the `daily` layout's `claude` tile: the door's own agent. On float-2 it runs in Herdr
   (`EP0CH_DAILY_AGENT=…/door-agent-herdr.ts`, the `door-claude` pane, `EP0CH_CONTROL` a link the launcher
   points at the attached door); elsewhere plain `claude` in the tile.
3. The `▲ claude` chip on the status bar, or `alt+a`: the same agent as 2, in a drawer over any screen.

**A Claude reads these, and the mod, only as it starts.** If the mod changed after it started (a `git pull` in
the Outliner), or it started without them, it has no door tools or old ones. The chip says so:
`▲ claude · door tools` when current, `▲ claude · started before update ⟳` (or `no door tools ⟳`) when not.
`ep0ch act agent.knows` says the same with why; `ep0ch doctor` lists every door agent on an older mod.
A click on `⟳`, `alt+R` or `ep0ch act agent.restart` restarts the door's agent, keeping the conversation
(`door-claude` continues; a bare `claude` gets `--continue`; in Herdr it comes back in a new `door-claude`
pane). Your `agent.restart` is refused while the person types in the agent. A `claude` you started in a tile
yourself (path 1): `/exit`, then `claude --continue`.

- **Who it's from:** each act and open goes with `--as`: the call's `actor`, else `OUTLINER_ACTOR`, else
  `EP0CH_AGENT`, else `claude-code`. The person's screen shows it.
- **`door_act {action, args, reader?}`:** `args` is `key: value`. `ep0ch` reads a value starting with `@` as
  a file, so the tool sends one such value through stdin, and refuses a second in the same call. `as` and
  `reader` aren't args: use `actor` and `reader`.
- **Refusals pass through:** when the door refuses (focus, keys, a reader the person is typing in), the tool
  fails with the door's reason. Don't route around it: set a `block.mark`, or wait until they're idle.
- **`door_open {id}`** takes an id, `((id))`, `[[page]]` or Work ID, and opens it where your tile's opens
  land (`from=$EP0CH_TILE`). It never moves the person's focus.
- To read or write notes, use the mod's `outline_*` tools (`outline_read`, `outline_edit`, `outline_patch`,
  `outline_comment`…). They work in any session, not just a door tile. Which to use when, and how the
  person writes, is the `ep0ch-outline` skill.

## Rules the door enforces, and you should expect

- An agent never takes the person's focus, keys, selection or the reader they're typing in; such actions
  are refused with the reason. Your selection, focus marks and backlinks views are your own.
- Writes carry the revision they read; a changed note is refused, never overwritten. Read again and retry.
- Drafts are never discarded: a refused save keeps the text; unsaved text is copied to disk on exit.
- Test data belongs in scratch services with fictional notes, never a real outline.
- Moving the person's screen (`screen.open`, `screen.back`, `list.*`, `agent.toggle open=true`) waits until
  they've been idle 2s and aren't typing, and is said on their status bar. `screen.shell` (drop to shell) is
  theirs only: yours is refused. Use a terminal tile (`tile.open kind=pty`) for a program of your own.

## Useful actions beyond notes

- **The agent drawer** (every screen): `agent.toggle [open=true|false]`, `agent.height share=0.2…0.9`,
  `agent.knows`, `agent.restart`. It never takes the person's keys; you can't put it away, resize it or
  restart its agent while they type in it. `peek` shows it as `dock` (with `knows`).
- **The outline tree's links:** `tree.links reader=<tree tile> n=<row>` shows a row's outlinks, resources and
  backlinks under it; `tree.pick n=<row> [open=true]` shows or opens one (`peek`'s `tree.rows` numbers them).
- **The desk:** `layout.get` (tiles, splits and tab sets by stable id, and `rev`), `tile.open`, `layout.move`,
  `block.mark reason=…` to ask for the person's attention. Pass `expected=<rev>` when you name by place.
- The full list and the rules for each are in the door's `docs/AGENT-INTERFACE.md`.

## When something looks wrong

`ep0ch peek` first (it shows the state the door acts on), then `ep0ch actions` for what's possible right
now. A refusal message says why and what to do instead.
