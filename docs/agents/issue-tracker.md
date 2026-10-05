# Issue tracker: the outline's workboard

Issues for this repo are **roadmap items** on the workboard in the folder's outline (the one `.ep0ch` names).
They are not GitHub issues and not files. Each one is a block with a Work ID (`PIE-123`). Before you plan,
change the state of an item or report a delivery, read the live contract **How this workboard works**
`d5b3e557-a166-4c50-baad-7a0ed8db8fe6`. It owns the working flow. If this file disagrees with it, the contract wins.
[roadmap-items.md](../../packages/outliner/pi-extension/skills/outliner-workflow/references/roadmap-items.md)
documents the metadata and the commands.

## Tools

In Claude Code, use the mod's tools: `work_create`, `work_set`, `work_stage`, `work_body`, `work_deliver`,
`work_complete`, `outline_read`, `outline_find`, `outline_comment`, `outline_reply` and `note_section`. Other
agents use the outliner CLI (`bun src/cli.ts work …` in `packages/outliner`, with `--author agent --actor <id>`).
Every write checks the revision you read (`expectedRevision`), so read the item first.

## Conventions

- **Item**: `work_create` with `title` (the outcome, with no Work ID), `body` (Markdown: a summary callout,
  then behavior and acceptance), `project`, `arc`, `tracks` and `priority`. `project` is `ep0ch-door` for the
  door and for work across packages, `pi-outliner` for the outline host and its Herdr clients. Copy `arc` and
  `track` from neighbouring items. The allocator gives it a Work ID beneath that project's work queue (its
  "Roadmap Item Source Library": `fbee72f7-4e0b-41d9-83b9-accd6b5fceef` for ep0ch-door,
  `3dc268a3-74de-4e6b-b858-b91d0d324f23` for pi-outliner). Leave `stage` out: new work starts `unprioritized`.
- **Spec**: one roadmap item whose body is the spec. A spec too large for one item can instead be a
  `[type::design-note]` block with `[source-block::<item uuid>]`, linked from an item.
- **Tickets from a spec**: one roadmap item each. Set `[source-block::<spec uuid>]` and
  `[depends-on::<blocker uuid>]` (block UUIDs, never Work IDs or titles). Create them blockers first.
- **Triage state**: the `triage` property, set with `work_set` (see `triage-labels.md`). `work-stage` owns the
  lifecycle. A triage role never moves an item into a batch or to `queued`: Evan commits the scope.
- **Comments**: `outline_comment` (on a quote or the whole item) and `outline_reply`. Rewrite the body with
  `work_body` or `note_section` when the current explanation changes. Don't append a diary.
- **Refer to items** by `((uuid|short label))` or `[[PIE-123]]` in outline text, and by name and Work ID in chat.

## When a skill says "publish to the issue tracker"

Search first (`outline_find` with `text`, or `query: "type=roadmap-item AND …"`) for an item with the same outcome.
If there is none, `work_create` and give back the Work ID and its `((ref))`.

## When a skill says "fetch the relevant ticket"

`outline_read` with the Work ID (`PIE-123`) or the UUID. Read its comments and children too.

## Closing work

Open PR: `work_deliver` (the item goes to review). Merged: validate. Accepted with linked proof:
`work_complete`. `done` is never set with `work_stage`. Retire an item into a replacement with
`work-stage=superseded` and `superseded-by`. That doesn't count as shipped.

## Wayfinding operations

Used by `/wayfinder`.

- **Map**: a roadmap item with `[triage::wayfinder-map]`. Its body holds the Destination, Notes,
  Decisions-so-far, Not yet specified and Out of scope.
- **Child ticket**: a roadmap item with `[source-block::<map uuid>]` and `[wayfinder-type::research|prototype|grilling|task]`,
  and the question in its body. Find children with `outline_find` `query: "source-block=<map uuid>"`.
- **Blocking**: `[depends-on::<uuid>]` on the blocked ticket. A ticket is unblocked when every item it depends
  on is `done`.
- **Frontier**: children that are not done or superseded, are unblocked and have no `claimed-by`. Oldest
  Work ID wins.
- **Claim**: before any work, `work_set` `claimed-by` to your actor id, and `work_stage` `doing`.
- **Resolve**: `note_section` "Answer" with the decision, then `work_complete` with the answer as proof. Then add
  a line (gist + `((uuid|name))`) to the map's Decisions-so-far.
