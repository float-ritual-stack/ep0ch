# Records

Run builders with `scripts/builder <ticket> [--model <model>] -- <brief file>` from the worktree. It writes a start before Codex runs, and a separate end with its exit code, duration and PR. The wrapper prints its pid and the Codex process group; `kill -TERM <wrapper-pid>` stops its group and records the end. Codex runs under `setsid`, niced to 15. The brief can say `Report: /absolute/path/report.md` (the existing `/tmp/...report.md` convention also works); a report file must have been written during this run. Otherwise the last Codex message is the report. The wrapper uses the environment persona, defaulting to `builder-<ticket>`; a direct `ep0ch record` with no persona is attributed to the person. The wrapper preserves Codex's exit code when the end cannot be saved, and prints the command to write it later on stderr; run it from the same worktree with the same outline environment. The end keeps that report and posts it as an agent-authored child of the ticket. Output files remain in the private directory printed on exit; clean them with `scripts/scratch-clean <directory>` after review.

The wrapper supplies a command-local `ep0ch mcp` stdio server with the same writer identity and forwards the existing outline environment. It follows the worktree's normal outline selection and changes no global Codex settings. The configuration fields follow [Codex's stdio server contract](https://learn.chatgpt.com/docs/extend/mcp?surface=cli); `-c` applies them to this process.

`ep0ch record` appends machinery notes beneath the outline's Records page. It uses the ordinary outline selection (`--ws`, `EP0CH_WS`, `.ep0ch`), never a hard-coded outline. `ep0ch record --help` lists each kind's fields. It prints JSON with the new note's `id` and any template warnings. Examples (fictional ids):

```sh
ep0ch record run-start --ticket GARDEN-123 --harness codex --branch gate --worktree /tmp/gate --pid 1234 --host garden-box --summary 'Repair the gate'
ep0ch record run-end --run <start-id> --exit 0 --duration 120 --pr https://example.test/pull/4 --report-file /tmp/gate/report.md
ep0ch record finding --ticket GARDEN-123 --source person --failure 'Gate sticks after rain' --likelihood 'Daily in autumn' --cost 'A minute each morning'
ep0ch record finding-closed --finding <finding-id> --fixed <commit>
ep0ch record finding-closed --finding <finding-id> --dismissed 'This gate has no latch'
```

A record never changes to match a later fact: run ends name starts, finding closures name findings, and install outcomes/late receipts name earlier deploy records with `previous`. Append a correction rather than editing a record. This is a writer convention, not a restriction on the person's ordinary editor. Missing fields stay `unknown`; free text is kept as written.

The first record write creates the five `[type::template] [template-for::<kind>]` notes under Records. The CLI calls `template.stamp` on that note. Other agents can stamp the same template with `of=type:run-start` and `props`, or create a note with `[type::run-start] [machine::record]` containing `::use{of=type:run-start ticket=GARDEN-123 summary="Repair the gate"}` through `outline_create`. With no `parent`, a stamp lands beside its template, under Records; an explicit `parent` overrides that destination. Stamp for a fixed record; `::use` is a live rendering. Find a template with `ep0ch find --query "template-for=run-start machine=record"`; notes and their fields remain ordinary Blockdown.

Install writes into the outline named by the usual selector, including a folder's outline on another machine; when no outline is named, it uses the local host's default outline. Deployment facts come from the machine being installed, separately from the receiver of the record. Each machine's installer writes its local deploy facts, including host versions and the sessions' reported code. Outcomes and late machine-link receipts append records. A host stopped during a failed migration cannot accept the later failure record: install says so, and the last saved record remains as evidence of the unfinished operation.

For the one-off cold start, on each machine run from its installed checkout, naming the outline to receive the observation:

```sh
ep0ch record deploy --observed --ws <outline>
```

This reads git HEAD, `ep0ch session list`'s shared session reader and the host's PROTOCOL/GRAMMAR before writing. Use it locally on that machine; `--machine` selects the receiving outline, not the machine to observe. This slice supplies the seed command; running it on real outlines belongs to the deployer. No timer, hooks or derived mission-control surface ships here. Records are machinery, so no kitchen-sink Records section is needed.
