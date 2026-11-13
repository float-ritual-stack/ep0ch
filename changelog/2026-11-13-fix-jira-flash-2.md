### A Jira card refreshes without flashing "can't fetch", and the poll re-reads every ticket (PIE-1776)

- **No more "reused a revision for different content":** Jira's `updated` doesn't move when a sprint closes or a person is renamed. Under a weak validator (`updated-at`, `last-modified`, a `W/` ETag) or an evicted copy, the new read replaces the stored one; a strong validator keeps the refusal.
- **The poll covers every registered ticket,** not only those with a record block: a ticket a note names on a list item (`- [jira::KEY]`) is re-read when Jira changes it, and its Resource note shows it on the next open.
- **The first poll after a restart looks back to each copy's last read** (at most a week); a copy never read, or read before that week, is read directly.
- **Run:** nothing; no PROTOCOL, GRAMMAR or schema change.
