### float-2 keeps the laptop's outlines current again (PIE-1779)

- **The link takes over from SSH without a fight:** a laptop dialling in while SSH serves reads gets the machine's socket by one rename; reads in flight finish, and SSH is ended 30 s later. The link no longer waits for a socket file OpenSSH never removes, so it is no longer refused every 22 s.
- **One owner decides the transport:** outline-core's `ensureForward` routes to the link, falls back to SSH, and ends an SSH connection that lost its socket to a link that has gone. The link's server asks it instead of deciding again.
- **A link is up as soon as its proof checks:** it no longer waits for the forward lock, so the connector's 10 s deadline doesn't time it out while an SSH start holds the lock.
- **A read cut off says so at once:** a connection closed before its answer fails then, not 15 s later as "timed out".
- **Pages of a change log are cut by size too:** about 1 MB, whole transactions, so float-hub's rebuild fits the laptop's 0.7 MB/s line.
- **Only what is listed is followed:** a link read follows `EP0CH_MCP_MIRRORS` and what a running process here asked for (the gateway's), never every copy it finds in the folder; an ask holds its process's id and lapses with it. Links into a copy nobody lists no longer fall back to it while its machine is away.
- **A forward that closed with no answer gets the start hint:** "No outline host answers at …", as a timeout did.
- **Install goes on past a slow link:** a connector that runs again but hasn't reached its server within a minute is said, and the remaining steps still run.
- **Run:** `ep0ch install --apply` on float-2 first, then the laptop. No PROTOCOL, GRAMMAR or schema change.
