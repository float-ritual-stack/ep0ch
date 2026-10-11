# Return Room spike contract

A native Tern return room, not a chat clone: an agent leaves findings, alternatives, questions and evidence; the person compares, keeps, questions or parks them, and sends a saved reply to the originating omp session. All cards and feedback are real notes in a dedicated scratch outline. No production outline, backlog, config or door is changed.

## Storage and processes

`RETURN_ROOM_CONFIG` is an absolute path to JSON `{version:1, outlines:string, outline:string, room:string, drafts:string}`. `room` is the root block UUID. `outlines` is an explicitly supplied private folder, never the default outlines directory. An independently launched scratch outline host serves it. Parent owns `room.ts`, `bridge.ts`, `demo.ts`, verification and integration. Nothing automatically starts an agent or spends model tokens.

`room.ts` exports `Room` with `static async fromEnv(): Promise<Room>` and methods:
- `snapshot(): Promise<Snapshot>`
- `publish(input: {title:string, body:string, kind:'finding'|'option'|'question'|'evidence', session:string, evidence?:string}): Promise<Card>`
- `respond(input: {card:string, revision:number, verdict:'keep'|'question'|'park'|'reply', text?:string}): Promise<Feedback>`
- `inbox(session:string): Promise<Feedback[]>` (all responses to that session, immutable IDs; consumer owns delivered receipts)
- `draft(card:string): Promise<{path:string, revision:number}>` (creates only if absent, never overwrites; revision anchor persists beside the file across new panes)
- `sendDraft(card:string, revision:number): Promise<Feedback>` (reads saved text, never clears the file)

`Snapshot = {title:string, outline:string, room:string, cards:Card[], feedback:Feedback[], complete:boolean}`.
`Card = {id:string, revision:number, title:string, body:string, kind:string, session:string, evidence:string, author:string, updated:string}`.
`Feedback = {id:string, card:string, revision:number, verdict:string, text:string, session:string, author:string, updated:string}`.
Cards display literal source text, not a second Blockdown renderer. Header/title/property extraction uses outline-core or service fields. Source notes remain readable in ep0ch. Feedback is attributed `author:user` when originating in the Tern person's action; cards `author:agent` with originating omp session. Feedback names the exact observed revision; outdated feedback is preserved, never silently applied as an edit.

## Tern adapter

Files `tern/plugin.toml`, `tern/host.luau`, `tern/window.luau`, optional scoped CSS. Plugin id `return-room`, block id `room` => `return-room.room`.

Host calls `bun <plugin.dir>/../bridge.ts <operation> <JSON input>` using tern.process.run (argv, no shell). Config inherited via RETURN_ROOM_CONFIG. Operations `snapshot`, `respond`, `draft`, `send-draft`; stdout exactly JSON result on success, nonzero stderr on error. Pass input JSON as one argv. Optional block args[1] is config path: bridge accepts final env? Instead host passes `--config`, path BEFORE operation: `bun bridge.ts --config <path> snapshot {}`. If omitted env config is used.

Native room: keyed cards/list, detail, compare two pinned options, evidence path action, visible latest feedback and source revision. Key+mouse parity: j/k or arrows selection, c compare pin, 1 keep, 2 question, 3 park, e edit reply, s send saved reply, r refresh. Do NOT implement a weak text editor: `draft` returns a file path; `cx:open(path)` uses Tern's existing file editor (save before send). Sends are explicit; no terminal input injection. Persist selection/compare pins via block save. Poll every ~3s, single-flight, cancel by pane liveness. Errors visible without losing last good snapshot. No global theme takeover.

## omp adapter

Files `omp-extension.ts`, standalone package manifest as appropriate (do not add a workspace dependency). Tools `room_publish` (essential/write, creates card using ctx.sessionManager.getSessionId()), `room_inbox` (read feedback). Commands `/return-room` displays summary/path, `/room-pull` explicitly appends undelivered person feedback to context without triggering a turn. Session-scoped delivered IDs persisted with pi.appendEntry namespace `ep0ch.return-room.delivered`; restore on session_start/session_switch/session_branch/session_tree. No module-global session state, no polling that causes paid turns, no mutations when RETURN_ROOM_CONFIG absent. Context next prompt may explain room_publish if configured; no requirement to use it for every thought. `room_inbox` must not acknowledge feedback just because it read it. Use current omp documented API (omp://extensions.md and authoring guide). Missing config is actionable refusal for invoked tools, silent otherwise.
