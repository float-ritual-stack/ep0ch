# Sysop

The boring infrastructure monk watches your machines and leaves one health note per machine per day.

## Where to look

- **[[sysop]]:** memory, load, disk and failed user units now, with a glyph a day below.
- **An open trip:** the page's warning band names the number, process, pid, RSS and restart command.
- **Waiting on you:** an ordinary trip note carries `needs` until the reading clears.

## What you do

- **Look now:** press the page's button, or `ep0ch ext run sysop action:look`.
- **Change the limits:** edit the page's `memory-free-min`, `load-max` and `disk-free-min` properties.
- **Calm a machine:** press its trip note's button, or `ep0ch act ext.sysop.calm machine=kiln`.

## Good to know

- **Every minute, once per host:** samples run in parallel, with an eight-second deadline each.
- **One alert per crossing:** changing numbers during the same trip do not page again.
- **The day's worst stays:** recovery clears `needs` and the warning band, but keeps a degraded day's glyph.
- **Sleeping is normal:** a missed sample says “asleep since” the first miss, including across midnight.
- **Your words stay:** ticks replace the generated figures and owned properties, preserving your other text.
  - Prose between figures stays; properties can move onto metadata lines.

## Setup

- **Install here:** `ep0ch ext add sysop --outline-folder ~/outlines/garden`.
- **First tick:** makes [[sysop]] with `machines` set to `float-2, float-box, laptop`.
- **Machines:** edit that comma-separated list to your ssh names; the host's own name runs locally.
- **SSH:** uses the host user's existing connection and agent; it never prompts for a password.
- **Warning bands:** install `shout` with `ep0ch ext add shout`; the warning text is readable without it.
- **Remove:** `ep0ch ext remove sysop --demo remove` trashes its unchanged output and demos.
  - A note you edited or added children under stays, and the removal answer names it.
  - A running call finishes before cleanup, so it cannot leave new notes behind.

## How it works

- **The notes:** `machine=health`, `sysop-machine`, `date`, `status`, latest numbers and timed trips.
- **History queries:** use `machinery: show`; routine lists leave health notes out.
- **Linux:** reads `free`, loadavg, `nproc`, `df`, failed user units, RSS and cgroups.
- **macOS:** reads `sysctl`, `vm_stat`, `df` and RSS; memory free includes inactive pages.
  - macOS has no systemd user units; this watch does not invent an equivalent failure state.
- **A restart:** the recorded user unit or Docker container only; it never kills a pid.
  - Calm waits up to 35 seconds, then samples again; invalid thresholds stay visible and no restart runs.
- **Local user units:** inherit the host's systemd session; a failed query is an unavailable sample.
- **Attribution:** the extension grant records `ext:sysop`, with whoever asked for `calm` beside it.
- **Door messages:** a manual action answers in that door's message line.
  - A scheduled run writes the page's warning and `needs`; it cannot broadcast a transient message to every door.
