# Notifications hub

Your GitHub notifications become notes in the outline, one each, on two boards. Gmail, Jira and Slack fit the same
shape, with made-up data until a real source is plugged in.

## Where to look

- **[[notifications-state]]:** the board by read state, an Unread lane and a Read lane.
- **[[notifications-source]]:** the board by source, a lane each for GitHub, Gmail, Jira and Slack.
- **[[notifications]]:** the page every notification lands under.

## What you do

- **Mark one read:** drag its card to the Read lane, or edit it to `[notify.state::read]`.
- **Pull now:** `ep0ch ext run notify action:pull`. It pulls by itself every 5 minutes too.
- **Find some:** query its properties like any others, such as `notify.source=github AND notify.state=unread`.

## Good to know

- **Read stays read.** A pull never turns a note you marked read back to unread.
- **Read there is read here.** A pull marks a note read when GitHub says you read it there.
- **Lists leave notifications out.** `ep0ch find`, lists and "what changed lately" skip them and say how many.
  - `machinery: show` brings them back; the boards already say `[machinery::show]`.
- **The boards are yours.** Edit them, move them, delete a lane for a source you don't pull.
  - A reinstall never writes them again.

## Setup

- **Install:** `ep0ch ext add notify` for every outline, or add `--outline-folder ~/outlines/<name>` for one.
- **GitHub:** `gh` on the service's PATH, logged in as the service's user. It runs `gh api notifications`, read-only.
- **Settings:** `config.json` in the installed folder, all optional, such as
  `{ "config": { "sources": ["github"], "page": "notifications", "days": 14 } }`.
- **Gmail, Jira, Slack:** made-up data only. Name a file per source in `fixtures`, such as
  `"fixtures": { "gmail": "fixtures/gmail.json" }`, and list the source in `sources`.
  - A source with neither: the pull says so and carries on with the others.
- **Remove:** `ep0ch ext remove notify --demo remove` also moves the boards you didn't change to Trash.

## How it works

- **One note per notification,** keyed by `[notify.key::<source>:<id>]`. A pull writes only what changed.
- **Its properties:** `notify.source`, `notify.kind`, `notify.from`, `notify.state` (`unread` or `read`),
  `notify.received`, `notify.url`.
- **Stamped as machinery:** each note carries `[machine::notification]` (PIE-1427): fetched, not written by anyone.
  - Notes from before version 4 get it from `ep0ch machinery backfill --apply`.
- **Cursors:** each source's last pull is `[notify.synced.<source>::…]` on the page's first line.
  - The first pull looks back `days` (14).
- **GitHub's read state:** fetched with `all=true`, so threads read there come back marked read.
- **The `gh` login:** a call gets the service's `HOME`. The manifest passes `GH_CONFIG_DIR` and `XDG_CONFIG_HOME` when
  the service has them.

## Adding a real source

- **A source** is `{ fetch({ since, days }): Promise<Notification[]> }` (`notification.ts`).
  - It returns the notifications changed since an ISO time.
  - Each one: `id`, `kind`, `from`, `title`, `url?`, `unread`, `received`, `snippet?`.
- **Gmail, for one:** in `sources.ts` write `gmail: Source`, and list it in `REAL`.
  - Call `users.messages.list` with `q=in:inbox after:<epoch>`, then `messages.get?format=metadata`.
  - Map each message: `id` its id, `from` its `From` header, `unread` its `UNREAD` label.
- **Its token:** a manifest `secrets` entry, `{ "group": "gmail", "key": "GMAIL_TOKEN" }`.
  - Add it with `with-secrets --add gmail GMAIL_TOKEN`.
  - It reaches the process as `credentials.token` and as `GMAIL_TOKEN`; the service scrubs it from answers.
- **Jira:** search `updated >= "<since>"`, and map comments and assignments.
- **Slack:** `search.messages` for `<@you>`, or `conversations.history`.
- **Nothing else changes:** the page, keys, boards and tests stay the same.
