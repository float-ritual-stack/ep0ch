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

- A test the original couldn't express: *the lock is let go when the waiter is interrupted* (a client that quits
  mid-start). `Fiber.interrupt` on the forked `ensureForward` runs the release finalizer; the original's
  `try/finally` only covers a thrown error, not a process that is killed or a caller that stops waiting. This is the
  resource-cleanup class from #172/#194, and the mechanism is structural, not a discipline.
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
