# Verification — 2026-10-11

## The experiment

- `bun run check:counterpoint`: exit 0. The spike's server, browser code, audio code, seed and model type-check together.
- `scripts/agent-env counterpoint-verify --test -- timeout 900 bun run verify:counterpoint` with installed Chromium: exit 0. The [browser journey](verification.json) records the exercised behavior. Each run started and stopped its own host on an OS-assigned port.
- Inspected the desktop score, crossings, listening desk, revision-drift and 390px screenshots. These are screenshots of the running application, not design renders.
- Restarted the connected rehearsal after saving a 73 BPM arrangement. The resumed host returned the same arrangement identity, revision 2, tempo and all 31 unchanged source records. Restoring the original score made revision 3.
- The normal `ep0ch find --query 'type=passage' --json`, explicitly pointed at this private host, returned the same 31 records. The browser is a client of the real service.
- The HTML artifact loaded with HTTP and HTTPS blocked. Regrouping and rearrangement worked; exporting and reopening another HTML preserved the changed score. The portable form makes no network requests.

## Existing repository

`bun run check` passed at the root, including site examples. `scripts/box-test --on float-box all` exited **0**, in 10m42s, and removed its private remote test directory.

| Suite | Passed | Skipped | Failed |
| --- | ---: | ---: | ---: |
| outline-core | 257 | 0 | 0 |
| outliner | 2,318 | 2 | 0 |
| door | 2,458 | 19 | 0 |
| claude-mod | 205 | 0 | 0 |

The whole-suite run tested `5076c292add2`, the rebased first spike commit. Subsequent changes are confined to the spike's own files and evidence; maintained package implementations and their tests are identical. The final spike behavior was exercised separately by its browser journey and typecheck. No `--each` run was performed: this branch is a preserved experiment, not a merge series. Existing skipped tests are not claimed as coverage.

## Review boundaries

Architecture first: outline identity, query evaluation, grouping, facets, reference resolution and revisions remain service-owned. The browser reuses `BlockRecord`, the publisher's Markdown/callout rendering, and existing RPCs. There is no protocol/schema bump and no change to a production renderer or editor. Frozen cue text and portable grouping results are explicit snapshots, not a second canonical store.

The new browser layout, textarea editor, action dispatcher, clock and audio synthesis are deliberately experimental. They do not inherit the terminal door's draft leases, actor model or focus guards. Capturing data from a real shared archive would additionally require a withdrawal and redaction policy.

The journey establishes injected mouse/keyboard behavior in headless Chromium and numerically nonzero, unclipped audio. It does not establish a physical-device experience, mobile Safari compatibility, musical quality, owner acceptance or production suitability. No PR was opened, nothing was merged, and no shared deployment was performed.
