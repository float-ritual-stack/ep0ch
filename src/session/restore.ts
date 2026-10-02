// What a session's next daemon restores (PIE-418): after a handoff (`ep0ch session upgrade`) or a daemon that died,
// the person lands where they were. Most of it was never only in memory: each screen saves its layout as it changes
// (desk.json and the rest), drafts are put aside as unsent on the way out, and the programs live in the terminal host
// (src/session/pty-host.ts). What's left is which screens were open, and what happened since. That's a checkpoint and
// a journal, as Pi Durable keeps them:
//
// - **The checkpoint** (`session-state.json`), written whenever the screens change and at a handoff: the screens open
//   as the actions that open them (`screen.open`, `screen.back` for one kept in the background), the edits open (`edit`
//   in their tile), and the size the session was drawn at.
// - **The journal** (`session-journal.jsonl`): every action that ran since, with its declarations. A restore runs the
//   checkpoint's steps, then the journal's `replay: "safe"` ones in order, as whoever ran them; a layout action carries
//   the revision it ran on as `expected=`, so one the saved layout already has is refused by the revision check instead
//   of applied twice. Actions declared `replay: "ask"` (they write to the outline, or start something) are never run
//   again by themselves: the restore says which they were.
import { appendFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { App, Screen } from "../app";
import { MainMenu } from "../screens";
import { USER, type Actor } from "../socket";
import { stateDir } from "../state";
import { onRan, type Ran } from "../surface/dispatch";

/** One step of a restore: an action as the App's dispatcher takes it, as whoever ran it. */
export interface Step { action: string; args?: Record<string, unknown>; tile?: string; actor?: Actor; replay?: "safe" | "ask"; screen?: string }
export interface Checkpoint { v: 1; at: number; size?: { cols: number; rows: number }; screens: Step[]; reopen: Step[] }

const checkpointPath = () => join(stateDir(), "session-state.json");
const journalPath = () => join(stateDir(), "session-journal.jsonl");
/** The journal never grows past this many entries: the next checkpoint starts it over. */
const JOURNAL_MAX = 2000;

/** Nothing to restore next time: the session ended for good. */
export function forgetSession(): void { rmSync(checkpointPath(), { force: true }); rmSync(journalPath(), { force: true }); }

/** The checkpoint a session left, if one did (a handoff, or a daemon that died). */
export function readCheckpoint(): Checkpoint | null {
  try { const c = JSON.parse(readFileSync(checkpointPath(), "utf8")) as Checkpoint; return c?.v === 1 ? c : null; } catch { return null; }
}

/** The journal since the checkpoint. */
export function readJournal(): Step[] {
  try { return readFileSync(journalPath(), "utf8").split("\n").filter(Boolean).flatMap(l => { try { return [JSON.parse(l) as Step]; } catch { return []; } }); } catch { return []; }
}

/** The screens open as the steps that open them again: a named screen (a spec's, the showcase), the background's kept so. */
export function screenSteps(stack: readonly Screen[], background: readonly Screen[]): Step[] {
  // Nobody logged on yet (the logon is the bottom): there is nothing to open again; the next daemon starts at the logon.
  if (!(stack[0] instanceof MainMenu)) return [];
  const open = (s: Screen): Step | null => (s.name ? { action: "screen.open", args: { name: s.name } } : null);
  return [
    ...background.flatMap(s => { const o = open(s); return o ? [o, { action: "screen.back" }] : []; }),
    ...stack.slice(1).flatMap(s => { const o = open(s); return o ? [o] : []; }),
  ];
}

/**
 * A session's journal and checkpoint, kept as it runs: every action that ran is appended; the checkpoint is written
 * whenever the screens change (and the journal started over).
 */
export class Journal {
  private stop: (() => void) | null = null;
  private entries = 0;
  private soon: Timer | null = null;
  constructor(private readonly app: App, private readonly size: () => { cols: number; rows: number }) {}

  start(): void {
    this.checkpoint();
    this.stop = onRan(r => this.record(r));
    this.app.onStack = () => { if (!this.soon) this.soon = setTimeout(() => { this.soon = null; this.checkpoint(); }, 50); };
  }

  /** Write the checkpoint now (`reopen`: with the edits open, at a handoff, after their text was put aside). */
  checkpoint(reopen = false): void {
    const top = this.app.screens().at(-1);
    const c: Checkpoint = {
      v: 1, at: Date.now(), size: this.size(),
      screens: screenSteps(this.app.screens(), this.app.background),
      reopen: reopen ? (top?.reopen?.() ?? []).map(r => ({ ...r, screen: top!.title })) : [],
    };
    try {
      writeFileSync(checkpointPath(), JSON.stringify(c), { mode: 0o600 });
      writeFileSync(journalPath(), "", { mode: 0o600 });
      this.entries = 0;
    } catch { /* not fatal: the screens save their own layouts */ }
  }

  private record(r: Ran): void {
    // What changes nothing of the person's view (a read, a list) needn't be run again; what writes is listed.
    if (r.replay === "safe" && r.touches === "nothing") return;
    const args = { ...r.args };
    if (r.rev !== undefined && r.touches === "shape" && !("expected" in args)) args.expected = r.rev;
    const step: Step = { action: r.action, args, ...(r.tile !== undefined ? { tile: r.tile } : {}), actor: r.actor, replay: r.replay, screen: r.screen };
    try { appendFileSync(journalPath(), JSON.stringify(step) + "\n", { mode: 0o600 }); } catch { return; }
    if (++this.entries > JOURNAL_MAX) this.checkpoint();
  }

  /** The session ended: nothing is restored next time. */
  clear(): void {
    this.stop?.(); this.stop = null;
    this.app.onStack = null;
    forgetSession();
  }

  /** The daemon is going (a handoff): the checkpoint stays, the journal stops. */
  detach(): void { this.stop?.(); this.stop = null; this.app.onStack = null; if (this.soon) { clearTimeout(this.soon); this.soon = null; } }
}

export interface Restored { screens: number; replayed: number; refused: number; held: string[]; reopened: number; errors: string[] }

/**
 * Open the screens a checkpoint names again, replay the journal's safe actions after it, and open the edits that were
 * open: the main menu at the bottom, the rest through the App's dispatcher as whoever ran them. A step that's refused
 * now (a screen gone, a layout action the saved layout already has) is counted, never retried.
 */
export async function restore(app: App, c: Checkpoint, journal: Step[]): Promise<Restored> {
  app.push(new MainMenu());
  const out: Restored = { screens: 0, replayed: 0, refused: 0, held: [], reopened: 0, errors: [] };
  const run = async (s: Step) => {
    await app.dispatch.act({ action: s.action, args: s.args ?? {}, ...(s.tile !== undefined ? { reader: s.tile } : {}) }, s.actor ?? USER);
  };
  for (const s of c.screens) {
    try { await run(s); if (s.action === "screen.open") out.screens++; } catch (e) { out.refused++; out.errors.push(`${s.action}: ${(e as Error).message}`); }
  }
  for (const s of journal) {
    if (s.replay !== "safe") { out.held.push(s.action); continue; }
    // Run on the screen it ran on: one that's gone (left, or not restored) takes none of its actions.
    if (s.screen && app.screens().at(-1)?.title !== s.screen && !s.action.startsWith("screen.")) { out.refused++; continue; }
    try { await run(s); out.replayed++; } catch { out.refused++; }
  }
  for (const s of c.reopen) {
    if (s.screen && app.screens().at(-1)?.title !== s.screen) { out.errors.push(`${s.action} in ${s.tile}: the ${s.screen} isn't open`); continue; }
    // The reader reads its note again as the screen opens: the edit waits for it (a few seconds at most).
    for (let tries = 0; ; tries++) {
      try { await run({ ...s, actor: USER }); if (s.action === "edit") out.reopened++; break; }
      catch (e) {
        const why = (e as Error).message;
        if (tries < 50 && /shows no note|still reading/i.test(why)) { await Bun.sleep(100); continue; }
        out.errors.push(`${s.action} in ${s.tile}: ${why}`);   // the note moved on: its text stays put aside
        break;
      }
    }
  }
  return out;
}

/** What a restore says on the status bar. */
export function restoredSaying(r: Restored, how: "upgrade" | "crash", adopted: number): string {
  const parts = [
    how === "upgrade" ? "the session was handed over to a new daemon" : "the session came back after its daemon stopped",
    r.screens ? `${r.screens} screen${r.screens === 1 ? "" : "s"} reopened` : "",
    adopted ? `${adopted} program${adopted === 1 ? "" : "s"} kept running` : "",
    r.reopened ? `${r.reopened} edit${r.reopened === 1 ? "" : "s"} back (e or ⏎ in it carries on)` : "",
    r.replayed ? `${r.replayed} view step${r.replayed === 1 ? "" : "s"} replayed` : "",
    r.held.length ? `not re-run (they write): ${[...new Set(r.held)].slice(0, 4).join(", ")}${new Set(r.held).size > 4 ? "…" : ""}` : "",
  ];
  return parts.filter(Boolean).join(" · ");
}
