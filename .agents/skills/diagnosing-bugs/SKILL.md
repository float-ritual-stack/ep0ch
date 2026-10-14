---
name: diagnosing-bugs
description: Diagnosis loop for bugs, failing or flaky tests, and performance regressions. Use when the user says "diagnose"/"debug this", reports something broken/throwing/failing/slow, or a test or CI run fails, before proposing any fix.
---

# Diagnosing Bugs

A discipline for bugs and failing tests. Skip phases only when explicitly justified.

**No fix without a root cause, and no fix without a reproduction that goes red on it.** A rerun that passes is
not a fix; "it's probably X, let me change it" is not a root cause.

When exploring the codebase, read `GLOSSARY.md` (if it exists) to get a clear mental model of the relevant modules, and check ADRs in the area you're touching.

## Redact

This skill has you show commands, outputs and captured artifacts. **Redact every secret first**: write `<REDACTED>` in its place. Build loops against env vars, so the credential stays in the environment rather than in what you show. Captured artifacts carry auth headers: quote only the lines that carry the signal.

If the redacted output is not enough to diagnose the bug, say so and ask the user.

## Phase 1: Build a feedback loop

### Start by looking (this is not hypothesising)

- **Read the error in full**: the message, the whole stack trace, the file and line, the test's name. It often names the fix.
- **Check what changed**: recent commits and merges in the area (`git log -p --since=… -- <path>`), dependencies, config, the environment (another machine, more load, CI).
- **In a system of parts** (CLI → service → database, door → socket → host, CI → runner → test), find *where* it breaks before *why*: log what enters and leaves each boundary once, then dig into the part where good data goes in and bad comes out.
- **Trace a bad value backwards** to where it was born, not where it blew up: [root-cause-tracing.md](root-cause-tracing.md). Fix it at the source.

**This is the skill.** Everything else is mechanical. If you have a **tight** pass/fail signal for the bug (one that goes red on _this_ bug), you will find the cause; bisection, hypothesis-testing, and instrumentation all just consume it. If you don't have one, no amount of staring at code will save you.

Spend disproportionate effort here. **Be aggressive. Be creative. Refuse to give up.**

### Ways to construct one, in roughly this order

1. **Failing test** at whatever seam reaches the bug: unit, integration, e2e.
2. **Curl / HTTP script** against a running dev server.
3. **CLI invocation** with a fixture input, diffing stdout against a known-good snapshot.
4. **Headless browser script** (Playwright / Puppeteer) that drives the UI and asserts on DOM/console/network.
5. **Replay a captured trace.** Save a real network request / payload / event log to disk; replay it through the code path in isolation.
6. **Throwaway harness.** Spin up a minimal subset of the system (one service, mocked deps) that exercises the bug code path with a single function call.
7. **Property / fuzz loop.** If the bug is "sometimes wrong output", run 1000 random inputs and look for the failure mode.
8. **Bisection harness.** If the bug appeared between two known states (commit, dataset, version), automate "boot at state X, check, repeat" so you can `git bisect run` it.
9. **Differential loop.** Run the same input through old-version vs new-version (or two configs) and diff outputs.
10. **HITL bash script.** Last resort. If a human must click, drive _them_ with `scripts/hitl-loop.template.sh` so the loop is still structured. Captured output feeds back to you.

Build the right feedback loop, and the bug is 90% fixed.

### Tighten the loop

Treat the loop as a product. Once you have _a_ loop, **tighten** it:

- Can I make it faster? (Cache setup, skip unrelated init, narrow the test scope.)
- Can I make the signal sharper? (Assert on the specific symptom, not "didn't crash".)
- Can I make it more deterministic? (Pin time, seed RNG, isolate filesystem, freeze network.)

A 30-second flaky loop is barely better than no loop; a 2-second deterministic one is tight, a debugging superpower.

### Non-deterministic bugs

The goal is not a clean repro but a **higher reproduction rate**. Loop the trigger 100×, parallelise, add stress, narrow timing windows, inject sleeps. A 50%-flake bug is debuggable; 1% is not, so keep raising the rate until it's debuggable.

On a shared machine, loop serially with a timeout through the machine's test slot (here: `scripts/agent-env <name> --test --`
on float-2); parallel or heavy stress runs go to a machine of their own (here: float-box, `scripts/box-test`). Never
stress a live service.

Delays are for *reproducing* a race (hold one side back to force the bad order), never for *fixing* one. The fix waits on the condition itself: [condition-based-waiting.md](condition-based-waiting.md).

### When you genuinely cannot build a loop

Stop and say so explicitly. List what you tried. Ask the user for: (a) access to whatever environment reproduces it, (b) a redacted captured artifact (HAR file, log dump, core dump, screen recording with timestamps), or (c) permission to add temporary production instrumentation. Do **not** proceed to hypothesise without a loop.

### Completion criterion: a tight loop that goes red

Phase 1 is done when the loop is **tight** and **red-capable**: you can name **one command** (a script path, a test invocation, a curl) that you have **already run at least once** (show the invocation and its output, redacted), and that is:

- [ ] **Red-capable**: it drives the actual bug code path and asserts the **user's exact symptom**, so it can go red on this bug and green once fixed. Not "runs without erroring"; it must be able to _catch this specific bug_.
- [ ] **Deterministic**: same verdict every run (flaky bugs: a pinned, high reproduction rate, per above).
- [ ] **Fast**: seconds, not minutes.
- [ ] **Agent-runnable**: you can run it unattended; a human in the loop only via `scripts/hitl-loop.template.sh`.

If you catch yourself reading code to build a theory before this command exists, **stop: jumping straight to a hypothesis is the exact failure this skill prevents.** No red-capable command, no Phase 2.

## Phase 2: Reproduce + minimise

Run the loop. Watch it go red as the bug appears.

Confirm:

- [ ] The loop produces the failure mode the **user** described, not a different failure that happens to be nearby. Wrong bug = wrong fix.
- [ ] The failure is reproducible across multiple runs (or, for non-deterministic bugs, reproducible at a high enough rate to debug against).
- [ ] You have captured the exact symptom (error message, wrong output, slow timing) so later phases can verify the fix actually addresses it.

### Minimise

Once it's red, shrink the repro to the **smallest scenario that still goes red**. Cut inputs, callers, config, data, and steps **one at a time**, re-running the loop after each cut, and keep only what's load-bearing for the failure.

Why bother: a minimal repro shrinks the hypothesis space in Phase 3 (fewer moving parts left to suspect) and becomes the clean regression test in Phase 5.

Done when **every remaining element is load-bearing**: removing any one of them makes the loop go green.

Do not proceed until you have reproduced **and** minimised.

## Phase 3: Hypothesise

Generate **3–5 ranked hypotheses** before testing any of them. Single-hypothesis generation anchors on the first plausible idea.

A good source: **a working sibling**. Find the nearest similar code that works (another screen, another test, the same call from another caller), read it completely, and list every difference, however small.

Each hypothesis must be **falsifiable**: state the prediction it makes.

> Format: "If <X> is the cause, then <changing Y> will make the bug disappear / <changing Z> will make it worse."

If you cannot state the prediction, the hypothesis is a vibe: discard or sharpen it.

**Show the ranked list to the user before testing.** They often have domain knowledge that re-ranks instantly ("we just deployed a change to #3"), or know hypotheses they've already ruled out. Cheap checkpoint, big time saver. Don't block on it; proceed with your ranking if the user is AFK.

## Phase 4: Instrument

Each probe must map to a specific prediction from Phase 3. **Change one variable at a time.**

Tool preference:

1. **Debugger / REPL inspection** if the env supports it. One breakpoint beats ten logs.
2. **Targeted logs** at the boundaries that distinguish hypotheses.
3. Never "log everything and grep".

**Tag every debug log** with a unique prefix, e.g. `[DEBUG-a4f2]`. Cleanup at the end becomes a single grep. Untagged logs survive; tagged logs die.

**Perf branch.** For performance regressions, logs are usually wrong. Instead: establish a baseline measurement (timing harness, `performance.now()`, profiler, query plan), then bisect. Measure first, fix second.

## Phase 5: Fix + regression test

Write the regression test **before the fix**, but only if there is a **correct seam** for it.

A correct seam is one where the test exercises the **real bug pattern** as it occurs at the call site. If the only available seam is too shallow (single-caller test when the bug needs multiple callers, unit test that can't replicate the chain that triggered the bug), a regression test there gives false confidence.

**If no correct seam exists, that itself is the finding.** Note it. The codebase architecture is preventing the bug from being locked down. Flag this for the next phase.

If a correct seam exists:

1. Turn the minimised repro into a failing test at that seam.
2. Watch it fail.
3. Apply the fix.
4. Watch it pass.
5. Re-run the Phase 1 feedback loop against the original (un-minimised) scenario.

**One fix at a time**, aimed at the root cause: no bundled refactors, no "while I'm here". If the fix doesn't turn
the loop green, undo it and go back to Phase 3 with what it showed; don't stack another fix on top.

**After three failed fixes for one cause, stop.** Each fix uncovering a new problem somewhere else is the sign of a
wrong design, not a fourth hypothesis. Say so, and question the design with the person before trying again.

### When it really is the environment

If the investigation shows the cause is outside the code (a machine, a network, a dependency's timing), say what you
checked, handle it where it lands (a clear error, a bounded retry, a wait on a condition), and add the logging that
would catch it next time. Most "no root cause" findings are an investigation that stopped early: report "no root
cause found" with what was checked, never a guess dressed as a cause.

## Phase 6: Cleanup

Required before declaring done:

- [ ] Original repro no longer reproduces (re-run the Phase 1 loop)
- [ ] Regression test passes (or absence of seam is documented)
- [ ] All `[DEBUG-...]` instrumentation removed (`grep` the prefix)
- [ ] Throwaway prototypes deleted (or moved to a clearly-marked debug location)
- [ ] The hypothesis that turned out correct is stated in the commit / PR message, so the next debugger learns

## Stop signs

Back to Phase 1 when you catch yourself thinking any of these:

- "Quick fix for now, investigate later." / "Just try changing X and see."
- "Rerun it, it's probably a flake." (One rerun can show it's intermittent; a pass doesn't make the first failure harmless. Keep its evidence and diagnose or ticket it.)
- "Several changes at once, then run the tests."
- "Skip the test, I'll check it by hand."
- "I don't fully understand it, but this might work."
- "Just one more fix" when two have already failed: the third failure is the stop.

## Sources

Adapted for this repository from [mattpocock/skills](https://github.com/mattpocock/skills)
(`skills/engineering/diagnosing-bugs`, MIT), with the start-by-looking steps, the working sibling, one fix at a
time, the stop after three failed fixes, the stop signs and the two supporting files taken from
[obra/superpowers](https://github.com/obra/superpowers) `skills/systematic-debugging` (MIT, © Jesse Vincent),
fetched October 2026. It is no longer tracked in `skills-lock.json`, so a skills update leaves it alone.
