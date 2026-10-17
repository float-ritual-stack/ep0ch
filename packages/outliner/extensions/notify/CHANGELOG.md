# Changelog

## 3 (2026-10-16)

- Reads a note's state and the page's cursors from the service's parse of its properties, not from the first line's text.

## 2 (2026-10-10)

- The boards (by read state, and by source with a lane for each of GitHub, Gmail, Jira and Slack) and a start-here note
  are the extension's demo notes, written under its page in the Extensions hub when it's installed. A pull no longer
  makes them, so a deleted board stays deleted and nothing is left half-made.

## 1 (2026-10-10)

- One note per notification from GitHub (real) and Gmail, Jira and Slack (fixtures), keyed by source and id; a pull
  every five minutes, once per host.
