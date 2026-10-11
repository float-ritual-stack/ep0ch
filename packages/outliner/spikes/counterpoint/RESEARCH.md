# Counterpoint: can a reading be an instrument?

## Built

A working browser instrument over a separate ep0ch outline. Thirty-one fictional passages form an eight-scene conversation about a listening library. A reading is an editable score of source identities, frozen words, revisions, start times and durations.

The score, reference map and listening desk offer structurally different ways through the same sources. You can arrange by hand or follow a chain of authored citations; regroup by any observed property; hold conflicting accounts beside each other; edit sources without silently changing the chosen reading; capture an annotated crossing; save a revision-checked arrangement; and render sound. A single downloadable HTML carries the instrument and its frozen material offline, including re-export after rearrangement.

[Run or download it](README.md). [The portable instrument](evidence/counterpoint.html) is the deliverable, not a mockup.

## Why this

Reconnaissance covered ep0ch's host/client boundary, `BlockRecord`, query groups and facets, revisions, publisher rendering, the extension contract, older reader/canvas experiments, the requested GitHub accounts, and the archive and project directories on float-box.

Three adjacent projects supplied useful constraints:

- [the-field](https://github.com/float-ritual-stack/the-field): one gesture can drive sound and picture through one shared state. Its README also records practical browser-audio constraints.
- [techno-toys](https://github.com/e-schultz/techno-toys): a self-contained artifact is worth making easy to reopen; not every toy needs to become a product.
- [session-archaeology](https://github.com/float-ritual-stack/session-archaeology): keep source records independent from the interpretation, with explicit evidence and unknowns.

The float-box archive contained a May 1 note titled *Active context as live-coded score — same data, different rendering door*, with an April conversation as its cited origin. That historical synthesis made the experiment unusually specific: test the score idea against today's service primitives. It is inspiration, not evidence that the old proposal worked. We read the synthesis, not the complete originating conversation. A December fidget-genealogy note supplied an equally useful restraint: a toy is allowed to remain a toy. The outline record links these historical sources; no archive text or personal conversation was copied into the demonstration corpus.

Ep0ch's architectural opportunity is concrete: the host can already answer identity, references, grouping and revision checks. A strange new surface can spend its code on arranging and experiencing the material.

## Hoped to prove

1. Separating a reading's placement from a source's ownership makes juxtaposition cheap without duplicating canonical notes.
2. Multiple renderings can preserve reference identity while revealing different relationships.
3. Musical time can provide a useful way to linger, repeat or withhold an account.
4. A reading can travel as a bounded artifact without bringing the whole live system with it.

## Discovered

**The strongest primitive is an occurrence with evidence.** A cue needs more than a source ID: which revision, which words, where it appears, and whether the live source has changed. Source editing made this immediately visible. A frozen reading is reproducible but can become misleading. “Take current revision” is a meaningful reader action; silently following the newest source would destroy the thing the reader arranged.

**Juxtaposition beat the graph for reading.** The circular map makes authored crossings discoverable, but its numbers still send you to a reader. The two-account desk lets the objection stay next to the proposal. This is my assessment from driving the instrument, not an owner usability result. The useful shape may be a retained pair, not a more elaborate graph.

**Following citations made the score less decorative.** Chronology alone gives a beautiful, largely predetermined grid. A citation traversal produces a different, inspectable reading toward one account. It is deterministic and cycle-bounded, with no claim that citations imply agreement or that the resulting order is the only argument. This was added after the first functioning score.

**Sound exposes timing, not meaning.** The instrument produces real overlapping tones and lets you hear a voice enter, disappear, or repeat. It does not explain the prose. Hashing group names onto a pentatonic pitch set creates collisions and arbitrary associations. A numerical audio check establishes a nonzero unclipped signal, not a compelling composition. The honest value remains a hypothesis: whether the rhythm helps someone stay with difficult material. A human listening session is still needed before recommending sonification.

**The existing backend was enough.** No protocol or schema changes were needed. Service-owned groups and facets supported switching from speakers to stances without a special stance model. Revision-checked updates refused competing source and arrangement saves. A deliberately unfinished reference still landed. New interpretation lived in the reading, not in a second query language.

**The portable form was a better handoff than another server.** Once source records and query-group results are frozen, the three views, sonification and arrangement controls fit in one roughly 190 KB HTML file. It opens with HTTP blocked and can save a new self-contained version after rearrangement. The boundary is explicit: it cannot query live data or edit sources. Persistence means downloading another file.

**Interaction testing mattered.** An initial drag handler swallowed the next unrelated click because it suppressed clicks globally; the browser journey found it, and suppression now applies only to the dragged cue. Another initial check raced the asynchronous group response; the verification now waits for the rendered group count. The final journey exercises the visible workflow, including concurrent edits and offline re-export, rather than merely checking helper functions.

## Constraints

- This is a bounded rehearsal, not a general archive importer: 64 beats, at most 160 cues, query reads capped at 200 records. Its invented corpus has unusually clean voices and citations. Scale and messy real material remain untested.
- A multi-valued grouping property currently places a source in the first returned group. That loses the ability to hear one source in several memberships; it is a limitation, not a property-model decision.
- The source editor is a textarea, not the shared terminal editor. Its draft survives a refused save and background updates in this page, but not a crash or an accepted page unload. It has no source-editor draft lease or proposal workflow.
- Captured readings and cues deliberately retain copies of chosen words. There is no source-withdrawal policy, redaction propagation or permission revocation. Do not connect this spike to a private shared archive and mistake frozen copies for revocable references.
- Polling every three seconds is sufficient for the rehearsal and stops while hidden. It is not a substitute for the service's watch protocol at scale. Arrangement conflicts preserve the local score and instruct export/reload; there is no automatic merge.
- Headless Chromium passed injected pointer, keyboard, revision, persistence, offline and signal checks. Nobody has assessed the experience on a physical phone or listened for artistic quality.

## Recommendation: extract specific reusable pieces

Preserve Counterpoint as a playable reference. Do not adopt its browser layout, source editor, polling loop or musical mapping into main.

The piece worth extracting is a **versioned reading occurrence**: source identity + chosen revision + excerpt + reader-owned placement, with visible drift and an explicit refresh. Pair it with a portable reading snapshot whose connection to a live source is labelled honestly. Those pieces could serve research comparisons, conversation editing, exhibitions, agent handoffs and ordinary notes without requiring anyone to want a musical outliner.

The narrow next question would be whether two retained, versioned passages help someone compare a real evolving disagreement. Keep the sound as an optional experimental renderer. This recommendation creates no backlog commitment and closes no existing work.
