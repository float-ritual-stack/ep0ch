---
name: daily-brief
description: Use when an agent drafts or updates the morning daily brief — the one outline note per day (type::daily-brief) that answers "what did I do yesterday, what do I need to do today" and that the ep0ch door opens on (T, --brief, , and . for other days). Covers the sources to read and in what order, the note's sections and live figures, provenance and dates, the word budget, and writing it through the Outliner CLI with revision checks.
---

# daily-brief: the morning brief

The brief is the welcoming coffee shop before heads-down work: one short note per day that says what
happened yesterday and what today needs. An agent drafts its prose once in the morning. Everything that
counts or lists work is a **live figure** that asks the outline on every render, so the brief never
goes stale where it matters. The door shows the newest brief (`ep0ch --brief`, or `T` on the main
menu), and `,` / `.` step to the previous and next day.

The design and a worked prototype hang under PIE-435 in the roadmap. Read them once.

## When

- The first agent session after 05:00, or when asked ("brief me", "draft today's brief").
- One brief per day. Later passes update sections of it; they never write a second brief for the day.
- Mid-day: something landed or broke that the person should know. Update one section (see "Updating").

## What a brief is, to the outline

The first line is the title and its block properties, so every tool finds it:

    Daily brief — 2026-03-11 [type::daily-brief] [brief-date::2026-03-11] [feed-sequence::42]

- `type::daily-brief` makes it a brief. The door and the "Earlier briefs" table query this.
- `brief-date` is the day it covers (YYYY-MM-DD, local). The door orders briefs by it, then by update.
- `feed-sequence` is the change-feed sequence the draft read up to: the next drafter's checkpoint.
- Put it beside the previous brief (the same parent as the newest `type=daily-brief`), so the briefs stay
  together. For the very first brief, ask the person where briefs live. Don't guess a place.
- No `[[yesterday]]` links: earlier briefs are reached by `,` in the door and by the live table.

## Sources, in this order

`outliner` below is `bun src/cli.ts` in the Outliner checkout (the installed plugin's root; `ep0ch --skill`
names it). Each command prints JSON.

1. **The previous brief and its checkpoint.**
   `outliner list --filter type=daily-brief --limit 50 --fields id,title,properties,timestamps`,
   then take the newest `brief-date`, and its `feed-sequence`.
2. **The change feed from that checkpoint:** `outliner changes --since <feed-sequence> --limit 200`.
   Page on with the `nextSequence` it returns until it stops. Record the last sequence you read.
   - If the answer is a reset (the window moved past the checkpoint), say so under Sources and rely on
     steps 3 and 4. Don't pretend the feed was complete.
3. **What changed in the last day:**
   `outliner list --query "updated >= -1d type=roadmap-item" --fields id,title,properties,timestamps`,
   and the same for deliveries and captures (`type=capture status=unprocessed` for what's waiting).
4. **Git logs of the active repos:** the repos the changed items name (their deliveries, `project::`).
   `git -C <repo> log --since=yesterday --oneline --all` and merged PRs (`gh pr list --state merged
   --search "merged:>=YYYY-MM-DD"`). Link the PR, not the commit.
5. **What the person touched:** `activity.recent` (mostly their own edits). There is no CLI command for it
   yet; ask the service socket for it, or read the door's Activity pane (`ep0ch peek` on a desk with an
   activity pane). If you can't reach it, say so under Sources.
6. **The briefing and batch notes:** the overnight briefing note, the open batch notes (the blocks the
   changed items' `work-batch` names), and the current commitment on the roadmap hub. Read them; don't copy them.

Read only. Nothing in this list is edited while drafting.

## The sections, top to bottom

Same order every day, so the eye learns where things are. Conclusion first.

1. **Headline** — a `> [!summary]` callout, two or three sentences: the one thing to do first, and whether
   anything is on fire. A warm opener is fine; one line of it.
2. **`## Needs you`** — at most five bullets: decisions only the person can make, things to try, replies
   owed. Each links its note. None: write "nothing". The rest belongs on the board.
3. **`## Yesterday, as a story`** — 3 to 6 short paragraphs or bullet groups, grouped by project or arc,
   each opening with a bold one-line headline. Say what the problem was and what worked. Every claim links
   its proof: an item (`[[PIE-…]]`), a PR, a delivery record.
4. **`## Today`** — a numbered list: the committed batch's next steps, the first step of each open thread,
   an agenda line if there is one.
5. **`## The board right now`** — live figures: a `::graph-stat` whose items read the stage views
   (`view: ((<view id>))`), and a `!((<view id>))` embed of the stage that matters today.
6. **`## What moved`** — a `::graph-rank` or `::graph-table` over `updated >= -1d`.
7. **`## Jump points`** — links: the boards, the overnight briefing, open batches, recent captures,
   the roadmap hub.
8. **`## Earlier briefs`** — a `::graph-table` over `type=daily-brief` (columns `[brief-date, title]`).
9. **`## Since this morning`** — "nothing yet". Mid-day updates go here.
10. **Sources** — a folded callout, last: `> [!note]- Sources (drafted HH:MM TZ by <actor id>)`, one bullet
    per source above: the feed sequences read (from–to), the queries, the repos and branches, what you
    couldn't reach.

A live figure, as the door and the prototype draw it (ids are the outline's own):

    ::graph-stat
    ---
    title: the board, live
    items:
      - { label: doing, view: ((<Doing view id>)) }
      - { label: review, view: ((<Review view id>)) }
    ---
    ::

`view: ((id))` and a quoted bare id both work. `query:` takes the saved-view grammar (OR, NOT, parentheses,
`updated >= -1d`) where the service has `query.expression`.

## The rules

- **Provenance.** Written as an agent with your actor id (`--author agent --actor <id>`). The Sources
  callout says what you read and when. The prose is a snapshot; say so ("as of 07:40").
- **Dates on figures.** Put a one-line, dated plain-text summary above each figure ("07:40: 2 doing,
  11 in review"). Detail doesn't draw `::graph-*` figures yet, so that line is what a Detail reader gets.
- **Prose never repeats a figure's number.** Say "the door batch is waiting on review" and let the figure
  count. The dated summary line above a figure is the one exception.
- **Status lives in the roadmap items.** The brief only asks. Never set a stage, a priority or a batch
  from the brief, and never create roadmap items by hand: new work goes through the allocator
  (`outliner work create …`) and only when the person agreed to it.
- **Readable.** One idea per line; bold the first words of a bullet so a skim works; no walls; details
  live behind links. The first screen answers "is anything on fire, and what do I do first?"
- **Fictional in examples.** In anything committed (tests, fixtures, docs), use made-up briefs.

## Writing it

1. Draft the whole note in a file, sections in order, every figure in place, "nothing yet" under
   `## Since this morning`.
2. Create it beside the previous brief:
   `outliner create --parent <parent id> --author agent --text "$(cat brief.md)"`.
   Read it back (`outliner read <id> --fields id,title,properties,revision,text`) and check the three
   properties came through as block properties.
3. Check it in a door of your own (`ep0ch try --ws <root> --copy --outliner <checkout>`, then `T`): every
   figure draws (no "needs a ((block-ref))", no "bad YAML"), links resolve, the date and "n of m briefs"
   are right.

## Updating

- One section at a time, revision-checked:
  `outliner note section <brief id> "## Since this morning" --file update.md --author agent --actor <id> --expected <revision>`.
  It replaces what Detail folds under that heading and prints the `previous` text. Read the note first;
  a refused revision means someone edited it: read again, merge, retry. Never overwrite the person's edits.
- Don't use `outliner update` on a brief: it rewrites the whole note and records the write as the user.
- The headline has no heading, so it isn't rewritten after the morning; later news goes under
  `## Since this morning`.
- Bump `feed-sequence` only when you re-read the feed: `outliner work set` is for roadmap items, so edit
  the property through the Pi or Claude tools' property patch (`outliner_property_patch`) with the revision.

## Known gaps

- No CLI command for `activity.recent`; `outliner create` takes `--author agent` but no `--actor`.
- The change feed keeps a short window. Record the checkpoint every time; fall back as step 2 says.
- The service sorts `blocks.query` by created or updated only; the door orders briefs by `brief-date`.
- The door lands on the brief after logon only with `EP0CH_LANDING=brief`; the default is the main menu.
