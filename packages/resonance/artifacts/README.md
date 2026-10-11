# Demonstration evidence

Captured from the real Chromium application over separately seeded scratch outline hosts, including restart checks. All names, notes and conversations in these artifacts are fictional. No production outline supplied the demonstration content.

## Explore the experience

- [Constellation and service-rendered reader](01-constellation.webp): selecting a note illuminates its actual reference neighbors; proximity itself has no semantic claim.
- [Voice islands](02-islands.webp): the same notes regroup by an open authored property, answered by `blocks.query`, not a hard-coded signal taxonomy.
- [Authored chronology](03-chronology.webp): `when` controls time; undated notebooks stay in a separate band.
- [Exact-source comment](04-source-comment.webp): a real service annotation attached to a stored phrase.
- [A saved live score](05-live-score.webp): the gathered route is an ordinary note whose body transcludes its sources.
- [Narrow-screen reader](06-mobile.webp): the alternate layout remains usable without a desktop-width canvas.
- [Service-owned passage highlight](07-highlighted-passage.webp): the same source annotation projected by `notes.render`, without a browser-side offset matcher.
- [Actual terminal rendering](terminal-score.txt): a browser-authored score read through the door against the same scratch host, including the updated beacon source.

Run it yourself with the [launch instructions](../README.md). Captured scratch identifiers are ephemeral; each launch creates new ones. A screen recording was attempted, but the capture environment lacked `ffmpeg`; the seven inspected screenshots and terminal output are the preserved demonstration artifacts.

## Exercised behavior

The service smoke used the actual outline host, HTTP adapter, annotation service and publisher. It checked 42 fictional fragments within 49 seeded notes, 174 resolved-reference/containment edges, six signal groups, HTML rendering, an exact-quote annotation, canonical score creation, source edits appearing in a saved score, stale-write and stale-quote refusal, foreign-origin refusal, the 64 KiB request limit, empty queries and grouping by `voice`.

The real browser exercised grouping, all three layouts, mouse/keyboard navigation, map camera controls, draft retention, optimistic-conflict refusal, explicit rebasing with both writers' text retained, exact-source comments, route direction, score reordering, timed playback, saving/opening a live score, browser reload and scratch-host restart. A score created in the browser was also rendered by the actual door's `show` command against that same scratch host; source changes appeared there without importing or converting the score.

Three concurrency/lifecycle defects were reproduced and corrected:

- A held real revision-1 note response initially overwrote a newer revision-2 cache. With per-note/session/revision guards, the same ordering retained revision 2 in both reader cache and atlas.
- Actual Web Audio oscillator starts were `2 → 4` when pausing/resuming the first step. After the correction they were `2 → 2`: resuming schedules the next step without striking the current one again. Stop disconnects the delay and wet outputs; re-enabling creates a fresh delay path rather than replaying queued samples.
- A still-loaded tab initially retained three foreign score steps and an old draft across an ephemeral-host restart. After the correction, even a query excluding the root had a new canonical root namespace, no old selection/trail/drafts, and the old draft preserved only in its old browser-storage namespace.

The playback status is a polite, atomic live region containing position and note title. This was inspected in Chromium, not tested with a physical screen reader. Audio scheduling/node lifecycle were exercised in Chromium; headphone listening and subjective musical quality were not assessed. Browser automation is proof of the interaction and synthesis path, not a listening review.

## Checks

- Root `bun run check`: all five checked workspaces passed, including the spike and the site's real sample scenarios.
- Focused `model.test.ts`: four tests passed, zero failed, covering reference-only routes, disconnected/hidden nodes, authored chronology and undated notes.
- Two independent read-only reviews covered isolation/service mutations/audio lifecycle and frontend races/drafts/playback/accessibility. Their concrete findings were fixed and the affected runtime paths exercised.

No production deployment, full production-data session, whole-repository test suite or assistive-technology user study is claimed. The experiment remains isolated on `spike/resonance`.
