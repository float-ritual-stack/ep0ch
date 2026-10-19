# Outbound machine links

A machine behind an inbound firewall runs `ep0ch link connect`. It dials an HTTPS
WebSocket to `ep0ch link serve`, which listens on loopback behind the web proxy.
The server exposes `<outlines>/.remote/<machine>.sock`, the existing shared forward.
Clients still use `ensureForward`; no reader, editor or host RPC is duplicated.

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
install does nothing for links. Install never edits Caddy or DNS.

The server sends a fresh random challenge. The connector proves its machine's key
with HMAC-SHA256 over a domain-separated machine name and challenge. Both compare
PROTOCOL. Unknown machines, wrong keys, duplicate live connections and invalid
frames are refused; the server logs the reason without the proof or key. The only
destination is the connector's own outline-host socket. No frame can name a host,
port or executable.

Binary WebSocket messages carry an operation byte, a four-byte big-endian stream
id, and optional data. OPEN, DATA, CLOSE and ACK multiplex Unix connections.
Each direction pauses its source after a chunk until the destination acknowledges
its write or drain; the WebSocket also has a bounded send buffer. Heartbeats run
every 15 seconds and expire after 45 seconds. Reconnect backs off from 1 to 30
seconds. Disconnect destroys pending streams: requests, especially writes, are
never replayed by the transport.

The link and SSH use the same forward lock. A link taking over an SSH forward
ends that dedicated SSH master and waits for its listener to release the path;
existing clients reconnect. It does not end unrelated SSH sessions. A live link
whose host is restarting reports that condition without replacing its listener.
After link loss, the next client can start SSH normally. Read-only mirror fallback
belongs to PIE-1057 and the existing mirror consumers, not to this transport.

`ep0ch link status [--json]` and `ep0ch status [--json]` report link/SSH, whether the
host answers, and the connection time (SSH's control-socket modification time).
The connector reports its outbound connection too. Server logs go to the journal;
macOS logs go to `~/Library/Logs/ep0ch-link.log`.

This is a process/transport feature, so its demo is the scratch-host WebSocket
workflow in `packages/door/test/link.test.ts`, not a showcase tile. Neither test
nor install validation requires a real laptop or public endpoint.
