# Almanac

A dated note under your almanac page every morning, at 06:05. Every saying is made up.

```text
Almanac [page::almanac]
  └─ Almanac for 2026-10-09 [type::almanac] [date::2026-10-09]      ← written at 06:05 by ext:almanac
       Bread rises faster when nobody watches it.
```

## What you do

- **Read it:** open the `almanac` page.
- **Write today's now:** `ep0ch ext run almanac action:write-day`, or `ep0ch ext act almanac write-day`.
  - A second run the same day says the note is already there.
- **Write elsewhere:** `config.json` takes `{ "config": { "page": "almanac", "outline": "another-outline" } }`.
  - `outline` is another outline the same host serves.

## Setup

- **Install:** `outliner ext add almanac`.
- **Remove:** `outliner ext remove almanac`.

## How it works

- **A scheduled program** (PIE-754): `write-day` is an action `on: "outline"` with `"schedule": { "cron": "5 6 * * *" }`.
- **The service runs it** every morning and records the run; `ep0ch ext ls --long` shows `next` and `last`.
- **It writes through its own connection** ([outline.ts](outline.ts), the helper to copy).
  - `EP0CH_SOCKET`, `EP0CH_WS` and `EP0CH_EXT_GRANT` are in its environment.
  - The note is `ext:almanac`'s, and no extension runs because of it.
- See [the four kinds](../../docs/extensions/README.md#extensions-as-programs).
