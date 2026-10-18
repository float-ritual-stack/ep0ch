# 0006: Everything that runs in a note reads one Site

Status: accepted, 2026-10-16; documented in PIE-960 after the PIE-533 cold-start runs.

## Context

**The problem:** values, figures, templates, scripts and extension handlers each had a partial answer to where they ran, what they could read and where their output belonged.
**The consequence:** repeated property flatteners lost list values, private scope walks disagreed, and generated output became detached run artifacts instead of part of a note.
**The decision's source:** PIE-533 design §4 and §7, `ep0ch show --ws pie --machine float-2 0d62cdcb`.

## Decision

**Site:** one context carries the address, containing block record (`this`), definition (`self`), invocation (`caller`), props, actor, optional door and parent Site.
**Ownership:** outline-core owns the pure grammar, records, scope walk and resolver; the service supplies lookups and answers `site.answer`; clients draw that answer.
**Nesting:** a live template keeps the host as `this`, an embed starts from its own note, and a callout passes the Site through.
**Grammar:** `{{ path || fallback }}` is the value form, with list-valued properties, explicit heads and link-following paths; bare keys use the nearest scope and never silently read props.
**Props:** form fields, action arguments and component schemas compile to one PropsSpec; invocation props remain separate from authored properties.
**Render:** a watched answer draws at its invocation, records its dependencies and writes no note.
**Materialize:** placement writes an owned output region through `draft.patch`; anchors and marks locate writes, and conflicts become proposals beside the addressed content.
**Ownership in text:** output regions carry their producer, unique anchor and body hash, so a person's edit and a restart cannot silently lose ownership information.
**Actions:** programmable content uses the existing dispatcher; one layout transaction covers a script's moves and gives one undo.
**Invitation:** a person's press invites its run; an agent's press remains an agent action and does not borrow that invitation.
**Bindings:** reading and writing share the note's meaning; property-grouped boards set properties, structural grouping moves blocks, and durable state stays in authored blocks.
**Capture:** invalid source still saves, with an inline warning; a resolver is never permission to discard what the person typed.

## What this retires

**Property flatteners:** last-wins maps in script, handler and agent contexts give way to block records with lists and field occurrences.
**Separate scope walks:** the runbook's ancestor walk and bespoke property lookups give way to the shared resolver.
**Private interpolation:** runbook substitution, rule-label single braces, macro slots and component-gallery placeholders use the shared interpolation grammar; action arguments are filled after parsing each value.
**Parallel output placement:** producer-specific end-of-note insertion gives way to placement and output regions, with the existing draft router owning conflicts.
**Detached render artifacts:** render output is a dependency-tracked answer; action runs still have receipts for their work.
**Parallel mutation routes:** scripts and buttons use the same actions, attribution and undo as keys and mouse.
**Separate state stores:** authored component state belongs in notes, while viewer selection and scroll stay local to that viewer.

## Consequences

**Two clients:** the door and Herdr's Tree/Detail remain clients of the same service, with their own presentation.
**One version:** changed wire meanings and outline-core computations require the coordinated PROTOCOL bump at the final rebase; there is no old-shape fallback.
**Visibility:** a published answer obeys the reader's visibility cut; buttons are inert for published readers ([ADR 0005](0005-agents-act-nodes-mail.md)).
**Small-model acceptance:** each docs-only failure is repaired in the API or docs and the same task rerun, never patched with a hint in the brief.
**Current calls:** [Programmable notes](../../packages/outliner/docs/PROGRAMMABLE-NOTES.md) gives the five scratch tasks; [scripts.md](../../packages/outliner/docs/scripts.md) is the executable surface reference, including limitations.
