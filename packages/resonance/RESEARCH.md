# Resonance: an outline as a reading instrument

## What did we build?

A graphical listening station over the existing outline host. The same canonical notes can be seen as a reference constellation, property islands, or an authored chronology. A reader sits beside the map; the map never becomes the source of truth. A visitor can edit Blockdown, annotate an exact source passage, weave a reference path, reorder it into a score, and perform it with optional synthesized sound. Saving the score creates an ordinary note containing live transclusions.

The demonstration is a separate scratch outline: **Nacre**, a fictional abandoned orbital station with 42 fragments and six field notebooks. Its material contains conflicting explanations, uncertain observations, and references that connect disagreement rather than consensus. We deliberately avoided private archival content, inferred semantic edges, model calls, and production data.

## Why choose this?

Three strands met:

1. **The graph is the map; content is the territory.** [Passenger Manifest's reader rebuild](https://github.com/float-ritual-stack/passenger-manifest-shady/blob/main/docs/plans/2026-02-25-v6-reader-rebuild-design.md) makes the content reader primary and the force graph navigational. Its old light Markdown parser and client-side filters were constraints we did not need to inherit.
2. **Arrangements need not own content.** [Outline Canvas](https://github.com/e-schultz/outline-canvas) already separated canonical identity from disposable reader occurrences, with directional links and bounded service projections. Freeform geometry, editing, live subscriptions, and an alternative event-store authority were explicitly deferred. The old screen-note/bundle brief on float-box similarly treated a working arrangement as references rather than copies.
3. **An interface can be an instrument.** [The Field](https://github.com/float-ritual-stack/the-field) shares one gesture between sound and picture. Its implementation notes emphasize explicit audio initialization inside a user gesture. [Techno Toys](https://github.com/e-schultz/techno-toys) treats experiments as things worth reopening, not every prototype as a product obligation.

A bounded read of archived design-chat exports on float-box found earlier alternative-client framings around a radio tuner, patch bay, microfiche reader, and switchboard; other conversations explored stark musical instruments and editorial reading with a marginal rail. Those were inspiration, not requirements. No private conversations or identifying source passages were copied into the demonstration or repository.

The current architecture now provides the missing leverage: [canonical records](../outline-core/src/block-record.ts), [open service queries](../outline-core/src/protocol.ts), and the outliner's existing [RPC client](../outliner/src/client.ts), [render operation](../outliner/src/types.ts), [annotations](../outliner/src/annotations.ts), and [transclusions](../outliner/src/transclusions.ts). The live design notes about composed screens and threads-as-notes reinforce the same distinction: an arrangement, a conversation, and a reading can be useful views over ordinary blocks.

## What were we hoping to prove?

- A strange graphical experience can be a thin host over the existing service rather than an alternative application engine.
- Navigation can produce an authored artifact: a reading order saved as a document, not merely an ephemeral graph selection.
- Structure alone can support a meaningful spatial and audible experience without pretending to infer meaning.
- Different layouts can expose different questions about the same notes, especially disagreement, authorship, event time, and absence.
- Editing and annotation need not disappear merely because the experiment starts from a map.

## What did we discover?

**A trail is already a document primitive.** The score needs no new store or wire operation: `notes.create` plus canonical references and `!((id))` is sufficient. The interesting reusable thing is not a graph renderer; it is the transition from a working reading order to a live, source-linked artifact. A sequence can include contradictory statements without synthesizing them into false agreement.

**The renderer is a stronger seam than a copied parser—but audience matters.** `notes.render` supplies Blockdown/transclusion semantics and, with `marks: true`, projects exact-source annotations into real `<mark>` elements. The browser does not invent text offsets or run a second parser. An unexpected boundary remains: reference headings to unpublished notes say “unpublished note” in the publisher's HTML while their embedded bodies render; the terminal resolves those same references to full titles. A private graphical reader needs an explicit rendering-context contract, not fake publication properties. This policy was preserved.

**Chronology immediately exposed a false fallback.** All demonstration records are inserted together. Treating creation timestamps as event times collapses the expedition into the seed moment; worse, undated notebooks get an invented place in the fiction. The implementation uses authored `when` dates and a separate undated band. Ingestion time must not quietly substitute for an unknown domain date.

**Folders are terrible evidence-path shortcuts.** Including physical parent edges in route finding would connect unrelated fragments through a common notebook. The map can draw containment, but the shortest-route operation excludes it. Traversal is bidirectional for navigation while the map retains authored direction. It makes no claim about causality, relevance, or agreement, and only searches the current bounded answer.

**A property lens is genuinely open.** Groups and facet counts come from `blocks.query`, not a client-side catalogue of acceptable property names. `signal`, `voice`, and `certainty` are demonstration content, not closed product categories. A multi-valued note still needs an occurrence policy: this experiment places it in the first service-returned group. That is a presentation limitation, not a claim that its other memberships vanished.

**Sound is structural punctuation, not intelligence.** The instrument uses hashed signal identity for pentatonic degrees, link count for register, text length for decay, and note identity for stereo position. Audio starts only on an explicit gesture, uses bounded voices/tails, and can be stopped. This explores order, pacing, and attention; it does not establish that musical coherence measures conceptual coherence.

**Bounds matter when a score leaves the map.** Atlas rows are capped at 240, records are fetched in the service's 200-id batches, and scores at 120 steps. A long saved score still encounters the publisher's existing embed limits. A link to every step does not mean every source can be expanded in one document. A production score would need an explicit chapter/fragment composition policy rather than silently raising budgets.

**Isolation is part of the artifact.** The launcher constructs a private HOME, XDG roots, outlines folder, prompts folder, and host socket, with an allowlisted child environment. There is no option to aim the demo at an existing database. Browser state is namespaced by the scratch atlas's canonical root ID, preventing drafts from being confused with identically named outlines from a later launch. Ctrl-C discards the demonstration data; this is not a durable workspace manager.

**Thin clients still need identity and ordering discipline.** Holding an actual old note response until after a newer edit initially rolled the cache from revision 2 back to 1. Per-note tickets, session identity and revision guards prevent that. Restarting the scratch host initially mixed old drafts and score steps into the new expedition; exposing the canonical root even in root-excluding queries fixed the boundary without discarding the previous browser namespace.

**The sound experiment exposed a real state machine.** Pause/resume initially struck the current note twice; actual oscillator starts changed from `2 → 4` before the fix to `2 → 2` after it. A stopped delay also retained queued samples, so Stop now disconnects the old wet path and re-enabling creates a new one. These are exercised synthesis/state results, not evidence of subjective musical quality. Dense all-label graph layouts also proved less readable than selected-reference-neighbor spotlighting.

## What should happen next?

**Extract specific reusable pieces; do not adopt this client wholesale.**

The candidate worth preserving is **reading-order promotion**: gather canonical targets, reorder them, and create a live source-linked document. It could belong in the door, the publisher, an agent tool, or a userland extension without carrying graph geometry or audio into any of them. The undated-band rule and separation of containment from evidence traversal are also useful reference decisions.

Preserve Resonance on its spike branch as a runnable instrument. Its graph layout, plain source editor, private package imports, and session-ephemeral lifecycle are deliberate experiment choices, not proposed production architecture. Adopting a whole alternate editor would reopen draft coordination, accessibility, layout density, and public package-seam questions already owned elsewhere.

A narrower future experiment would compare a curated trail with a link-shortest trail for an actual retrieval task, measuring whether the composition helps a returning reader understand a disagreement. No new backlog items or changes to existing ticket status are part of this spike.

[Launch and interaction guide](README.md) · [Executed demonstration evidence](artifacts/README.md)
