# Outbound machine links

A machine behind an inbound firewall runs `ep0ch link connect`. It dials an HTTPS
WebSocket to `ep0ch link serve`, which listens on loopback behind the web proxy.
The server exposes `<outlines>/.remote/<machine>.link.sock`. The existing shared
client socket, `<machine>.sock`, points there while the link answers. Clients
still use `ensureForward`: probe the link first, then use SSH at the shared socket
if the link or its host does not answer. Both readers and writers name the chosen
transport on stderr; the door also says it in its status messages. No reader,
editor or host RPC is duplicated.

Configure a connector:

```sh
ep0ch link setup --server https://link.example.test --machine travel
```

Configure its server (repeat `--machine` for each allowed machine):

```sh
ep0ch link setup --serve --port 8788 --machine travel
```

Both save `<outlines>/.host/link.json`. On each machine, set the same independently
generated random secret with `ep0ch keys set link-travel LINK_KEY`. Use a different
secret for every machine. `ep0ch keys` owns storage: a private with-secrets file or
the macOS Keychain. No value is printed or put in link configuration.

`ep0ch install --apply` installs and starts the configured service:
`~/.config/systemd/user/ep0ch-link.service` on Linux, or
`~/Library/LaunchAgents/io.ep0ch.link.plist` on macOS. It asks for a missing key at a
terminal; unattended installs name the command to set it. With no link config,
install does nothing for links. After a restart, install waits up to a minute for
the new link process and any previously connected peers. A connector must be up;
a server with no previously connected peer can report that peer as away. A
service-manager success without recovery fails the step with the status command
for both ends. Install never edits Caddy or DNS.

The server sends a fresh random challenge. The connector proves its machine's key
with HMAC-SHA256 over a domain-separated machine name and challenge. The outline tunnel requires matching PROTOCOL. Install control remains available
when the versions differ, so an update can repair that mismatch. The server also
proves the link key before the connector accepts an install request; client and
server proofs use separate HMAC domains. Unknown machines, wrong keys, duplicate live connections and invalid
frames are refused; the server logs the reason without the proof or key. The only tunnel destination is the connector's own outline-host socket. No frame can name a host,
port or executable. The one control verb is `install <sha>`; it never carries a shell command.

Binary WebSocket messages carry an operation byte, a four-byte big-endian stream
id, and optional data. OPEN, DATA, CLOSE and ACK multiplex Unix connections.
Each direction pauses its source after a chunk until the destination acknowledges
its write or drain; the WebSocket also has a bounded send buffer. Heartbeats run
every 10 seconds and expire after 25 seconds. Reconnect backs off from 1 to 15
seconds, with a 10-second connection deadline. Errors, timeouts and lost
heartbeats schedule recovery directly, without waiting for a close handshake on
a broken connection. Disconnect destroys pending streams: requests, especially writes, are
never replayed by the transport.

The link and SSH use the same forward lock. A link taking over an SSH forward
ends that dedicated SSH master and waits for its listener to release the path;
existing clients reconnect. It does not end unrelated SSH sessions. The link's own
listener survives an SSH fallback; a later request selects the link again once
its host answers. After link loss, the next client can start SSH normally. Read-only mirror fallback
belongs to PIE-1057 and the existing mirror consumers, not to this transport.

`ep0ch link status [--json]` and `ep0ch status [--json]` report link/SSH, whether the
link is up, the last connection time and the down reason, retaining those across
restarts. A stopped process is reported down even if its last saved state was up.
SSH's time is its control-socket modification time. The connector reports its
outbound connection too. Loki reads laptop presence from this link state; an SSH
probe does not decide whether the laptop is away. Server logs go to the journal;
macOS logs go to `~/Library/Logs/ep0ch-link.log`.

This is a process/transport feature, so its demo is the scratch-host WebSocket
workflow in `packages/door/test/link.test.ts`, not a showcase tile. Neither test
nor install validation requires a real laptop or public endpoint.

## Installing over the link

After a successful `ep0ch install --apply` on a link server, install publishes its
verified origin/main commit to each configured connector. Connected laptops receive
one `install <sha>` message; an away laptop receives the latest SHA when it next
connects. A laptop already at that SHA reports it without running install again.
The desired SHA and each receipt survive a server or connector restart. A
connector retains results until their content is acknowledged, including when a
newer install arrives; reconnect resumes result delivery without repeating install.

The connector calls `ep0ch install --apply --as-client --sha <sha> --json` from
its installed checkout. `--sha` accepts a full commit SHA reachable from fetched
origin/main, requires clean main and a fast-forward, and never pulls past the
requested commit. Backups, migrations, host restarts and session handover remain
install's own steps. When a successful checkout update asks for install to run
again, the connector invokes the newly installed code before returning its final
receipt. A failed install is reported without retrying. A link-initiated install defers its own connector restart
until the server acknowledges the saved receipt; the service manager then starts
it on the installed code.

The receipt contains the actual exit code, unfinished steps, and the session
step's handover outcomes and recovery commands. The invoking install prints it,
and the server saves it under the same Deploys record even if the laptop reconnects
after the invoking install has exited. An offline laptop is reported as queued.
A later manual install reconciles a blocked receipt with its actual result.

Auto-install is on unless turned off on the connecting laptop:

```sh
ep0ch link auto-install off
ep0ch link auto-install on
```

The setting takes effect without restarting the link. While an install runs,
the door's status bar shows `update ready · installing`; when automatic install
is off or blocked it shows `update ready · ep0ch install --apply`. Ordinary
refusals and save errors keep their own status-message space.

The install demonstration needs two independent checkouts, a Git origin, service
restarts and an authenticated link. Its scratch-machine journey is in
`packages/door/test/install-migrate.test.ts`; it cannot run as a showcase tile
inside one outline. `test/link.test.ts` covers the setting, receipts and reconnects.

The wire changes require a PROTOCOL bump at the final merge rebase. Install this
implementation once on both ends to bootstrap install control; a connector from
before this verb was implemented cannot install itself over the link.
