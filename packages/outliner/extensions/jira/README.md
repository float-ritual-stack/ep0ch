# Jira

Write a ticket key and `jira::`, and the ticket is in the outline: its status, assignee and fields as properties, its description as the body.

```text
PC-1234 Rollout [jira::PC-1234]
My own notes, my own [status::doing].
  └─ Rollout checklist for the depot switch          ← the ticket, a real block
     [jira.key::PC-1234] [jira.status::In Review] [jira.assignee::Dana Ortiz] …
     The description, as Markdown.
       └─ Lee Park · 2026-01-02 10:00                  ← with --comments
```

## What you do

- **Name a ticket:** `PC-1234 [jira::PC-1234]` makes the block the ticket's page.
- **Use context:** `jira:: PC-1234`, or `jira::` under a line that names the ticket; the nearest key wins.
  - Two keys at one level fetch nothing, and the line says so.
- **Add comments:** `--comments[=N]` adds the latest N (default 5) as children, oldest first.
  - `- jira:: --comments` works too.
  - With several lines asking, the ticket keeps the most any of them asks for.
- **Refresh now:** press `r` on the ticket, or click its age in the door.

## Where to look

- **The ticket block:** under the ticket's page (the block whose `[page::PC-1234]` is the key).
  - Else under the first block whose own `[jira::PC-1234]` names it, else the first block that asks.
- **Other lines for the same key** show that same block, so a query or backlink sees the ticket once.
- **Soft links:** a key such as `PC-2` in ticket text links to PC-2's page and shows in its backlinks.
- **Fields:** `jira.key`, `jira.status`, `jira.assignee`, `jira.type`, `jira.priority`, `jira.sprint`, `jira.reporter`, `jira.label` (one per label), `jira.updated`.
  - Comments carry `jira.comment`, `jira.author` and `jira.created`.
- **Drift views:** two saved views show where your status and Jira's disagree.

```text
Done here, not in Jira [type::virtual-branch] [query::status=done child:jira.status NOT child:jira.status=Done]
Done in Jira, not here [type::virtual-branch] [query::child:jira.status=Done NOT status=done]
```

## Good to know

- **Saving never waits.** Saving the line registers and fetches the ticket in the background.
- **Jira owns the ticket block.** Editing a field, the body or a kanban drag is refused.
  - The message says: "jira.status comes from Jira; write your own [status::] on the parent block".
- **Your `[status::]` stays yours.** Nothing syncs it with `jira.status`; the drift views show the gap.
- **Comments and highlights** on ticket text are annotations: they follow the text when Jira changes it.
- **Nothing is lost.** When no block asks for the ticket any more, its block goes to Trash with anything you put on it.
  - Asking again, or a larger `--comments=N`, restores the same block.
  - The change feed says why (`ext.jira.drop-record`, `ext.jira.drop-comment`).
- **Attribution:** every write is `author: agent`, `actorId: ext:jira`, and only when the ticket changed.
  - "What changed" views can leave these out (`activity.recent` with `extensions: "exclude"`).
- **Publishing is opt-in.** Ticket blocks stay off published pages unless the page has `[publish.ext::jira]`.

## Setup

- **Install:** `outliner ext add jira`, which copies this folder to `~/.config/pi-herdr-outliner/extensions/jira`.
- **Config:** `ext add` writes `config.json` from a `resource-extensions.json` Jira entry, else from `config.example.json`.
  - Edit it; no restart is needed after an edit.
- **Secrets** resolve on the service host at call time and reach `jira.ts` only on stdin.
  - Forms: `{"keychainService":…}` (macOS), `{"env":"JIRA_API_TOKEN"}`, `{"file":"~/.config/…/jira-token"}` (mode 0600).
- **No credentials:** the ticket line says "no Jira credentials on this machine" and everything else keeps working.
- **Sources** are created on first use; an existing Jira Source for the project is reused.
- **Options:** `sprintField` (default `customfield_10020`) names your site's sprint field; `"comments": false` skips the comment request.

```json
{
  "config": { "authMode": "basic", "email": "you@example.com" },
  "secrets": { "token": { "keychainService": "jira-api-token" } },
  "sources": [{ "origin": "https://your-site.atlassian.net", "project": "PC" }]
}
```

## How it stays fresh

- **On open:** a note whose copy is older than 15 minutes is fetched again.
- **A poll every 12 minutes** while the service runs: one JQL search (`key in (…) AND updated >= -Nm`, 50 keys a search) finds changed tickets.
  - Only those are read again, and a poll that finds nothing writes nothing.
  - If Jira refuses a `key in` search for a deleted key, that batch is answered from one project search.
  - A search that fails keeps its window, so the next poll looks back far enough.
- **Credentials refused (401, 403, or none):** automatic fetches pause for 15 minutes.
- **Rate limited (429):** they pause from one minute, doubling up to 30.
- **While paused,** the ticket says `paused, r tries now`; `r` always tries at once, and the first answer that works ends the pause.

## For developers

- **Contract 2:** `extension.json` declares the `jira` handler (`effects: read`, a record, stale after 15 minutes, polled every 12).
- **`jira.ts` answers three operations,** one JSON request on stdin and one response on stdout:
  - `resolve`: a key to Jira's immutable issue id.
  - `read`: the Resource document plus `record` (`title`, `fields`, `body`, `comments`), which the service keeps as blocks.
  - `changed`: which of these keys changed in the last N minutes.
- **Errors are codes** (`credentials-missing`, `unauthorized`, `forbidden`, `not-found`, …); provider error text is never stored.
- **Trusted code,** not a sandbox: it runs as the service user, with the service's own Bun.
- **Why `jira.<field>`:** the prefix is the extension id, so the service knows who owns the field; the property grammar already allows `.`.
- **Tests:** `bun test test/jira-extension.test.ts test/extension-records.test.ts` runs against a loopback fake Jira (`test/fake-jira.ts`).
- See [docs/extensions/resource-process.md](../../docs/extensions/resource-process.md).
