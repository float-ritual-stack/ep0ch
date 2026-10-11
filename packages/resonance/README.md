# Resonance

An outline you can play. A spatial reading instrument over the real ep0ch host, not a new outline engine.

**Spike branch: `spike/resonance`. Not a production client.** The demonstration creates a separate, fictional outline and refuses existing data directories. No real notes, shared services, model providers, microphones, or cameras are used.

## Launch

From this branch's repository root, with Bun installed:

```sh
bun install --frozen-lockfile
bun run --cwd packages/resonance demo
```

Open **http://127.0.0.1:4789**. Use that exact address; `localhost` is deliberately not an alternative origin. `RESONANCE_PORT=4790 bun run --cwd packages/resonance demo` selects another loopback port.

For a checkout on another machine, use a temporary SSH forward, not a public listener:

```sh
ssh -N -L 4789:127.0.0.1:4789 <your-ssh-host>
```

The launcher prints its private `/tmp/resonance-*` root and host socket. It runs the existing outline host with an allowlisted environment, private HOME/XDG/config/extension paths, and the outline name `resonance`. **Ctrl-C stops its host and deletes this session's outline. Edits and saved scores last only for that launch.** Browser drafts/working state survive a page reload within that session. A new launch gets a new canonical root namespace; previous drafts remain only in their previous browser-storage namespace, not in the new outline. Browser storage is not a database backup.

## The experience

Nacre is an abandoned orbital listening station. Forty-two authored fragments, six field notebooks, and an atlas offer conflicting explanations of what happened there. This is fictional material written for the experiment, not an export of anyone's notes.

- **Constellation:** actual resolved references and physical parentage, laid out as a bounded graph.
- **Islands:** the service's groups for any property. Change `signal` to `voice` or `certainty`; there is no fixed schema of allowed filters.
- **Chronology:** authored `when` dates across the map, with a separate band for missing or invalid dates. Database creation time would collapse the entire expedition into the moment it was seeded.
- **Reader:** the publisher's actual HTML renderer, including service-owned passage highlights, or exact Blockdown source. Read source relations, edit with optimistic revisions, and add whole-note or exact-quote comments.
- **Score:** gather notes, reorder them, find a shortest connective route, perform the sequence, and save it into the scratch outline as a real document of live transclusions.
- **Sound:** explicitly enable the instrument. Signal identity chooses a pentatonic degree, reference count shifts the register, text length sets decay, and note identity sets stereo position. This is deterministic sonification, **not semantic understanding**.

A suggested journey: start with **Arrival at the listening station**, trace toward **The expedition is a score**, collect the resulting path, listen, rearrange it, and save it. Open the saved document. Change a source note and reread the score: its material is still live.

**Edges are evidence of a reference, not agreement. Distance is layout, not semantic similarity.** Route finding navigates reference edges in either direction; it excludes containment edges so a shared notebook cannot manufacture a connection. It searches only the current bounded answer, not the entire database. Multi-valued notes occupy their first service-returned group in the islands layout.

## Isolation and architecture

`demo.ts` owns a scratch host; `server.ts` exposes fixed same-origin loopback HTTP routes; `model.ts` owns disposable graph presentation and reference traversal; `app.ts` owns the graphical experience; `sound.ts` owns opt-in synthesized sound; `seed.ts` owns the fictional corpus.

The host owns query evaluation, property facets, reference resolution, records, revisions, annotations, and rendering. The browser does not parse Blockdown or implement a query language. It reads `BlockRecord` from outline-core, and the HTML reader uses `notes.render` in a sandboxed frame.

**Intentional spike exception:** the HTTP adapter and launcher import private outliner modules rather than copy their protocol/client. No public package exports, shared grammars, protocol number, schema, door layout, or production runtime paths were changed. This package is not embedded in the door kitchen sink: it is an alternative graphical host with its own seeded, runnable demonstration.

Atlas answers are capped at 240 notes; scores at 120 steps. Limits and errors remain visible. Rendering retains the publisher's transclusion limits; a long score can exceed its embed budget even though every step remains linked. The launcher is session-ephemeral by design, not a durable workspace manager.

The publisher also keeps its publication-aware link policy: a score's reference headings can read **“unpublished note”** while the embedded bodies are visible. The terminal reader resolves the same references to their titles. No dummy publication metadata is added to bypass that distinction; this is a real renderer-context boundary exposed by the spike.

## Verification and findings

[Research brief](RESEARCH.md) explains the lineage, hypotheses, observed results, and recommendation. [Demonstration evidence](artifacts/README.md) contains the exercised journey and captures.

Focused checks:

```sh
bun run --cwd packages/resonance check
scripts/agent-env resonance --test -- timeout 900 bun test packages/resonance/model.test.ts
```

The route regression checks protect against invented hierarchy shortcuts and paths through omitted notes. They do not replace the browser demonstration.
