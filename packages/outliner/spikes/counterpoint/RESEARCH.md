# Counterpoint: can a reading be an instrument?

## What I built

A working browser instrument over a separate ep0ch outline. Thirty-one fictional passages form an eight-scene conversation about a listening library. A reading is an editable score of source identities, frozen words, revisions, positions and durations.

The score, reference map and listening desk offer three ways through the same material. Arrange by hand or follow authored citations; group by any observed property; hold conflicting accounts beside each other; edit a source without silently rewriting its cue; capture an annotated crossing; save the arrangement; render sound. A single downloadable HTML carries the instrument offline and can re-export a rearranged version.

[Run it](README.md) or [download the portable instrument](evidence/counterpoint.html). This is a playable artifact, not a mockup.

## Why this experiment

Reconnaissance covered the host/client boundary, `BlockRecord`, query groups and facets, revisions, publisher rendering, extensions, older reader/canvas experiments, both requested GitHub accounts, and float-box's project directories and archive.

Three neighboring projects supplied constraints:

- [the-field](https://github.com/float-ritual-stack/the-field): sound and picture can share one gesture and state.
- [techno-toys](https://github.com/e-schultz/techno-toys): make the artifact easy to reopen; a toy need not become a product.
- [session-archaeology](https://github.com/float-ritual-stack/session-archaeology): keep evidence independent from its interpretation and preserve unknowns.

The float-box archive contained a May 1 synthesis, *Active context as live-coded score — same data, different rendering door*, citing an April conversation. It made the experiment specific: test the score idea against today's primitives. I read the synthesis, not the complete originating conversation. A December fidget-genealogy note reinforced that the result could remain a toy. The outline record identifies those sources; no private archive text was copied into the demo corpus.

The architectural opportunity was concrete: ep0ch already answers identity, references, grouping and revision checks. A new surface can concentrate on what arranging material feels like.

## What I hoped to prove

A reading can have its own arrangement without taking ownership of its sources. Different renderings can preserve identity while exposing different relationships. Musical time might help someone linger, repeat or withhold an account. The resulting reading might travel without the whole live application.

## What I discovered

**The strongest primitive is an occurrence with evidence.** A cue needs more than a source ID: which revision, which words, where it appears, and whether its source changed. Frozen words are reproducible but can become misleading. “Take current revision” became a meaningful reader action. Automatically following the newest source would destroy what the reader arranged.

**Juxtaposition beat the graph for reading.** The circular map makes crossings discoverable, but its numbers still send you to a reader. The two-account desk keeps the objection beside the proposal. This is my assessment from driving the instrument, not an owner usability result. The useful shape may be a retained pair rather than a more elaborate graph.

**Following citations made the score less decorative.** Chronology initially gave a pleasing but predetermined grid. Adding a citation traversal produced an inspectable reading toward one account. It is deterministic and visits cycles once; a citation does not imply agreement, and this is not the only possible reading.

**Sound exposes timing, not meaning.** Overlapping tones let you hear a voice enter, disappear or repeat. They do not explain its prose. Mapping names onto pentatonic pitches creates collisions and arbitrary associations. The audio check proves a real, nonzero, unclipped signal—not a compelling composition. Whether rhythm helps someone stay with difficult material remains an open listening question.

**The existing backend was enough.** No protocol or schema change. Service-owned facets supported switching from speakers to stances without a special stance model. Competing source and arrangement saves were refused; drafts remained visible. An unfinished reference still saved. Interpretation stayed in the reading instead of becoming a second query language.

**A revision number does not freeze context.** Editing a speaker property changes the connected score’s live grouping, even while its cue retains old words. Reproducing the entire reading requires a snapshot of query membership and context as well as excerpts. The portable version freezes both; the connected version labels its groups as live. This is a missing primitive exposed by the experiment.

**The portable artifact improved the handoff.** Freezing records and service-computed grouping results put the instrument in roughly 190 KB of HTML. It works with HTTP blocked and saves a new file after rearrangement. Its boundary is explicit: no live queries or source edits. Persistence means downloading another file.

**The workflow test found a real interaction fault.** The first drag handler suppressed the next unrelated click. Suppression now applies only to the dragged cue. A separate check initially raced an asynchronous group response; it now waits for the rendered result. [The final browser journey](evidence/verification.json) exercises conflicts, persistence, offline re-export and the actual controls.

## Limits

The staged corpus is easier than a real archive: 64 beats, at most 160 cues, reads capped at 200 records. Multi-valued properties currently use the first returned group. The textarea editor has no shared draft lease or crash recovery. Polling is adequate here, not a scaling design. Conflicting arrangements require export/reload, not automatic merging.

Frozen words also need a future withdrawal policy: this spike has no redaction propagation or permission revocation. It must not be mistaken for a safe shared-archive client. Headless Chromium verification does not establish physical-device behavior or musical quality.

## Recommendation: extract specific reusable pieces

Preserve Counterpoint as a playable reference. Do not adopt its layout, editor, polling loop or musical mapping into main.

Extract the concept of a **versioned reading occurrence**: source identity + chosen revision + excerpt + reader-owned placement, with visible drift and explicit refresh. Pair it with a snapshot of the reading’s query results and an honestly labelled portable artifact. Those pieces could serve research comparisons, conversation editing, exhibitions and agent handoffs without requiring a musical outliner.

A narrower follow-up would ask whether two retained, versioned passages help someone compare a real evolving disagreement. Sound stays an optional experimental renderer. This recommendation creates no backlog commitment and closes no existing work.
