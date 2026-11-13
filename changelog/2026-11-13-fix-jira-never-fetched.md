### A Jira ticket that never fetched says why and when it tries again (PIE-1801)

- **A first fetch that failed** reads "couldn't fetch: provider request failed · the next poll tries again, R now", and the next poll does fetch it, through the note that names it. Before, nothing tried again until the note was opened again.
- **A 404** says so plainly, without claiming more than Jira does: "couldn't fetch: Jira has no PC-9, or you can't see it · checked again hourly, R now". The poll and an open ask again after an hour (access may come later); `R` asks at once. A ticket deleted after it was read waits the same way.
- **The poll tries each never-fetched ticket once, by itself,** never its whole note again, and a failure that changes kind (a 500, then a 404) is said on the card at once.
- **One wording everywhere:** the card, its age line and R's toast all say "couldn't fetch: … · <who tries again>".
- **Run:** nothing; no PROTOCOL, GRAMMAR or schema change (the projection gains an optional `fetchRetry`: "poll" or "hourly"). The poll change lands when the outline host restarts with the deploy.
