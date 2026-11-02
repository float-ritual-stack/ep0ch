---
name: whats-moving
description: Use when someone asks what's been happening, what's moving, or for recent activity, across their ep0ch outlines, one outline, or with their other connected tools; and when they ask to follow what came up further.
---
# What's moving

Dials (from the ask; defaults in brackets): scope [every outline list_outlines shows], window [since the asker's last visit, else 24h], integrations [none unless named or the ask says "everything"], depth [0 hops].

1. One call per outline: outline_query `updated >= -<window> NOT type=peer-message`, sort `updated desc`, fields `id,title,updated,actor,path`, fold true, limit 25, your `call` id (your own writes drop out). Skip each outline's Recent-files tree with `NOT under:` when it has one. Say how stale a mirror is (asOf), and when `more` or `truncated` makes the window partial.
2. Group by actor (people, then each agent) and by thread or project. Lead with what changed state: a ticket's work-stage, a decision, something shipped or broken. Fold routine logs (tidy passes, watches) into one line each.
3. Read only the rows the answer needs; pass `seen` on every later read.
4. Depth > 0: from each lead row, outline_links (both directions) one hop at a time; keep a hop only if it's newer than the window or it explains why the row matters. Stop at the depth or when nothing new turns up.
5. Integrations: one query each, same window (calendar: what's next and what just happened; mail/slack: threads with replies the asker hasn't answered; tracker: items that changed state). Never paste message bodies.
6. Answer as a short tree a phone can read: what moved, who moved it, what's waiting on the asker (only that). Offer nothing; end on what's held.

Power tools (the asker says "deep", or the walk would take more than ~10 reads, or it spans months): outline_snapshot (add `?gz=1`), check the sha256, put the file at `$D/<name>.sqlite`, and run a scratch host in the repo (`HOME=$D EP0CH_OUTLINES=$D bun run src/host-main.ts` in packages/outliner). Then `bun run src/cli.ts --ws <name> list --query … --fields title,properties,timestamps --facets …` composes in scripts with the app's own query logic, and only the summary reaches your context. Raw SQL only for what the CLI can't ask. Never write to the snapshot's host.
