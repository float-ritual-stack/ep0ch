# Review B: portability, runtime and safety

Reviewer B, 2026-09-30, on float-2 (Linux, Bun 1.4.2, tmux, Herdr 0.9.1). Both repos read in place at `main`.
Nothing was committed or edited. Things I ran, and how they were fenced:

- Scratch doors: each had its own `EP0CH_STATE` and `EP0CH_CONTROL` under `/tmp/rvB`. They were pointed at scratch
  services: a `try-it.sh --showcase` service with `XDG_STATE_HOME=/tmp/rvB/xs`, and a 21,000-block service made with
  `test/scratch.ts`. I drove them in a private tmux server (`-L rvB`).
- Herdr: a throwaway server under `XDG_CONFIG_HOME=/tmp/hxB` with `HERDR_*` unset. It is stopped. The real Herdr
  server (pid 1367) was only asked `herdr status`.
- Tests: `EP0CH_OUTLINER=… bun test` gave **741 pass, 0 fail, 48 files, 100 s**.
- Everything I started is stopped. No process I didn't start was touched. Both repos are `git status` clean.
- Evidence tags: **[ran]** means I ran it. **[read]** means confirmed by reading only. **[ran+read]** means both.

## Summary

- The door is honest about what lives and dies: reload keeps programs, quit/SIGTERM/kill -9 end plain tiles, a
  Herdr-backed agent tile outlives the door and reattaches (all **[ran]**). The outliner service is more careful than
  the door about crash safety (OS-level ownership lock, 0600 files, scrubbed extension env). The door's runtime
  hygiene is a generation behind it.
- **Top 1: the door only cleans up after itself on the two signals it handles (SIGTERM, SIGHUP).** An uncaught
  exception, SIGINT or SIGQUIT leaves the person's terminal in alt-screen, mouse-report and bracketed-paste mode
  (F1, **[ran]**). It also leaves `door.sock` behind, and the real state dir already holds two stale `door-<pid>.sock`
  files (F2).
- **Top 2: the control socket is arbitrary command execution with no mode, owner or path checks.** `act tile.open
  kind=pty cmd=…` ran a command; `snap <path>` writes a PNG anywhere (F3, **[ran]**). Its "state dir" is also
  computed five different ways, so `EP0CH_STATE` (which AGENTS.md says isolates a test door) does not move
  `lastcall.json` (F4, **[ran]**).
- **Top 3: a ctrl+e edit tile's temp file, holding the person's text, is left in /tmp on SIGTERM/SIGHUP and the
  door says nothing** (F5, **[ran]**). The docs say the opposite. Two doors sharing a state dir silently lose marks
  (F19, **[ran]**).
- Host assumptions: one accidental private path default (`PACK_DIR`), one dead socket name (`float-box.sock`), personal
  infra scripts inside the door repo, and macOS-only image conversion with no Linux fallback (JPEGs and big PNGs
  cannot render on this box: F10, F11). The rest are sensible defaults or detected values.

## Recognised systems

"We have effectively built a ___, but currently treat it as ___." Ladder: accidental → recognised → provisional →
shared → stable.

| Subsystem | We built | …but treat it as | Ladder | Evidence |
|---|---|---|---|---|
| `PtyPane` + `LIVE` set + `door-agent-herdr.ts` | a **terminal session manager**: pty owner, emulator, attach/observe/take-over, exit codes, reattach | a tile kind (`pty.ts`) with a Herdr special case bolted on by title-sniffing (`inHerdrTitle`, `herdr-agent.ts:206`) | provisional. Two backends exist (own pty, Herdr pane), with no shared `Session` interface. | [read] `pty.ts:46`, `pty.ts:54`, `herdr-agent.ts` |
| `control.ts` socket | a **local RPC server with a live event feed** (the agent transport) | a debug port: no mode, no auth, no line limits, no log | shared (agents, tiles and Herdr all use it) but its safety contract is unwritten | [ran] F3 |
| `state.ts` + five other writers | a **per-user settings/session store** with 9+ ad-hoc file formats | a helper for the desk layout | accidental. Five ways to resolve "the state dir" (F4), and 0 versions. | [ran+read] |
| `SocketBoard` reconnect/catch-up/capabilities | a **service client SDK** (negotiation, backoff, replay, `optional()` fallbacks) | a door-internal class beside the outliner's own `client.ts` | shared inside the door. Provisional across clients; that is A's question. | [ran] service kill/restart |
| `setup/` (facts → plan → apply → doctor) | a **host detector and installer** | a `doctor` subcommand | recognised and good. Facts are detected (`facts.ts`), not assumed. | [read] |
| Process launching (six call sites) | a **supervised child runner** | a `run()` helper per file (F7) | accidental. The outliner has the good one (`resource-extensions.ts:96`). | [read] |
| `try-it.sh` showcase pidfile/`ours()` | a **scratch-service supervisor** | a shell script | provisional. It is more careful than the door's own lock code. | [read] |

## Findings

### Converge now

#### F1  Only SIGTERM/SIGHUP restore the terminal. An uncaught exception, SIGINT or SIGQUIT leaves it wrecked.
- where: `src/main.ts:134` is the only `process.on` for signals in `src/`. `term.stop()` (`src/term.ts:68-72`) runs only
  through `App`'s `done` (`main.ts:120-127`). `grep -rn "uncaughtException\|unhandledRejection\|SIGINT" src` finds
  nothing except the Herdr wrapper (`herdr-agent.ts:274`, which *ignores* SIGINT).
- evidence: **[ran]**.
  - Door under tmux, `kill -INT`: the door died. tmux reported `alternate_on=1 mouse_any_flag=1 mouse_sgr=1`
    afterwards, so the outer terminal stayed in alt screen with mouse reports on.
  - Same after `kill -9` (expected) and after a real uncaught throw. I injected it with
    `bun --preload boom.ts src/main.ts`; the repo file is unmodified. The error text was painted onto the alt screen
    and the shell prompt never came back.
  - Tile children were killed in every case: `process.on("exit")` at `pty.ts:46` covers throw and SIGINT, and the
    kernel's pty hangup covers kill -9.
- impact: any crash in a timer or promise callback drops the person into a terminal that echoes mouse escape
  sequences. It also skips the draft copy that SIGTERM makes (`app.ts:333` `terminate()`). Agents crash doors in
  practice, so this is not rare.
- fix: register one handler for `uncaughtException`, `unhandledRejection`, SIGINT and SIGQUIT that calls the existing
  `app.terminate()` (drafts copied, then `term.stop()`, then `control.close()`), then prints the error on the *normal*
  screen. Reuse `App.terminate`; write no new teardown.

#### F2  Stale control sockets are never swept. The real state dir already has two.
- where: `src/control.ts:64-70` replaces a stale socket only at the exact path it wants. `door-<pid>.sock`
  (`control.ts:67`) is created when `door.sock` is live and is removed only by `close()` (`control.ts:95`).
- evidence: **[ran]** kill -9, SIGINT and the throw each left `door.sock` in the state dir. **[read, real dir]**
  `~/.local/state/ep0ch-door/` holds `door-972586.sock` and `door-972870.sock` (Sep 29 21:34/21:35). Both pids are
  gone (`kill -0` says no such process).
- impact: clutter now. Later: `ep0ch act` with no `EP0CH_CONTROL` gets ECONNREFUSED ("no door running at …", a fair
  message) but nothing ever heals it; the next door on `door.sock` is the only thing that unlinks it.
- fix: at start, connect-probe every `door*.sock` in the dir and unlink the dead ones. Or use the outliner's crash-proof
  OS lock (`workspace-ownership.ts:11`, a SQLite write reservation the kernel releases when the process dies) instead of
  probing.

#### F3  The control socket is unauthenticated command execution, with no mode, owner or path checks.
- where: `src/control.ts:64` (`mkdirSync(dirname(at), { recursive: true })` with no mode), `:93` (`server.listen(path)`
  with no chmod), `:37-40` (`snap` writes to any `req.path`, after `mkdirSync(dirname(path), { recursive: true })`),
  `:74`, `:109` and `:127` (`buf += chunk` with no line cap). The default dir is `control.ts:13`.
- evidence: **[ran]**
  - Socket mode is `srwxrwxr-x`, dir `drwxrwxr-x` under this box's umask 002. Connect needs write permission, so
    this user's private group is the whole exposure here. A 000 or 002 umask on a shared-group machine widens it. On
    umask 022 the dir is world-readable, and so are `desk.json`, `drafts/*.md` (unsaved note text) and
    `river-index.json` (8 MB of outline titles at 21k blocks).
  - `python3` raw client: `{"cmd":"act","action":"tile.open","args":{"kind":"pty","cmd":"sh -c 'id > /tmp/rvB/pwned.txt'"},…}`
    created the file; the tile opened as `x`.
  - `ep0ch snap /tmp/rvB/snapout/a/b/c.png` created `a/b/`, then the PNG.
  - `as=<anything>` becomes the recorded actor id. It is attributed, but the id is unauthenticated.
- contrast: `nvimSocketPath` (`src/desk/nvim.ts:23-31`) already does it right: mode 0700, owner check, and refuses
  group/other bits. The outliner writes files 0600 and dirs 0700 everywhere (`edit-recovery-files.ts:20`,
  `outline-names.ts:235`, …). The outliner's *socket* is the same shape as the door's (`server.ts:257`), but its state
  root is 0700 here, so it is protected by the parent dir.
- fix: `mkdirSync(dir, { mode: 0o700 })`, `chmodSync(path, 0o600)` after listen. Refuse to start if the dir is not
  owned by the user with no group/other bits, by reusing the `nvimSocketPath` check. Cap `buf` at ~1 MiB. Restrict
  `snap` to the state dir or an existing directory. Write "the socket is the door's shell" into
  docs/AGENT-INTERFACE.md, since it is one. The same fix covers `writeState`'s files (they are 664 here).

#### F4  There are five "state dirs", so `EP0CH_STATE` does not isolate a test door. AGENTS.md says it does.
- where:
  1. `state.ts:5` `stateDir()` honours `EP0CH_STATE`, then `XDG_STATE_HOME`, then `$HOME`.
  2. `main.ts:17` `lastcall.json` honours only `XDG_STATE_HOME`/`$HOME`.
  3. `control.ts:13` `DIR` (the default `door.sock` and the default `snap` output) honours only `XDG_STATE_HOME`/`$HOME`.
  4. `media.ts:16` `CACHE` uses `XDG_CACHE_HOME` and is frozen at import time.
  5. `try-it.sh:59` uses `${XDG_STATE_HOME:-~/.local/state}/ep0ch-door/showcase`.
  A sixth, `discover.ts:11` (`stateBase`), is the *outliner's* state root, re-derived. It duplicates
  `paths.ts:236` in the outliner (A's lens: the service should say).
- evidence: **[ran]**. With `EP0CH_STATE=/tmp/rvB/d2` and `XDG_STATE_HOME=/tmp/rvB/xs`, the SIGTERM'd door wrote
  `/tmp/rvB/xs/ep0ch-door/lastcall.json`, not `d2/`. The real file changed at 05:36:09 during my session from a door
  that logged on at 05:31:22, which is not one of mine. Whoever ran it wrote the person's real `lastcall.json`, which
  is what this finding predicts for a test door that follows AGENTS.md ("Set both").
- fix: `main.ts` and `control.ts` should import `stateDir()`. Give `state.ts` a second export, `runtimeDir()` (sockets,
  links, lockfiles), so the "what is a state file and what is a runtime file" question has one answer.

#### F5  A ctrl+e edit tile's temp file is left in /tmp on SIGTERM/SIGHUP and crash. It holds the person's text, and nothing says so.
- where: `src/surface/editor.ts:82-88` (`mkdtempSync(tmpdir()/ep0ch-edit-…)`, removed only in the tile's `done`
  callback). `app.ts:333` `terminate()` collects `keepDrafts()`, which is note drafts only (`desk.ts:531` →
  `note.ts:385`); a terminal tile's buffer is not a draft.
- evidence: **[ran]** `ctrl+e` in a desk, typed text into nvim, `:w`, then `kill -TERM` the door. It exited 0 with no
  "unsaved text was copied" line; `/tmp/ep0ch-edit-HedSLd/cb48276b.md` remained (dir 0700, file 664) with the text.
  I removed it.
- impact: the person's edit survives only by accident, in a place nobody is told about. The README (`README.md:323`,
  and `docs/AGENT-INTERFACE.md:161`) says "its temp file went with the door", which is wrong for signals and crashes.
- fix: in `terminate()`, for each `run.temp` pty tile read its `file` into `Draft.copyOut` (`edit.ts:120`, the same
  drafts dir and pruning), report the path in `keptOnExit`, then remove the dir. Reuse `copyOut`; do not add another
  spool.

### Small extraction

#### F6  The pty child gets the door's whole environment, and the "scrub Herdr" list is written seven times, no two the same.
- where: `pty.ts:132-133` passes all of `process.env` and deletes only `HERDR_PANE_ID` and `HERDR_TAB_ID`.
  Siblings, each a hand-typed list: `test/scratch.ts:36`, `test/scratch.ts:122`, `test/edit.test.ts:159`,
  `test/move.test.ts:134`, `test/comment.test.ts:135` (five vars each: `HERDR_ENV, HERDR_SOCKET_PATH, HERDR_PANE_ID,
  HERDR_WORKSPACE_ID, HERDR_TAB_ID`) and `scripts/try-it.sh:46` (the same five as `-u`). Outliner: `test/e2e/herdr-runner.ts:488`.
- evidence: **[ran]** `env` inside a bash tile shows the door's environment, including the API-key variables of my
  shell (values not reproduced here). Also inherited: `HERDR_ENV`, `HERDR_SOCKET_PATH`, `HERDR_WORKSPACE_ID`,
  `HERDR_STARTUP_CWD`, `HERDR_BIN_PATH`, `EP0CH_STATE`, `EP0CH_SOCKET`, `EP0CH_DAILY_AGENT`. The last means a `--layout
  daily` typed inside a tile would start the Herdr wrapper again.
- contrast: the outliner's extension runner passes only `PATH` and `LANG` (`resource-extensions.ts:103`) and kills the
  whole process group (`:106-112`). Different threat model (a shell should be the person's shell), but the door's
  choice is undocumented.
- fix: keep pass-through for a shell (it should be the person's shell), but name a single `tileEnv(env)` next to
  `ESCAPE_CHORD` that (a) drops the Herdr pane-scoped set on purpose (pick which: all five, or two) and (b) drops the
  door-internal vars. Have tests and the scripts call it. That is one list, not seven.

#### F7  Six child-process launchers, three with no timeout and only one that kills a process tree.
- where:
  - `setup/facts.ts:16` `run` (timeout, kills the one child).
  - `desk/herdr-agent.ts:184` `herdrRunner` (timeout, SIGKILL).
  - `media.ts:36` `run` (**no timeout**).
  - `packs.ts:10` `Bun.spawnSync(["unzip"…])` (**no timeout, blocks the main thread**).
  - `open.ts:19` `external.run` (detached, unref).
  - `pty.ts:143` (the tile itself).
  - Outliner: `resource-extensions.ts:96` `runCommand` (timeout, size caps, `process.kill(-pid)`).
- evidence: **[read]**. `media.ts` shells out to `ffmpeg` and `sips`/`qlmanage`; a hung one leaves the media in
  "loading" forever. `packs.ts` `unzip` runs synchronously, so a slow disk freezes every screen at paint.
- fix: one `run(cmd, { timeoutMs, env, killTree })` (start from `facts.ts:16`, add the process-group kill from
  `resource-extensions.ts`), used by `media.ts` and the `herdrRunner`. Make `packs.ts` async. This would delete three
  timer/kill blocks.

#### F8  Lock and pidfile schemes: three exist, one of them crash-proof.
- where: `herdr-agent.ts:74` `withLock` (O_EXCL file with pid, 30 s stale window, 20 s give-up-and-go-ahead).
  `try-it.sh:57-77` (pidfile checked against `/proc/<pid>/cmdline` and `environ`, so pid reuse is safe).
  Outliner `workspace-ownership.ts:11` (SQLite write reservation; the kernel releases it on kill -9).
- evidence: **[read]**. I could not make `withLock` fail: two doors starting together made one pane (the second attach
  was refused as `busy`). But it is the only one of the three that lets go after a timeout when its holder is wedged.
- fix: none needed yet. If the door gets a second lock, use `acquireLockFile`'s shape rather than a fourth scheme.

### Extension blockers

None found in B's lens. The door does not run third-party code, and the outliner's extension runner is the strongest
piece of runtime code in either repo (scrubbed env, size caps, process-group kill, credential scrub of output). One
platform limit is F15 (credentials).

### Portability

#### F10  `PACK_DIR` defaults to a private path on Evan's box. Everything else in the sweep is fine.
- where: `src/packs.ts:6` (`/opt/float/bbs/inbox/evan`; `EP0CH_PACKS` overrides). Importers: `src/screens.ts:7`,
  `src/hub/welcome.ts:23`, `src/desk/panes.ts:8`. Sibling accident: `scripts/snap.ts:77` reads
  `/opt/float/bbs/inbox/screenshots/Screenshot 2026-09-27 at 8.05.26 PM.png` (a real private file).
- evidence: **[ran+read]** a missing dir degrades to "no art" (`packs.ts:20` returns `[]`), so nothing crashes. The
  welcome test sets `EP0CH_PACKS=/nonexistent` to get the empty case.
- class: accidental default. The env override makes it a *config* the person already has; only the *default* is wrong.
- fix: default to `$XDG_DATA_HOME/ep0ch-door/packs` (or none) and say so in `doctor`. Point `snap.ts:77` at a fixture
  under `assets/`.

#### F11  Big or non-PNG images cannot render on Linux: the conversion is macOS-only (`sips`, `qlmanage`).
- where: `src/media.ts:49` (video: `ffmpeg`, then `qlmanage`), `:56-57` (images: a PNG ≤ 1600 px passes through; anything
  else runs `sips`). `resolveMediaPath` special-cases macOS screenshot names (`:20`).
- evidence: **[read]** plus `which sips qlmanage ffmpeg` prints nothing on float-2: none are installed. So a JPEG, a
  big PNG or a video on float-2 becomes `media error: sips failed`/ENOENT. I did not run a media note end to end.
- class: detected-by-accident. The macOS path is fine on the laptop; nothing detects a missing tool up front or falls
  back to ImageMagick/ffmpeg.
- fix: in `produce`, probe `Bun.which("sips") ?? Bun.which("magick") ?? Bun.which("convert")` once and say
  "install ImageMagick" as the error. Add a `doctor` line (the `setup/facts` module already detects tools). Also prune
  the cache: `~/.cache/ep0ch-door/media` is never cleaned.

#### F12  Bun 1.3.5 is required for terminal tiles; the doctor checks 1.3.0, and there is no runtime guard.
- where: `pty.ts:2-3` says "Bun 1.3.5+". `setup/model.ts:125` `MIN_BUN = "1.3.0"`. `pty.ts:116` `new Bun.Terminal(…)` sits
  *above* the `try` at `:135`.
- evidence: **[read]**. I ran Bun 1.4.2, so I could not reproduce.
- impact: on 1.3.0–1.3.4 the desk render throws a TypeError instead of showing "can't start bash".
- fix: raise `MIN_BUN`, or move the constructor inside the existing `try`, which already prints "can't start …" into the
  tile.

#### F13  Terminal tiles on macOS run without `setsid`, so job control is unverified.
- where: `pty.ts:43` `SETSID = Bun.which("setsid")`; `:143` runs without it when absent.
- evidence: **[read]**. The comment says resizes still reach the program; nothing in the tests or on this box checks
  Ctrl-Z, `fg` or SIGWINCH on macOS.
- fix: an integration test that runs `stty size; sleep` in a tile and resizes it is portable. I ran that by hand here
  and it works: a 41×17 tile gave `stty size` = `15 39`, and a resize gave `24 56` **[ran]**.

#### F14  Dead machine-specific default: `float-box.sock`.
- where: `src/socket.ts:13` (`DEFAULT_SOCKET`), `scripts/probe.ts:3`. Comment at `socket.ts:242-243` also names float-box.
- evidence: **[read]** `main.ts:88` always passes `target.path`, so the default is reached only by code that
  constructs `new SocketBoard()` with no path. `grep DEFAULT_SOCKET` finds no other user.
- class: accidental (a leftover from before hash-named sockets). Delete it, or make it `discover`.

#### F15  Outliner: macOS-only credential lookup and personal defaults in `macos/`.
- where: `resource-extensions.ts:248` (`process.platform === "darwin"` → `/usr/bin/security`); on Linux a credential
  that names a `keychainService` is "unavailable". `:103` sets `LANG: "C.UTF-8"`. `macos/pi-outliner-link/install.sh:4-6`
  defaults `HOST=evan@float-box`, `WORKSPACE=/home/evan/test`, `REMOTE_BUN=/home/evan/.bun/bin/bun` (flags exist at
  `:19-21`).
- evidence: **[read]**.
- class: credentials = invariant of the platform, but say it in the extension README. The `install.sh` defaults are
  accidental: it should require `--host` or read a config.

#### F16  Personal infrastructure lives in the door repo.
- where: `infra/float-2.sh` (Hetzner `cx23`/`fsn1`, `KEY_NAME=evan-laptop-ed25519`, `--label owner=evan`) and
  `infra/cloud-init.yaml`. All overridable by env (`NAME`, `TYPE`, `LOCATION`, `KEY_NAME`).
- class: config, but in the wrong repo for anyone else's checkout. Move it to a private repo, or keep it and say so in
  the README.

#### F17  `~/backups/ep0ch` is not configurable.
- where: `setup/plan.ts:27` `backupDirOf`; `setup/apply.ts:195` passes it with no flag or env.
- evidence: **[read]**. `PlanOptions.backupDir` exists, so the seam is there.
- fix: `--backup-dir` / `EP0CH_BACKUPS`. It is a place a person will want to change (disk size, a synced folder).

#### F18  A stray `:memory:.owner.sqlite` in the outliner repo root.
- where: `store.ts:605` calls `acquireWorkspaceOwnership(path)` for any path, including `":memory:"`, which creates a
  zero-byte file named `:memory:.owner.sqlite` in the cwd (`workspace-ownership.ts:31`).
- evidence: **[ran/read]** the file exists at the repo root (Sep 28 15:53, 0 bytes, gitignored by `*.sqlite`).
- fix: skip ownership for `:memory:`.

### Consistency and safety

#### F19  Two doors on one state dir: last writer wins, mark numbers collide, nothing warns.
- where: `desk/marks.ts:40` loads `marks.json` once; `:59` rewrites the whole array on every change. `desk.json`,
  `delivery.json`, `river.json` and `layouts.json` have the same shape (`desk.ts:269`, `delivery.ts:219`,
  `river.ts:218`, `tiles.ts:132`).
- evidence: **[ran]** two doors with `EP0CH_STATE` shared: marks added from A, B, A. `marks.json` ended with only A's
  two (both numbered from 1 and 2); B's mark (`n:1`) was gone, and each door's `marks.list` showed a different set.
- impact: an agent's `block.mark` from door B can disappear. The UI grammar says marks are door-local until PIE-423,
  so this is a known limit, not documented as one.
- fix: for marks, PIE-423 (the service). Until then, write `marks.json` with a merge on load, or refuse a second door
  on the same state dir (the lock idea from F8).

#### F20  Terminal-tile fidelity: what works, and what a program cannot do.
- evidence and where:
  - **Wide characters: CJK is right, emoji is wrong. [ran]** `pty.ts:110` builds `@xterm/headless` 6.0.0 with its
    default Unicode 6 width table and no `unicode11` addon (`node_modules/@xterm/` contains only `headless`). A direct
    check showed `😀` = 1 cell, `日` = 2 cells (+1 zero cell), `🇯🇵` = two 1-cell cells, and a ZWJ family emoji not
    joined. A real terminal draws the emoji 2 wide, so the row after it shifts one cell. In a bash tile one row came
    out 69 cells wide, with the right border pushed out. `rowOf` (`pty.ts:283`) emits a zero-width space after wide
    cells only where xterm said 2.
  - **OSC 52 clipboard from a program is dropped. [ran]** `printf '\e]52;c;…\a'` in a tile left tmux's buffer
    unchanged (`set-clipboard on`). The door's own selection path uses OSC 52 (`app.ts:37`, `surface/selection.ts:142`),
    but nothing forwards a tile program's request. nvim's `"+y` and Claude's copy do nothing in a tile.
  - **Kitty graphics from a program are swallowed [ran]:** `\e_Ga=T,…\e\\` printed nothing, no leak or corruption
    (`K:|after` rendered clean). So `kitten icat`, sixel and image previews in a tile show nothing. The door's own
    kitty images are separate (`kitty.ts`).
  - **Bracketed paste works. [ran]** A tmux paste-buffer with `-p` reached `cat -v` as plain text (no markers, since
    the program did not ask); `pty.ts:194-197` adds markers only when the program set mode 2004. An ESC sequence inside
    the paste text is passed through as a real terminal would.
  - **Resize works. [ran]** See F13. Layout and pty size follow (`pty.ts:161-164`).
  - **Flood is fine. [ran]** 200 MB of base64 through a tile: door RSS peaked at ~120 MB (from 73), `act` latency stayed
    at 60-90 ms, and it finished in ~10 s.
- fix: add `@xterm/addon-unicode11`; register an OSC 52 handler on the headless parser and hand the text to
  `app.copy`; document that graphics are not passed through. All three sit in `pty.ts`'s `start()`.

#### F21  What happens to a plain shell/nvim tile (the brief's question), and what would change it.
- **[ran]** results, all with a daily layout with `bash` and `nvim` tiles:

| Event | bash tile | nvim tile | Left behind |
|---|---|---|---|
| `layout.load daily` again | kept, same pid | kept, same pid | nothing |
| `layout.load river` | kept, becomes a shut drawer | kept, shut drawer | nothing |
| `^W x` twice on a running shell | shell and its foreground `sleep` end | (same path) | nothing |
| SIGTERM to the door | door exits 0, terminal restored, tile ends; `sleep &` job ends | ends; unsaved buffer lost unless nvim had already written its swap (4 s `updatetime`) | `nohup sleep`, `setsid sleep`, and a `trap '' HUP` child all **survived**, reparented to init |
| kill -9 the door | bash and its plain job end (the kernel hangs up the pty) | nvim and its `--embed` child end; its socket file was removed by nvim | `door.sock`; terminal in alt screen and mouse mode (F1); `desk.json` intact |
| SIGINT / an uncaught exception | tile ends | tile ends | as kill -9, plus no draft copy |
| Restart | new shell in the saved `cwd` (not the shell's current cwd), no scrollback, no job state | nvim reopens the file | `desk.json` holds only `{cmd,cwd,file}` |
| Leaving the desk (`q`) | kept in the background (`Desk.kept`), `D` returns | same | nothing |

- **Herdr-backed agent tile [ran, throwaway Herdr]**: survives door SIGTERM and kill -9. The next door reattaches to
  the *same pane*: `exec bash --norc` was still there with its earlier output. `agent-door-claude.sock` (the control
  symlink) was removed in both cases: the wrapper gets SIGHUP and calls `releaseLink`. So `README.md:363` is right.
  Leftovers: the detached namer (`herdr-agent.ts:290`) keeps polling `nameWhenReady` (120 × 500 ms). A second door made
  a second namer, and both exited on their own in about 60 s.
- **Should every terminal tile be backed by a persistent pane?** Not by default. The persistent path already exists and
  works, but with a cost: on attach the door shows only Herdr's current screen and starts a new emulator, so
  scrollback is *not* restored (`herdr terminal attach` replays the current frame, and `terminal session observe`
  streams frames). To restore scrollback the door would need to read the pane's screen history before the first paint
  (not something I saw in the CLI help), or keep its own emulator state in a session process (the PIE-418 "daemon").
- fix (later): give `PtySpec` a `persist` field. When it is set, the `cmd` is the existing wrapper. The tile then needs
  no `inHerdrTitle` string-sniffing (`pty.ts:59-64`, `herdr-agent.ts:206`), because the spec would say so. Keep nvim
  drafts and shells plain by default.

#### F22  Orphaned children after SIGTERM are a normal terminal behaviour, but the door says nothing.
- where: `pty.ts:187-190` `kill()` sends SIGTERM to the program, then closes the pty; a program that ignores HUP
  (`nohup`, `trap '' HUP`) or calls `setsid` keeps running.
- evidence: **[ran]** see the table in F21.
- fix: none required. If wanted, `describe()` (`pty.ts`) could list the tile's process group and `leaveWarning` could
  name it ("bash has 2 children"), as it already names running programs.

#### F23  Debuggability: the feed says *what changed on screen*, never which action ran or who ran it.
- where: `control.ts:84-90` `subscribe`; events come from `app.subscribe` (`app.ts` publish path).
- evidence: **[ran]** I subscribed, then ran `tile.open`, `block.mark --as rvB`, `open` and `layout.even` as an agent.
  Feed: `layout.changed` (twice, no cause), `viewport`, `marks.changed` (the only event with an actor: `by:"rvB"`).
  `tile.open` and `layout.even` are indistinguishable from a person's drag. No action name, target, request id or
  result. The only trace is the transient status-bar flash ("an agent (…) · layout.get"), and it also flashes for
  read-only actions like `layout.get` and `actions`.
- fix: emit an `act` event on the same feed from `app.act` (`app.ts:~320`, where the refusal flash is already
  produced): `{ type:"act", seq, action, reader, args, as, ok|error }`. Add an append-only ring file in the state dir
  for post-mortems. That is the smallest tracing that answers "which action ran, on what, by whom". Do not flash reads.

#### F24  Degradation paths: what exists, what is tested, and two wording gaps.
- **[ran]** service killed (SIGTERM) under a live door: the status bar showed `offline` and "outline connection lost ·
  reconnecting"; a restarted service on the same state brought it back with no crash. **[read]** the catch-up text is
  "caught up N change(s)" or "reloaded everything (reason)" (`socket.ts:739`), wired at `app.ts:148`. Tests:
  `test/platform.test.ts` (capability fallbacks against old services), `test/river.test.ts`, `test/edit.test.ts`
  (conflicts). The suite is green.
- Gap 1 **[ran]**: while the service was down, `act open id=<x>` answered "no block <x>". `SocketBoard.get()`
  (`socket.ts:403-407`) turns *every* error, including a dropped connection, into `null`, so "couldn't ask" reads as
  "missing". `read()` (`socket.ts:~415`) does it properly. Callers of `get()`: `app.ts:294`, `live.ts:49`,
  `hub/welcome.ts:608`, `river/river.ts:248,989,1091` (six runtime call sites; seed scripts excluded).
- Gap 2 **[read]**: `onConnection` is set only on the main board (`app.ts:148`). Other errors (timeouts at 15 s,
  `socket.ts:314`; the index lane at 90 s, `:509`) surface per screen, each in its own words ("… timed out",
  "no carrier on …", `p.error`).
- Old service: the door hard-stops below `PROTOCOL` (`socket.ts:~385`) with "outline speaks protocol N; this door needs
  M or newer", and treats missing capabilities per feature through `optional()`. Consistent and tested.
- fix: make `get()` a thin wrapper that rethrows non-"not found" errors (`read()` already exists), and pick one phrase
  for "the service can't be reached" (the `onConnection` text) shared by all three.

### LEAVE ALONE

- **The nvim socket directory rules** (`nvim.ts:23-31`): 0700, owner check, path-length fallback. This is the model for F3.
- **`layout.load` keeping programs and shutting drawers** (`desk.ts` `build(…, reuse)`), and **refusing an agent's
  `tile.close` on a running program**. Both worked as documented **[ran]**.
- **The outliner's `acquireLockFile`** (`workspace-ownership.ts`) and **`resource-extensions.ts` `runCommand`**: the best
  runtime code in either repo.
- **`writeState` atomic rename** (`state.ts:13-21`): correct, and I saw no partial file. Add the mode (F3) and a
  version field, not a new mechanism.
- **The Herdr wrapper's fall-back-to-direct paths** (`herdr-agent.ts:271-278`) and its `busy`/`taken` handling.
- **Startup and idle cost**: first content in ~0.19 s on the showcase and ~0.19 s on a 21,000-block outline (the
  river shows roots first; the 21,031-block `tree.index` takes ~0.6 s in the background, 8 MB of JSON stringifies in 13 ms).
  Idle CPU 0.7 %, RSS 82 MB. The only thing to watch is `river-index.json` (`river.ts:234`), which is rewritten in full
  on each 60 s refresh and grows linearly (8 MB at 21k). I found no repaint cost problem worth a change, but I did not
  profile a repaint; I measured index fetch, start and idle only.

### Later

- **L1** `desk.json`, `delivery.json`, `river.json`, `marks.json`, `layouts.json`, `properties.json` have **no version
  field**, and `delivery.json` alone validates on load (`delivery.ts:~195 checked()`). `desk.ts:123` trusts `saved.root`
  and revives unknown kinds as `reader` (`desk.ts:~150`). A format change today silently degrades to a default layout.
  Add `{ v: 1 }` when the next format change lands.
- **L2** A shell tile restores in its saved `cwd`, not its live one. Cheap: read `/proc/<pid>/cwd` (Linux) into `spec()`.
- **L3** The Herdr namer duplicates and lingers up to 60 s (F21). Guard on a lock or a `--name` pidfile.
- **L4** `try-it.sh` and `scripts/` have an old-usage comment at `try-it.sh:4-5` with `/home/evan/test`.
- **L5** No CI in either repo (no `.github`, no other config found). Tests run by hand at 100 s. The 121 leftover
  `/tmp/ep0ch-scratch-*` dirs (832 KB each) show aborted runs never cleaned up (`test/scratch.ts` disposes only on a
  clean `afterAll`). A `process.on("exit")` in `Scratch` would fix it; I did not delete them (not mine).
- **L6** `@types/bun: latest` is unpinned (`package.json`).

## Tables

### Hard-coded host assumptions: the sweep

Classes: **I** invariant, **D** sensible default (already overridable), **C** config (should be a setting),
**S** detected from the environment, **A** accidental.

| Value | Where | Class | Action |
|---|---|---|---|
| `/opt/float/bbs/inbox/evan` | `packs.ts:6` | **A** (override `EP0CH_PACKS` exists) | F10: default to an XDG data dir |
| `/opt/float/bbs/inbox/screenshots/…png` | `scripts/snap.ts:77` | **A** | F10: use an `assets/` fixture |
| `~/.local/state/pi-herdr-outliner/float-box.sock` | `socket.ts:13`, `scripts/probe.ts:3` | **A** (dead) | F14: delete |
| `~/backups/ep0ch` | `setup/plan.ts:27` | **D**, should be **C** | F17: `--backup-dir` |
| `/opt/homebrew/bin` in link dirs | `setup/plan.ts:48` | **S** (filtered to on-PATH and writable, `plan.ts:~110`) | none |
| `brew upgrade bun` hint | `setup/doctor.ts:25` | **S** (only if macOS and bun under `/opt/homebrew`) | none |
| `float-ritual-stack/pi-herdr-outliner` | `setup/model.ts:124`, outliner `install.sh:5`, `package.json:7` | **D** (`install.sh` has `PI_OUTLINER_PLUGIN_SOURCE`; the door has none) | door: env override if forks matter |
| `MIN_BUN = 1.3.0` | `setup/model.ts:125` | **A** (contradicts `pty.ts:3`, F12) | fix the number |
| `sips`, `qlmanage`, `ffmpeg` | `media.ts:49-57` | **S**-less, **A** on Linux | F11 |
| `unzip` binary | `packs.ts:10` | **S**-less (fails to "no art") | add to `doctor` facts |
| `process.env.USER ?? "shypht"` | `screens.ts:169` | **D** (persona fallback) | none |
| `xterm-256color`, `COLORTERM=truecolor`, `COLORFGBG 15;0`, OSC 10/11 reply `cccc…/0000…` | `pty.ts:132`, `:127` | **I** (the door's ground is black, its text grey) | move to a theme if a theme file appears |
| `claude` as the daily agent | `tiles.ts:109` (`EP0CH_DAILY_AGENT`) | **D** | none |
| `door-claude` command name if on PATH | `herdr-agent.ts:56` | **A** (Evan's wrapper baked into the default; env `EP0CH_HERDR_AGENT_CMD` exists) | default to `claude` only |
| Herdr pane `door-claude`, workspace `door`, name `door` | `herdr-agent.ts:48-51` | **D** (all three have `EP0CH_HERDR_*`) | none |
| `claude-now` page, `daily-brief` type, `[welcome::…]`, `roadmap-item`, `work-stage`, lane stages | `hub/now.ts:6`, `brief.ts:19`, `welcome.ts:39`, `move.ts:129`, `props.ts:11`, `showcase/seed.ts:38` | **I** (float-hub conventions; the door reads a convention, and `EP0CH_NOW_PAGE` exists) | see "Config" below for the ones that should move |
| `$SHELL \|\| sh`, `$VISUAL/$EDITOR/nvim/vi` | `tiles.ts:80-83` | **S** | none |
| `xdg-open` / `open` / `rundll32` | `open.ts:11-13` | **S** (by platform) | none |
| `setsid` | `pty.ts:43` | **S** | F13 |
| `HOME!` non-null | `state.ts:5`, `control.ts:12`, `socket.ts:13` | **I** (Unix only; `Bun.Terminal` is POSIX) | none |
| `evan@float-box`, `/home/evan/test`, `/home/evan/.bun/bin/bun` | outliner `macos/pi-outliner-link/install.sh:4-6` | **A** | F15 |
| Hetzner `cx23`, `fsn1`, `evan-laptop-ed25519`, `owner=evan` | `infra/float-2.sh` | **C** (env) in the **wrong repo** | F16 |
| `/usr/bin/security` keychain | outliner `resource-extensions.ts:248` | **I** (macOS) | F15 |
| `LANG=C.UTF-8` for extensions | outliner `resource-extensions.ts:103` | **D** | none |
| Outliner `~/.local/state/pi-herdr-outliner`, `~/.config/pi-herdr-outliner` | `paths.ts:236,242,400`, `document-components.ts:48`, `outliner-actions.ts:466` | **D** (XDG/`OUTLINER_STATE_DIR`; ~40 `OUTLINER_*` env vars) | none |
| Ports, hostnames, TCP listeners | both repos | none. All transport is unix sockets. The Jira extension whitelists loopback (`extensions/jira/jira.ts:272`). | none |

Sweep result: the outliner is clean of machine paths apart from `macos/` (F15) and one repo URL. The door's private
paths are the two `/opt/float` entries and the dead socket name. No usernames, ports or hostnames beyond those.

### Hard-coded values that should be config, and where each would live

Only values a person will want to change. Everything else in the inventory stays a constant.

| Setting | Now | Where it lives | Why |
|---|---|---|---|
| Terminal scrollback | `pty.ts:110` `scrollback: 1000` | per-tile `TileSpec` field (`layouts.json`, like `cmd`), default 1000 | Claude/nvim sessions want 10k+; memory per tile is the trade-off (a `LayoutSpec` field, so it saves with layouts and works through `tile.open`) |
| Backup dir | `plan.ts:27` | `--backup-dir` / `EP0CH_BACKUPS` | F17 |
| Pack dir | `packs.ts:6` | `EP0CH_PACKS` (exists); change the default | F10 |
| Herdr agent naming retries | `herdr-agent.ts:130` `tries=120, wait=500` | leave a constant; expose `EP0CH_HERDR_NAME_WAIT` only if someone hits it | it is a 60 s bound on a background helper |
| Herdr command timeout | `herdr-agent.ts:184` 10 s | constant | none |
| Service request timeout | `socket.ts:314` 15 s; index lane 90 s (`:509`) | constant (0.6 s for 21k here). Revisit if the index outgrows 90 s | none |
| Tile input flush | `pty.ts:170` 16 ms | constant | none |
| Draft keep | `edit.ts:243` 50 files **and** 30 days | constant; the sentence "the newest 50, and anything younger than 30 days" describes an AND | none |
| Media max size / cache | `media.ts:15`, `:16` | constant + prune (F11) | none |
| Kitty on/off | `EP0CH_KITTY` (exists) | keep | none |
| Colours | `pty.ts:250-260` palette, `vga.ts`, ~9 ANSI palettes in `screens.ts`/`river/river.ts` | a theme file **later** (no request yet) | `docs/SCREENS.md` says screens are compositions; a theme would be a layout-level part. Not a config now |
| Daily layout's tile names, shares, agent | `tiles.ts:105-122` | already a saved layout (`layouts.json` named `daily` replaces the built-in); good | none |
| Keymap | none | A/C's question | none |

### Control-socket safety: results

| Check | Result | Evidence |
|---|---|---|
| Socket file mode | `srwxrwxr-x` (umask 002) | [ran] `ls -l` on `door.sock` |
| Directory mode | `drwxrwxr-x`; state files 664 | [ran] |
| Owner check on connect | none | [read] `control.ts:71-95` |
| Who can run commands | anyone able to `connect()`: `tile.open kind=pty cmd=…` ran | [ran] |
| Arbitrary file write | `snap <path>` (with recursive mkdir) | [ran] |
| Line/buffer limit | none (three copies: `control.ts:74`, `:109`, `:127`); the feed has a 1 MiB cap (`control.ts:19`) | [read] |
| Actor authenticity | `as=` any string; recorded as `agent` | [ran] |
| Env leaked to pty children | the door's whole env, minus `HERDR_PANE_ID`/`HERDR_TAB_ID`; plus `EP0CH_CONTROL`, `EP0CH_TILE`, `TERM`, `COLORTERM`, `COLORFGBG` | [ran] |
| Stale sockets | `door.sock` after kill -9/SIGINT/throw; `door-<pid>.sock` never swept; 2 in the real dir | [ran+read] |
| Live-door collision | second door gets `door-<pid>.sock`; `ep0ch act` without `EP0CH_CONTROL` reaches whichever holds `door.sock` | [read] |
| Herdr link | `agent-door-claude.sock` symlink removed on SIGTERM and kill -9 | [ran] |
| nvim sockets | 0700 dir, owner-checked, removed on exit; empty after kill -9 | [ran+read] |

### What survives what

Legend: ✔ survives, ✘ lost, ~ partial or degraded, — not applicable. **[ran]** or **[read]** in the last column.

| | change screen | close pane/tile | door restart | service restart | reconnect | other client / other door |
|---|---|---|---|---|---|---|
| **layout** (`desk.json`) | ✔ kept (desk stays in background: `Desk.kept`) | ✔ the tile goes; layout saved | ✔ read back; unknown kinds become `reader`; unversioned (L1) | ✔ (door-local) | ✔ | ✘ last writer wins (F19); a second door on the same dir overwrites |
| **tabs** (in the tile tree) | ✔ | ✔ (`^W ]` etc.) | ✔ `{t:"tabs",tabs,active}` in `desk.json` | ✔ | ✔ | ✘ as layout |
| **terminal session** (plain) | ✔ keeps running in the background | ✘ ended (asks first; agent refused) | ✘ ended, respawned from spec (no scrollback, no cwd) | ✔ unaffected (no service dependency) | ✔ | — |
| **terminal session** (Herdr agent) | ✔ | ~ detaches; the pane keeps running | ✔ the pane lives; reattach (**[ran]**) | ✔ | ✔ | ~ a 2nd door watches read-only, ⏎ takes over |
| **drafts** (unsaved edit) | ~ leaving asks twice, then copies to `state/drafts/` | ~ refused while it holds an edit | ~ copied on SIGTERM or a double-confirmed quit; **✘ on kill -9/crash/SIGINT** (F1) | ✔ kept in memory; the save is revision-checked | ✔ "changed elsewhere" mark | ~ a revision conflict at save |
| **ctrl+e edit tile text** | ✘ | ✘ | ✘ on SIGTERM: left in /tmp, unannounced (F5) | ✔ | ✔ | — |
| **reader history** (back/forward) | ✔ kept in the desk | ✘ | ✘ not persisted [read: `note.ts` `SurfaceHost.history`, no `writeState`] | ✔ | ✔ | — |
| **selection** | ✘ per screen instance | ✘ | ✘ | ✔ | ✔ | — |
| **marks** (`marks.json`) | ✔ | ✔ | ✔ | ✔ | ✔ | ✘ last-writer-wins, numbers collide [ran] |
| **river/board state** (`river.json`, `delivery.json`) | ✔ | ✔ | ✔ (`delivery.json` validated; `river.json` trusted) | ✔ | ✔ | ✘ as layout |
| **river index cache** | ✔ | ✔ | ✔ 8 MB at 21k [ran] | ✔ refetched | ✔ | ✔ read-only cache |
| **layouts** (`layouts.json`) | ✔ | ✔ | ✔ | ✔ | ✔ | ✘ as layout |
| **extension state** | — the door has none: `skills.ts` and projections are read from the service | — | — | ✔ (service side) | ✔ | ✔ (service-owned) |
| **summary keys** (`properties.json`) | ✔ | ✔ | ✔ written non-atomically (`props.ts:58`) | ✔ | ✔ | ✘ |
| **agent link** (`agent-*.sock`) | ✔ | — | ✔ dropped on exit/kill -9 (**[ran]**) | ✔ | ✔ | ~ points at the door showing it |
| **control socket** | ✔ | ✔ | ✘ gone (kill -9: stale, F2) | ✔ | ✔ | ~ second door gets `door-<pid>.sock` |
| **`lastcall.json`** | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ (but see F4) |

### Resource ownership

| Resource | Created by | Destroyed by | After `kill -9` of the door | Evidence |
|---|---|---|---|---|
| `door.sock` / `door-<pid>.sock` | `control.ts:93` | `control.close()` (`:95`) on quit/SIGTERM/HUP | **left** (F2) | [ran] |
| pty child (shell, nvim, agent wrapper) | `PtyPane.start` (`pty.ts:143`) | `kill()` (`:185`), `process.on("exit")` (`:46`), the pty hangup | **ended** by kernel hangup. Children that ignore HUP or called `setsid` survive (F22) | [ran] |
| nvim socket (`state/nvim/*.sock`) | `nvimSocketPath` (`nvim.ts:23`) | the pty exit path (`pty.ts:~156`) and nvim itself | removed by nvim (dir empty) | [ran] |
| xterm emulator | in-process | `dispose()` | gone with the process | [read] |
| control-socket subscribers | `control.ts:84` | on close/error, or FEED_LIMIT | closed by the OS | [read] |
| `SocketBoard` main + events connections | `main.ts:88`, `socket.ts:722` | `board.close()` at quit (`socket.ts:980`) | closed by the OS | [read] |
| index lane connection | `socket.ts:509` | `finally lane.close()` | closed by the OS | [read] |
| timers (33 ms tick, 16 ms paint, 50 ms publish) | `app.ts:150,221,393` | `App.quit` (`:342`) | die with the process | [read] |
| Kitty images (terminal-side) | `kitty.ts` | `kitty.dispose()` (`app.ts:346`) | **left in the terminal** until reset [read, not run] | [read] |
| `state/drafts/*.md` | `edit.ts:120` | `pruneDrafts` (50 and 30 d) | kept | [read] |
| `/tmp/ep0ch-edit-*/` | `editor.ts:82` | the tile's `done`, or `finally` | **left**, with the person's text (F5) | [ran] |
| `state/*.json` | `writeState` (temp+rename) | never (no GC) | intact (atomic) | [read] |
| `agent-*.sock` (symlink) and `.lock` | `herdr-agent.ts:150,77` | `releaseLink` on detach/SIGTERM/HUP, `withLock` finally | link removed via the wrapper's SIGHUP; a lock is stale after 30 s or a dead pid | [ran] link |
| Herdr namer (detached) | `herdr-agent.ts:290` | exits by itself in ≤ 60 s | keeps running ≤ 60 s | [ran] |
| showcase service and `service.pid` | `try-it.sh:114` | `stop` on EXIT/INT/TERM | **service left running**; `ours()` guards pid reuse on the next run | [read] |
| `~/.cache/ep0ch-door/media/*.png` | `media.ts:48` | never | kept, unbounded | [read] |
| `state/lastcall.json` | `main.ts:23` | never | stale by one session | [read] |
| Outliner service socket | `server.ts:257` | `close()` (`:283`) | left; the next start probes and unlinks (`server.ts:250-254`, `outline-host.ts:170-172`); the ownership lock is released by the kernel | [read] |
| Outliner ownership lock | `workspace-ownership.ts:11` | `close()` | **released by the kernel** | [read] |

### Degradation paths

| Path | Behaviour | Tested | Wording |
|---|---|---|---|
| Service absent at start | `ep0ch: no carrier on <path>` and exit 1 (`main.ts:90-107`) | `test/cli.test.ts`, `discover.test.ts` | own phrase |
| Service killed mid-session | status bar `offline`, "outline connection lost · reconnecting", backoff 250 ms→5 s (`socket.ts:756`) | `platform.test.ts` (`onConnection`) [ran] | consistent |
| Reconnect | "reconnected · caught up N changes" / "reloaded everything (reason)" | `platform.test.ts` | consistent |
| Request while offline | main board: rejects after ≤ 15 s. `get()` returns null: "no block <x>" (gap 1, F24) | not tested | **inconsistent** |
| Old service (protocol) | door refuses: "outline speaks protocol N; this door needs M" | `platform.test.ts` | own phrase |
| Old service (capabilities) | per-feature `optional()` fallback | `platform.test.ts` (runs the same file against old and new) | per-feature notes |
| Revision conflict on save | draft kept, "changed elsewhere", copy-out | `edit.test.ts` | ok |
| Herdr absent / server down / slow | wrapper runs the agent directly, one-line notice (`herdr-agent.ts:271-278`) | `herdr-agent.test.ts` | ok |
| Missing tools (`sips`, `unzip`) | per-item error or "no art" | not tested | **inconsistent** (F11) |
| Terminal that doesn't answer the kitty probe | first paint waits 400 ms (`term.ts:61`) | not tested | none |

### Client → server candidates (B's lens only)

- **Folder → state root → socket hash.** `discover.ts:11-14` re-derives `stateBase` and the SHA-256 12-hex key that
  `paths.ts:236,workspaceKey` define. A `hosts.resolve` call from the service would delete it. Clients: door,
  `try-it.sh` (`hash_of`, `try-it.sh:33`, the same hash in shell: a third copy).
- **`river-index.json`.** The door caches the whole outline index locally (8 MB at 21k). A service-side `changes.since`
  on an index slice would make it a delta, not a rewrite.
- **Marks.** Door-local `marks.json` (F19); PIE-423 is the owner.

## Gap matrix

Not B's. Reviewer A owns it. Empty here.

## Docs that are wrong

| Doc | Line | Says | Actually |
|---|---|---|---|
| `AGENTS.md` (ep0ch-door) | "Never run `act|peek|…` without pointing at your own test door … `EP0CH_STATE` moves the saved layouts and drafts. Set both." | isolates a test door | `lastcall.json` (`main.ts:17`), the default `door.sock` and `snap` output (`control.ts:13`) and the media cache (`media.ts:16`) ignore `EP0CH_STATE` (F4) |
| `README.md:323` and `docs/AGENT-INTERFACE.md:161` | "SIGTERM, SIGHUP, a crash: they end with the door; unsaved edits are copied to disk first on a signal" | accurate for terminal children. The ctrl+e temp-file claim next to it ("its temp file went with the door") is wrong on a signal or crash | the file stays in `/tmp`, unannounced (F5). A crash does not copy drafts; it also leaves the terminal in raw mode (F1) |
| `README.md` (terminal tiles) | terminal tiles work with nvim, claude, shells | fine | not stated: emoji width, no OSC 52, no graphics passthrough, no scrollback restore on Herdr reattach (F20, F21) |
| `setup/model.ts:125` vs `desk/pty.ts:3` | `MIN_BUN = 1.3.0` for the doctor; "Bun 1.3.5+" for the pty | | fix the number (F12) |
| `scripts/try-it.sh:4-5` | usage example `--ws /home/evan/test` | machine-specific path in a documented example | use `/path/to/workspace` |
| `docs/UI-GRAMMAR.md:472` | PIE-418 "daemon: shell state outlives a terminal" | still open, and accurate as a *plan* | the state is now split: layout survives, plain tiles do not (F21). Say so in the row |
| README safety sections | nothing on the control socket | | add "the socket is the door's shell" (F3) |

## Not done, and why

- **No repaint profiling on a large outline.** I measured index fetch, startup and idle. A per-frame timing would need
  instrumentation inside `App.paint`, which I did not add (report only).
- **No macOS run.** F13 (no `setsid`) and F11's macOS side are read-only.
- **No `float-hub` sandbox.** I built a 21,000-block private outline instead, from `test/scratch.ts`.
- **Kitty graphics *of the door itself* under kill -9** (`kitty.ts` images left in the terminal) is read-only.
- **Feed backpressure on the outliner side.** I checked only the door's 1 MiB `FEED_LIMIT` (`control.ts:19`); the
  service's subscriber queues are in A's and the outliner's own tests' territory.
