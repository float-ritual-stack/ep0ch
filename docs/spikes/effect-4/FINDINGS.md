# Findings

Updated as slices land. Each slice: what was rewritten, what it displaced, what it cost, what it caught.

## 0. Installing effect 4 under bun

- `bun install` of `effect@4.0.1`, `@effect/platform-bun@4.0.1` and `@effect/sql-sqlite-bun@4.0.1`: 156 packages,
  0.6 s, no errors, lockfile +28 lines. Bun 1.4.2 uses its isolated linker (`node_modules/.bun/`), and the peer
  dependency on `effect` is linked for every `@effect/*` package.
- Import cost under bun, wall time, measured from inside the package (`bun src/_imp.ts <module>`), against a
  baseline of `ep0ch --version` at 90 ms end to end:

  | import | wall |
  |---|---|
  | `effect/Effect` | 22 ms |
  | `effect/Schema` | 48 ms |
  | `effect/Terminal` | 43 ms |
  | `effect/cli` | 70 ms |
  | `effect` (the whole barrel) | 91 ms |
  | `@effect/platform-bun` (barrel) | 128 ms |
  | `@effect/platform-bun/BunSocketServer` | 58 ms |
  | `@effect/sql-sqlite-bun` | 53 ms |

  Subpath imports are affordable for a CLI that runs on every interactive login and from Claude hooks. The barrels
  double the startup. A rule for any adoption: import `effect/<Module>`, never `effect`.
- A false alarm worth keeping: a probe script placed outside the package made bun fall back to its global install
  cache, where peer dependencies aren't linked, and `@effect/platform-bun` failed with
  `Cannot find module 'effect/http/Multipart'`. From inside the package it resolves. Not an Effect problem.

## A. outline-core's ssh-forward rule (`machine.ts`, `ensureForward`) on Effect

`packages/effect-spike/src/machine.ts` and `test/machine.test.ts`; the original is `packages/outline-core/src/machine.ts`
and its test. Chosen because it has every concern at once: a resource (the lock file) that must be released on every
exit, a wait on a clock, retries, child processes, and refusals that carry the exact command.

**What changed**

- `MachineIO` became a `Context.Service`. The rule asks for it in its requirements (`R`) instead of a parameter;
  callers provide a Layer. `MachineIO.fromLegacy(io)` wraps the existing Promise-based object (outline-core's
  interface, the outliner's `nodeMachineIO`) as a Layer in 10 lines, so the I/O underneath needn't be rewritten first.
  outline-core's "no I/O" rule holds: the file imports `effect/Effect`, `effect/Context`, `effect/Layer`,
  `effect/Schedule`, `effect/Schema`, nothing that touches the world.
- `now()` and `sleep()` left `MachineIO`: the clock is Effect's, so the tests drive time with `TestClock` and
  nothing sleeps for real (the suite runs in 115 ms, the two-minute lock wait included).
- Eight refusals became `Schema.TaggedError` classes. The facts are fields (`machine`, `reason`, `said`,
  `control`...), the exact command is a `command` getter, and a `message` getter renders the sentence the original
  threw. The original test's `rejects.toThrow("<sentence>")` assertions all pass against `message`; a new one checks
  `JSON.stringify(error)` gives `{_tag, machine, reason, said}`, which is what a wire would carry.
- The lock file is `Effect.acquireRelease` under `Effect.scoped`. A live holder is waited for with
  `Effect.retry` on `Schedule.spaced("100 millis").pipe(Schedule.upTo({ duration: "2 minutes" }))`; a dead holder's
  lock is taken over at once by recursion inside the attempt. "Does the host answer within N ms" is `Effect.repeat`
  with `until` on the same kind of schedule.

**What it caught**

- A test the original couldn't express: *the lock is let go when the waiter is interrupted* (a caller that stops
  waiting, cooperatively: a tile closing, a timeout above it). `Fiber.interrupt` on the forked `ensureForward` runs
  the release finalizer. The original's `try/finally` covers a thrown error but has no notion of a caller stopping.
  Narrowed after Codex's review: this is cooperative cancellation inside one process, not cleanup after `SIGKILL` or
  a crash (no finalizer runs then, in either version), and abandoning a `runPromise` does not interrupt its fiber.
  Within that boundary the mechanism is structural, not a discipline. This is the resource-cleanup class from
  #172/#194.
- Codex's review then found two things the first version got wrong *because* of Effect's semantics, which the tests
  now cover: `acquireRelease` runs its acquire uninterruptibly by default, so the two-minute wait for another
  client's lock could not be interrupted at all (`{ interruptible: true }` fixes it); and `Effect.promise` over the
  legacy `run` means an interrupted fiber releases the lock while the `ssh -f` it started is still running (the
  Promise can't be cancelled; a typed adapter with an abort signal would be the fix, not done here).
- The failure paths now provably release the lock too (asserted after `HostSilent`); the original relied on the
  `finally`, which it did have, so this is parity, not a win.

**What it cost**

| | original | spike |
|---|---|---|
| rule | 186 lines | 246 lines |
| test | 112 lines | 139 lines |
| `Effect.` or `yield*` mentions | 0 | 67 |

- About a third more code, almost all of it the error classes (each refusal is a class with two getters instead
  of one template string) and the `yield*` noise. The rule's logic reads the same, line for line.
- The `Effect.fnUntraced` versus `Effect.fn("name")` choice, `Schedule.upTo` taking `{ duration }`, `Effect.retry`
  options taking `schedule`, `TestClock.adjust` taking a `Duration.Input` template type rather than `string`: four
  small things learned from the checkout's source, none from memory (v3 names differ: `Context.Tag`,
  `Effect.catchAll`, `Schedule.compose`). An agent writing this from v3 knowledge would have got three of them wrong.
- First typecheck passed after one fix (the `Duration.Input` type in the test). Tests passed on the first run. That is
  partly the slice being already shaped for it: the original takes its world as a parameter and its tests already
  faked the clock.

**Verdicts for this slice**

- Resource cleanup: prevents the class (finalizers run on interruption).
- Errors with the command: helps (the command is a field a door can act on, not a substring of a sentence); the
  sentence is still hand-written.
- Clock and retries: helps (TestClock; schedules are data).
- Lines of code: worse by a third.
- Agent ergonomics: worse unless the agent reads the v4 source; the official `LLMS.md` and `MIGRATION.md` are good,
  and `node_modules/effect/AGENTS.md` ships with the package.

## B. The wire types as Schema, decoded at the socket boundary

`packages/effect-spike/src/protocol.ts` and `test/protocol.test.ts`; the original is `packages/outline-core/src/protocol.ts`
(interfaces only) and the door's `JsonLines` (`JSON.parse`, trusted) plus its own `WireBlock` redeclaration in
`socket.ts`. Chosen for the parallel-parser and untyped-JSON classes: ~35 response types are redeclared in the door
("Note logic: shared, server-side and duplicated"), and a missed wire change fails only at runtime.

**What changed**

- `Block`, `BlockProperty`, `OutlinerRequestProblem`, `OutlinerResponse` and `OutlinerServiceStatus` are
  `Schema.Struct`s. The TypeScript type is `typeof Block.Type`; a test proves it is assignable to and from
  outline-core's interface, so the interfaces could be deleted and the Schema be the one definition.
- `ResponseLine = Schema.fromJsonString(OutlinerResponse)`: the parse and the shape check are one decoder, and a bad
  line says the path (`Missing key at ["sequence"]`, `["properties"][0]["value"]`).
- `ProtocolVersion = Schema.Int.check(Schema.makeFilter(n => protocolMismatch(n) ?? true))`: the version check is
  part of the wire type of `ping`'s answer, in outline-core's own sentence. No caller can read a status and forget
  the comparison, which is how #188's client-on-97-host-on-86 showed up as a confusing failure rather than that
  sentence.
- `Schema.toJsonSchemaDocument(Block)` gives the draft 2020-12 JSON Schema the Claude mod's and MCP tool
  definitions want, derived rather than written a second time (today the outliner writes typebox schemas for
  that, 275 `Type.*` calls in 13 files, and the door has none).

**What it caught**

- `Schema.Array`'s Type is `readonly T[]`. outline-core's interfaces are mutable, so `decodeBlock(x)` was not
  assignable to `Block` until the arrays were marked `Schema.mutable(...)`. Struct fields being `readonly` is fine
  (TypeScript ignores it for assignability), arrays are not. An adoption would either mark every array mutable or
  accept readonly types across the codebase; the door mutates arrays it receives, so this is real work, not a flag.
- The first typecheck also caught a fixture whose `author: "agent"` widened to `string`: the literal union is
  enforced on the way in, where today any string passes.

**What it cost**

| | original | spike |
|---|---|---|
| types | ~60 lines of interfaces (the slice's share of `protocol.ts`) | 81 lines, decoders and JSON Schema included |
| test | none at this boundary | 46 lines |

- `effect/Schema` costs 48 ms to import under bun, more than `effect/Effect` (22 ms). outline-core is imported by
  everything, so if the Schemas live there, every `ep0ch` run pays it.
- v4 Schema names learned from the checkout, not memory: `Schema.Literals` (plural), `Schema.optionalKey` versus
  `Schema.optional`, `Schema.makeFilter` and `.check(...)`, `Schema.decodeUnknownResult` (there is no `Either`),
  `Schema.toJsonSchemaDocument`, `Schema.mutable`. The v3 names (`Schema.Literal(...many)`,
  `Schema.filter`, `JSONSchema.make`) are all gone.
- The derived JSON Schema sets `additionalProperties: true` by default; an MCP tool definition may want `false`.

**Verdicts for this slice**

- Redeclared wire types: prevents the class if the Schema is the one definition both sides import (it is the type).
- Untyped JSON at the boundary: prevents, at the cost of one `decode` per line; the error names the path.
- Protocol mismatch forgotten by a caller: prevents (the check is in the type of `ping`'s answer).
- Mutability: worse until decided (readonly arrays everywhere, or `Schema.mutable` on each).
- Import cost: worse by about 50 ms for every CLI run that touches outline-core, unless the Schemas live apart from
  the pure grammar modules.

## C. The door's `hostRequest` on Effect's Socket

`packages/effect-spike/src/host-request.ts` and `test/host-request.test.ts`; the original is `hostRequest` in
`packages/door/src/socket.ts` (18 lines: a Promise around `net.connect`, a timer, `JsonLines`, four exits). Chosen for
the resource-cleanup and error-path-bypass classes at a client boundary, and to see what Effect's own Socket gives a
unix-socket JSON-lines client.

**What changed**

- The socket is `makeNet({ path })` from `@effect/platform-bun/BunSocket` (a re-export of
  `@effect/platform-node-shared/NodeSocket`): a scoped resource, closed when `Effect.scoped` ends, on the answer, a
  refusal, a timeout, an error or an interruption. No timer to clear, no `destroy()` to remember.
- The timeout is `Effect.timeout`, caught by tag and turned into `HostSilent` with the command (`ep0ch status`); a
  socket that can't open or hangs up is a `SocketError` whose `reason._tag` (`SocketOpenError`, `SocketCloseError`)
  becomes `NoHost`'s `said`; the answer line goes through slice B's `ResponseLine`, so a line this protocol can't
  read is `BadAnswer` naming the missing field rather than a silently `undefined` result.
- The result is decoded by a Schema the caller passes (`{ result: OutlinerServiceStatus }`), so the generic `T` the
  original casts to becomes a checked type. A result that doesn't match says `result: Missing key at [...]`.
- The test runs a fictional host on a real unix socket (`Bun.listen` in a temp dir) and counts open connections
  after each case: zero every time, timeout included.

**What it caught**

- **Acquire the reader before you write.** The first version wrote the request, then acquired `socket.reader`. The
  `ping` test passed; `outlines.create` hung for the full 15 s timeout. The duplex is kept paused and drained on
  `pull`, so an answer that arrives before the reader is acquired can be missed. Reordering fixed it. This is an
  Effect Socket semantic the docs state in `fromDuplex`'s comment, and it would be an easy production bug: the test
  found it only because the fake host answers at once.
- `Effect.fn` with a generic generator (`function*<T>()`) lost its return type (inferred `undefined` at the call
  site). Passing the result Schema as a parameter and returning `S["Type"]` fixed both the typing and the design.

**What it cost**

| | original | spike |
|---|---|---|
| request | 18 lines | 60 lines (four error classes, the decode, the read loop) |
| test | none (covered indirectly) | 68 lines, against a real socket |

- The read loop (`reader.pull`, decode chunks, split on `\n`) is hand-written here; `effect/encoding`'s
  `Ndjson.decodeSchemaString` would do it as a Channel over a Stream, which fits a long-lived connection (the
  Board's event feed) better than this one-shot. Not tried in this slice.
- The timeout test uses a real 150 ms. Codex points out `TestClock` could still drive the `Effect.timeout` here (sync
  on the fake host receiving the request, then advance the virtual clock); the socket events need real event-loop
  progress but the timeout doesn't. Not done in this slice; the earlier claim that TestClock "can't" was wrong.
- `@effect/platform-bun/BunSocket` imports in 58 ms (measured as `BunSocketServer`; the client module is similar).

**Verdicts for this slice**

- Resource cleanup at a client boundary: prevents the class (the socket is scoped).
- Error-path bypass: helps (one error channel, every exit typed), but only within Effect code; the moment this is
  called from a Promise world the four tags collapse into one thrown error again, unless the caller matches on them.
- Untyped result: prevents (the caller names a Schema).
- Lines: worse by three times for a one-shot; the ratio would improve on the long-lived Board connection where the
  original is 100+ lines of reconnect, backoff and catch-up.

## D. `ep0ch outline list | create | delete` on `effect/cli`

`packages/effect-spike/src/outline-cli.ts` and `test/outline-cli.test.ts`; the originals are `parseOutlineArgs` in
`packages/door/src/outlines.ts` (~60 lines of `args.includes` and a `switch`) and `cli-words.ts` (145 lines: the
known words, the door's flags, an edit-distance "closest word" and usage lookup). Chosen to see what the CLI module
gives a 22-command CLI for free, and what its `Environment` costs.

**What changed**

- Each subcommand is `Command.make(name, { flags and arguments }, handler)`. `--machine` and `--json` are shared
  flags on the parent; a subcommand reads them with `yield* outline`. The outline name and the machine name are
  Schemas on the argument and the flag (`Argument.withSchema`, `Flag.withSchema`), so the handler never sees a bad
  one and nothing is sent to the host for `create "Bad Name"` (the test counts connections).
- The host's socket is a `Context.Reference` with a default, swapped by a test (or by `--machine`) without a
  parameter threading through every command.
- `--help`, `--version`, aliases (`ls`), examples and "Did you mean this?" on an unknown subcommand come from the
  module. Completions exist (`Completions.generate`), not tried.
- The test stubs the module's `Environment` (FileSystem, Path, Terminal, ChildProcessSpawner, Stdio) in ten lines
  and reads what was printed through `TestConsole.logLines` and `errorLines`. The Bun layer
  (`@effect/platform-bun`'s `BunServices.layer`) provides the same in one line for `main.ts`.

**What it caught**

- **Parse errors arrive wrapped.** `runWith` fails with `ShowHelp { errors: [...] }` carrying the
  `UnknownSubcommand` or `InvalidValue`, and the runner has already printed them on stderr (`renderErrors` is on
  by default). A caller that wants its own wording (ep0ch's refusals name the exact command) sets
  `renderErrors: false` and formats `errors` itself.
- **"Did you mean" covers subcommands, not flags.** `lits` suggests `list` and `ls`; `--jsno` is "Unrecognized
  flag" with `suggestions: []`. ep0ch's `closest` does both; keeping it would mean formatting `UnrecognizedOption`
  ourselves.
- **A value that looks like a flag is read as a flag.** `--machine -oProxyCommand=x` becomes "Missing value for flag
  --machine" plus "Unrecognized flag: -oProxyCommand", and the machine-name Schema never runs. ep0ch's parser refuses
  it as a bad machine name. Both are refusals; the module's is less specific.

**What it cost**

| | original | spike |
|---|---|---|
| parser and words | ~205 lines (`parseOutlineArgs`, `cli-words.ts`) for 22 commands | 66 lines for 3 commands, help and typo handling included |
| test | `cli-words.test.ts` and `outlines.test.ts` (not counted) | 89 lines plus a 31-line fake host |

- `effect/cli` imports in 70 ms under bun, on top of `effect/Effect`'s 22 ms. `ep0ch --version` is 90 ms today. A
  CLI on this module roughly doubles the startup of the commands that load it; the door itself (the TUI) need
  never import it, so `main.ts` would branch before loading.
- The handler signature `Effect.fn(function*({ all }) { const root = yield* outline; ... })` reads well; the
  pipe of `withDescription`, `withAlias`, `withExamples` after each command is the module's style and is verbose.

**Verdicts for this slice**

- Hand-rolled argv parsing and its duplicated word lists: prevents the class (one definition is the parser, the
  help and the suggestions); the door's `COMMANDS` array and `DOOR_FLAGS` table would go.
- Refusals with the exact command: neutral to slightly worse out of the box (the module's wording), fixable by
  owning error rendering.
- Startup: worse by about 70 ms for CLI runs that load it.
- Typo handling: slightly worse (no flag suggestions).


## Review of the spike's own code (Codex, gpt-6-astra, static)

The branch diff (slices A to D, tests, this file) was piped to Codex with the ultrareview category list and asked for
every real bug, race, leak and misuse. It could not run anything (its sandbox fails on float-2), so it is a static
read cross-checked against upstream v4 source. Full text: the session scratchpad; the counts and the triage here.

**20 findings, 2 high, 18 normal, 0 nits. None false.** By where the fault came from:

| origin | count | which |
|---|---|---|
| copied from main unchanged (pre-existing in ep0ch) | 7 | lock takeover TOCTOU (#1), `upTo` bounds polling not the probe (#6), socket path in chars not bytes (#7), `lastIndexOf("}")` framing (#8), params spread over the envelope (#11), unguarded `JSON.stringify` of params (#12), a post-send disconnect read as "no host" (#14) |
| Effect used wrongly or half-understood | 4 | uninterruptible acquire (#3), `Effect.promise` discards cancellation (#2), `Effect.promise`/`sync` turn rejections into defects so the adapter lies about infallibility (#4), the result-Schema cast hole (#13) |
| new plain bugs in the rewrite | 4 | shared streaming `TextDecoder` (#9), blank line then pull (#10), no line limit where the original had one (#15), `privateDir` mapping every error to the mode refusal (#5) |
| test weaknesses | 3 | sequential callers only (#16), fake host assumes one request per chunk (#17), cleanup not asserted on every path (#18) |
| this document overclaimed | 2 | interruption is not process death (#19), TestClock could drive the timeout (#20) |
| ultrareview classes found in Effect code | 0 | identity-by-name 0, parallel-parser 0 |

Fixed on the branch after the review, each with a test: #3 (`interruptible: true`), #9, #10, #11 (envelope after
the spread), #15 (line limit), and the two document corrections. Left as recorded: #1, #2, #4, #5, #6, #7, #8, #13,
#12, #14, the test weaknesses. #1, #7, #8 and #11 are bugs in main today (`outline-core/src/machine.ts`,
`door/src/socket.ts`); they go to the workboard as a follow-up, not to this branch.

**What the count says**

- Seven of twenty are the original code's, carried over line for line. A rewrite on Effect doesn't fix what it copies;
  the archaeology's parallel-parser and one-path-invariant classes are untouched by the library.
- Four of twenty exist only because of Effect: two of those (#2, #4) are the "two error worlds" cost of wrapping
  Promise code with `Effect.promise` at an edge (defects instead of failures, no cancellation), which is exactly the
  incremental-adoption move. One (#3) is a default (`acquireRelease` uninterruptible) that an agent with v3 knowledge
  wouldn't guess and the docs state. The incremental path pays this tax at every edge; the from-scratch shape pays it
  once.
- Four of twenty are ordinary bugs an agent wrote in 60 new lines of socket framing, which the door's 18-line
  original didn't have because it leaned on `JsonLines` (one shared parser). That is the parallel-parser class,
  made by the spike itself: the right move was `effect/encoding`'s `Ndjson` or the door's `JsonLines`, not a third
  framer.
- Zero identity-by-name and zero parallel-parser findings in the Effect code proper: Schema and Brand give those
  classes somewhere to live, but the spike didn't exercise them (no ids, one parser).
