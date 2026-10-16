---
paths:
  - "packages/outline-core/src/{outline-location,machine}.ts"
  - "packages/door/src/{home,pick,where,outlines,machine,discover,main,socket,control}.ts"
  - "packages/door/src/{session,setup}/**"
  - "packages/door/src/desk/{agent-env,drawer-program,herdr-agent}.ts"
  - "packages/outliner/src/{choose-outline-main,outline-chooser,machine-forward,machine-name,paths,cli,client,outline-host,outline-host-client,herdr-open}.ts"
  - "packages/claude-mod/hooks/**"
---

# Outlines by name: the details

The root `AGENTS.md` ("Outlines by name") has the order a client picks an outline in. This file has the rest, for
changing the code that picks an outline or a machine. Claude Code loads it when you touch that code; other tools read
it before changing it.

## The outline

- `.ep0ch/config.toml` holds names only: `ws = "<name>"`, `machine = "<ssh-name>"` for an outline on another machine, and
  `agent = "<persona>"`, the name an agent working in this folder writes as (ADR 0003: recorded, never a permission).
- The shared reader also accepts an old `.ep0ch` file. `ep0ch doctor --fix` and install move it to
  `.ep0ch/config.toml`, keeping `.ep0ch.bak`. Scripts load only from the outline folder’s `.ep0ch/scripts/`
  with `// ep0ch-script` on their first line; moving old `scripts/` requires `doctor --fix --move-scripts`.
- A folder that names none gets the home base (the door's `home` screen: open, new or import, here or on a machine),
  never a guess taken silently and never a default.
- Outlines are `<EP0CH_OUTLINES or ~/outlines>/<name>.sqlite`, each with its own folder `<name>/` beside it. The
  host's socket and lock are in `.host/`, with `machine-name`: this machine's own name in `ep0ch://` URIs and EchoNet
  (the ssh name other machines reach it by; `ep0ch install --apply` writes it, `EP0CH_MACHINE_NAME` overrides, else the
  host name).

## The machine

- First match wins: `--machine <ssh-name>`, then `EP0CH_MACHINE`, then the `machine` of the nearest `.ep0ch` when it
  names the same outline. A machine is an ssh config name; ssh owns its keys and hops.
  Under `scripts/agent-env` (EP0CH_AGENT_ENV set, unless `EP0CH_SSH` is a fake in the temp folder) only `--machine` counts: the other two are
  set aside and said on stderr (`scratchEnv`, `ignoredMachineNote`; PIE-912).
- Every client reaches it through one shared ssh forward, `<outlines>/.remote/<ssh-name>.sock`, started by the first
  client that needs it (outline-core's `src/machine.ts`, `ensureForward`). `<outlines>/.remote/<ssh-name>.json`
  (`{ "outlines": "/abs/folder" }`) names that machine's outlines folder when its own `ep0ch status` isn't the host
  to reach. `EP0CH_SOCKET` names any host's socket outright, the low-level escape hatch.

## Creating one

A name nobody has yet is created when a client opens it on this machine (like `herdr --session`), never on another
machine (PIE-545): there (`--machine`, `--remote`, a `.ep0ch`'s `machine`) it is refused with the exact commands, or
the door's home base offers the choices (the one here, create it there, cancel). Only `--create`, `outline create`
or the home base's "new outline on <machine>" makes one there. The rule is outline-core's `mayCreate`; `--here`
names this machine over `EP0CH_MACHINE` and a `.ep0ch`'s machine.

## Sessions

A session's outline is named (flag, `EP0CH_WS`, the folder it started in), never inferred from where its shell is
now. The door passes `EP0CH_WS` (and `EP0CH_MACHINE` for another machine) to every program it starts; a session that
loses its binding gets it back with `/outline <name>` or the mod's `outline_bind`.
