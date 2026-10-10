# Notifications hub (a fetcher and a board)

Cold-start run 4 of the extension docs (PIE-741 and PIE-767). A deterministic fetcher, with no model: GitHub is real,
and Gmail, Jira and Slack come from made-up files behind the same shape until a real one is plugged in.

```text
Notifications [page::notifications] [notify.synced.github::…]      ← written by ext:notify's pull
  └─ Fix the build [notify.key::github:101] [notify.source::github] [notify.kind::PullRequest] [notify.from::org/repo]
       [notify.state::unread] [notify.received::2026-10-09T08:15:00Z] [notify.url::https://github.com/org/repo/pull/12]

Extensions › Notifications hub                                     ← its page, with these demo notes (yours once written)
  ├─ Start here: your notifications on two boards
  ├─ Notifications by read state [page::notifications-state]       ← a hub: the lanes are views
  │    ├─ Unread [type::virtual-branch] [query::notify.state=unread]
  │    └─ Read   [type::virtual-branch] [query::notify.state=read]
  └─ Notifications by source [page::notifications-source]          ← a lane per source
```

- **One note per notification**, keyed by `[notify.key::<source>:<id>]`. A pull looks the key up and writes only what
  changed, so a second pull writes nothing. Properties: `notify.source`, `notify.kind`, `notify.from`,
  `notify.state` (`unread` or `read`), `notify.received`, `notify.url`. Query them like any: `notify.source=github AND
  notify.state=unread`.
- **Read stays read.** Mark one read by editing `[notify.state::read]` or by dragging its card to the Read lane (the
  lane's query is the patch). A pull never turns `read` back into `unread`, whatever the source says; it turns
  `unread` into `read` when the source says it was read there (GitHub is fetched with `all=true` for that).
- **Schedule:** `pull` runs every 5 minutes, once per host (`ep0ch ext run notify action:pull` runs it now).
  The cursor per source is `[notify.synced.<source>::…]` on the page's first line. The first pull looks back
  `days` (14).
- **The boards are its demo notes** (`demo/` in this folder): installing it writes them once under its page in the
  outline's Extensions hub, as `ext:notify`. They're yours from then on: edit them, move them, delete a lane for a source
  you don't pull. A reinstall never writes them again; `ep0ch ext remove notify --demo remove` moves the ones you
  didn't change to Trash.

## Install

```sh
ep0ch ext add notify --outline-folder ~/outlines/<name>      # or `ep0ch ext add notify` for every outline
```

Config (`config.json` in the installed folder), all optional:

```json
{ "config": { "sources": ["github"], "page": "notifications", "days": 14 } }
```

- **GitHub** runs `gh api notifications` (read-only). `gh` must be on the service's PATH and logged in as the service
  user: a call gets the service's `HOME`, and the manifest's `env` passes `GH_CONFIG_DIR` and `XDG_CONFIG_HOME` when
  the service has them, so `gh` finds its login where it keeps it.
- **Gmail, Jira, Slack** need `"fixtures": { "gmail": "fixtures/gmail.json", … }` in config to run (made-up data), and
  list the source in `sources`. Without a fixture or a real source a pull says so and carries on with the others.

## Plugging in a real source

A source is `{ fetch({ since, days }): Promise<Notification[]> }` (`notification.ts`): the notifications changed
since an ISO time, in the one shape (`id`, `kind`, `from`, `title`, `url?`, `unread`, `received`, `snippet?`). To add
Gmail: in `sources.ts` write `gmail: Source` that calls the Gmail API (`users.messages.list` with
`q=in:inbox after:<epoch>`, then `messages.get?format=metadata`), maps each message (`id` the message id, `from` the
`From` header, `unread` its `UNREAD` label), and list it in `REAL`. Its token is a manifest `secrets` entry
(`{ "group": "gmail", "key": "GMAIL_TOKEN" }`, run `with-secrets --add gmail GMAIL_TOKEN`); it reaches the process as
`credentials.token` (read it from the request) and as `GMAIL_TOKEN` in its environment, and the service scrubs it from
answers. Jira: search `updated >= "<since>"` and map comments and assignments; Slack: `search.messages` for
`<@you>` or `conversations.history`. Nothing else changes: the page, keys, boards and tests are the same.
