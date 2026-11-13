### A Jira ticket that never fetched says why and when it tries again (PIE-1801)

- **A first fetch that failed** reads "couldn't fetch: provider request failed · the next poll tries again, R now", and the next poll does fetch it, through the note that names it. Before, nothing tried again until the note was opened again.
- **A ticket Jira doesn't have** says so plainly: "couldn't fetch: Jira has no PC-9 · R tries again". No poll asks about it; `R` does.
- **One wording everywhere:** the card, its age line and R's toast all say "couldn't fetch: … · <who tries again>".
- **Run:** nothing; no PROTOCOL, GRAMMAR or schema change (the projection gains an optional `fetchRetry`). The poll change lands when the outline host restarts with the deploy.
