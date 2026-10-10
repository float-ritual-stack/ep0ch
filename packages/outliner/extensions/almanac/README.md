# Almanac (a scheduled program)

The example for **extensions as programs** (PIE-754): a schedule, a connection to the outline, and a write somewhere
other than a block it was asked about. Every saying is made up.

```text
Almanac [page::almanac]
  └─ Almanac for 2026-10-09 [type::almanac] [date::2026-10-09]      ← written at 06:05 by ext:almanac
       Bread rises faster when nobody watches it.
```

- `write-day` is an action `on: "outline"` (no block) with `"schedule": { "cron": "5 6 * * *" }`: the service runs it
  every morning and records the run (`ep0ch ext ls` shows `schedule action:write-day … next … last …`).
- It writes through its own connection ([outline.ts](outline.ts), the helper to copy): `EP0CH_SOCKET`, `EP0CH_WS` and
  `EP0CH_EXT_GRANT` are in its environment, so the note is `ext:almanac`'s and no extension runs because of it.
- Run it now: `ep0ch ext run almanac action:write-day`, or as any action: `ep0ch ext act almanac write-day`.
  A second run the same day says the note is already there.
- `config.json`: `{ "config": { "page": "almanac", "outline": "another-outline" } }` writes under another page, or in
  another outline the same host serves.

Install: `outliner ext add almanac`. Remove: `outliner ext remove almanac`.
See [the four kinds](../../docs/extensions/README.md#extensions-as-programs).
