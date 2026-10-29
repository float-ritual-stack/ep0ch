# Changelog

## 5 (2026-10-29)

- The notifications page is stamped `[machine::notify]` (PIE-1427): every pull rewrites its cursors, so a chat's "what
  changed lately" left it in as real work. It still opens by `[[notifications]]`. The page an earlier version made is
  stamped on the next pull, empty or not (and by `ep0ch machinery backfill --apply`). The boards, their lanes and the start-here note are demo notes, yours, and
  stay unstamped: a stamped view would drop out of the door's boards and its lane picker.

## 4 (2026-10-29)

- Each notification is stamped `[machine::notification]` (PIE-1427), so lists and a chat's "what changed lately" leave
  fetched notifications out by default and count them; the boards say `[machinery::show]`. `ep0ch machinery backfill
  --apply` stamps the notes and boards an earlier version wrote.

## 3 (2026-10-16)

- Reads a note's state and the page's cursors from the service's parse of its properties, not from the first line's text.

## 2 (2026-10-10)

- The boards (by read state, and by source with a lane for each of GitHub, Gmail, Jira and Slack) and a start-here note
  are the extension's demo notes, written under its page in the Extensions hub when it's installed. A pull no longer
  makes them, so a deleted board stays deleted and nothing is left half-made.

## 1 (2026-10-10)

- One note per notification from GitHub (real) and Gmail, Jira and Slack (fixtures), keyed by source and id; a pull
  every five minutes, once per host.
