# Research: a room to return to

Primary sources read before implementation, 2026-10-11. Tern installed build: 0.4.5 (1d14241); omp: 18.9.1.

## Tern

- [SDK overview](https://docs.stencil.so/tern/) separates host Luau (persistent native blocks, lenses and pane hooks) from window Luau (commands, routes, chrome, CSS, layouts). A host block survives window closure and can be restored after daemon restart. This is a better fit for a return room than a transient command lens.
- [Blocks](https://docs.stencil.so/tern/guides/blocks.md) define `init/view/event/key/save`, stable keyed views, diff rendering, and a liveness check for background work. No close callback: pollers must check `tern.pane.list()`.
- [Views](https://docs.stencil.so/tern/guides/views.md) provide native cards, rows, lists, badges, text and actions. [Elements](https://docs.stencil.so/tern/elements/index.md) exposes semantic tones and scoped roles; no HTML browser required.
- [Inputs](https://docs.stencil.so/tern/elements/input.md) are program-owned. Plugin blocks advertise no edit/undo features, so a Luau text field is not a complete editor. Decision: use Tern's existing file editor for durable reply drafts, not implement another editor.
- [Routing](https://docs.stencil.so/tern/guides/routing.md) documents `cx:open` and file blocks. [Shared API](https://docs.stencil.so/tern/reference/api-shared.md) documents async `tern.process.run(argv, options, callback)`; argv is not shell text. Decision: invoke a Bun adapter, not shell interpolation, and leave outline semantics in the host.
- [Debugging](https://docs.stencil.so/tern/guides/debugging.md) and [Scripts](https://docs.stencil.so/tern/scripts/index.md): ordinary windows with `--control` run installed plugins; `serve`/`shot` headless mode does not load arbitrary installed plugins. Real verification must use an isolated ordinary window, driven through control commands, under a virtual display on this machine.

## omp

- [Extension authoring](omp://skills/authoring-extensions.md), [extensions](omp://extensions.md), [loading](omp://extension-loading.md), [plugin manager](omp://plugin-manager-installer-plumbing.md): default TS factory, injected parameter builder, tools/commands/hooks, `omp.extensions` manifest. Runtime actions belong in handlers, not factory loading. `--no-extensions` with an explicit extension gives a local development route without installation.
- `sessionManager.getSessionId()` identifies the originating conversation; factories are rebound for child sessions. State must not live in module globals. `appendEntry` plus branch reconstruction supports durable receipts.
- `sendMessage(..., {deliverAs:'nextTurn', triggerTurn:false})` appends while idle without a paid turn. Explicit `/room-pull` is preferable here to a background poller that silently resumes an agent.
- [RPC](omp://rpc.md) allows exercising extension commands and reading entries in the actual runtime without asking a model to imitate a tool call. The smoke must also assert that no `agent_start` occurred.

## ep0ch

- [Architecture](../../packages/outliner/docs/ARCHITECTURE.md), [repository contract](../../AGENTS.md): many thin clients, one source of truth. The host owns queries, revisions, attribution and links. Tern should own presentation, not another outline store.
- [Shared header grammar](../../packages/outline-core/src/header-line.ts) and [property grammar](../../packages/outline-core/src/property-grammar.ts) already construct and read header chips. Reuse them. Room card bodies are displayed as literal source, explicitly not a new Blockdown renderer.
- [Agent tools](../../packages/outliner/src/agent-tools.ts) and [CLI](../../packages/outliner/src/cli.ts) provide exact operations for named outlines. Cards use agent/session attribution; person responses use `author:user`. Revision-anchored responses are child notes, not edits of the agent's card.
- [Rendered provenance](../../packages/outliner/docs/RENDERED_PROVENANCE.md): do not infer source ranges from rendered strings. This spike names whole-card revisions; it does not pretend to implement selection provenance.

Two delegated source-reading passes informed these decisions. No private chat-export content was copied; the supplied architectural context and current primary contracts were sufficient to choose this experiment.
