// What a session's next daemon restores (PIE-418): after a handoff (`ep0ch session upgrade`) or a daemon that died,
// the person lands where they were. Most of it was never only in the daemon's memory: each screen saves its layout as
// it changes (desk.json and the rest), drafts are put aside as unsent on the way out, and the programs live in the
// terminal host (src/session/pty-host.ts). What's left is which screens were open, and which edits:
//
// - **The checkpoint** (`session-state.json`), written whenever the screens change and again at a handoff: the screens
//   open as the actions that open them (`screen.open`, and `screen.back` after one kept in the background), the edits
//   open on the screen on top and in the dock (`Screen.reopen`: its note, then `edit` in its tile), the size the session was drawn at.
// - **A restore runs those actions through the App's dispatcher, as the actions declare** (`ActionDef.replay`): a step
//   whose action is `replay: "safe"` runs again; one that isn't is never run by itself, and the restore says which.
//   The edits are the one exception, and only the person's own: opening an edit writes nothing, and its text is what
//   the handoff put aside for it.
//
// There is no journal of every action to replay: each screen already saves its layout as each action changes it, so a
// replay of layout actions would only apply them twice.
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { App, Screen } from "../app";
import { MainMenu } from "../screens";
import { USER } from "../socket";
import { outlineState } from "../state";

/** One step of a restore: an action as the App's dispatcher takes it. */
export interface Step { action: string; args?: Record<string, unknown>; tile?: string; screen?: string; dock?: boolean }
export interface Checkpoint {
  v: 2; at: number; size?: { cols: number; rows: number };
  /** Somebody had logged on (the main menu at the bottom); else the next daemon starts at the logon. */
  menu: boolean;
  screens: Step[];
  reopen: Step[];
}

/** The checkpoint of the session in the outline folder `dir` (the daemon's own: outlineState()). */
const checkpointPath = (dir = outlineState()) => join(dir, "session-state.json");

/** Nothing to restore next time: the session ended for good. */
export function forgetSession(dir = outlineState()): void { rmSync(checkpointPath(dir), { force: true }); }

/** The checkpoint a session left, if one did (a handoff, or a daemon that died). */
export function readCheckpoint(dir = outlineState()): Checkpoint | null {
  try { const c = JSON.parse(readFileSync(checkpointPath(dir), "utf8")) as Checkpoint; return c?.v === 2 ? c : null; } catch { return null; }
}

/** The screens open as the steps that open them again: a named screen (a spec's, the showcase), the background's kept so. */
export function screenSteps(stack: readonly Screen[], background: readonly Screen[]): Step[] {
  if (!(stack[0] instanceof MainMenu)) return [];
  const open = (s: Screen): Step | null => (s.name ? { action: "screen.open", args: { name: s.name, ...(s.openArgs?.() ?? {}) } } : null);
  return [
    ...background.flatMap(s => { const o = open(s); return o ? [o, { action: "screen.back" }] : []; }),
    ...stack.slice(1).flatMap(s => { const o = open(s); return o ? [o] : []; }),
  ];
}

/** A session's checkpoint, kept as it runs: written whenever the screens change. */
export class Checkpoints {
  private soon: Timer | null = null;
  constructor(private readonly app: App, private readonly size: () => { cols: number; rows: number }) {}

  start(): void {
    this.write();
    this.app.onStack = () => { if (!this.soon) this.soon = setTimeout(() => { this.soon = null; this.write(); }, 50); };
  }

  /** Write the checkpoint now (`reopen`: with the edits open on top, at a handoff, before their text is put aside). */
  write(reopen = false): void {
    const stack = this.app.screens(), top = stack.at(-1);
    const c: Checkpoint = {
      v: 2, at: Date.now(), size: this.size(), menu: stack[0] instanceof MainMenu,
      screens: screenSteps(stack, this.app.background),
      // The screen on top's edits, and the dock's (on every screen: its tiles come back from dock-tiles.json, by name).
      reopen: reopen ? [
        ...(top ? (top.reopen?.() ?? []).map(r => ({ ...r, screen: top.title })) : []),
        ...(this.app.dock.made?.reopen() ?? []).map(r => ({ ...r, dock: true })),
      ] : [],
    };
    try { writeFileSync(checkpointPath(), JSON.stringify(c), { mode: 0o600 }); } catch { /* not fatal: the screens save their own layouts */ }
  }

  /** The daemon is going (a handoff): the checkpoint stays as written. */
  stop(): void { this.app.onStack = null; if (this.soon) { clearTimeout(this.soon); this.soon = null; } }
  /** The session ended: nothing is restored next time. */
  clear(): void { this.stop(); forgetSession(); }
}

export interface Restored { screens: number; held: string[]; reopened: number; errors: string[] }

/** What the App's dispatcher says an action declares about a replay, here and now (the top screen's actions included). */
const replayOf = (app: App, action: string) => app.dispatch.list().actions.find(a => a.name === action)?.replay;

/**
 * Open the screens a checkpoint names again (`replay: "safe"` steps only), and the edits that were open: the main menu
 * at the bottom, the rest through the App's dispatcher as the person. A step refused now (a screen gone) is said.
 */
export async function restore(app: App, c: Checkpoint): Promise<Restored> {
  const out: Restored = { screens: 0, held: [], reopened: 0, errors: [] };
  // Nobody had logged on: the logon, as a new door starts (openDoor pushes it).
  if (!c.menu) return out;
  app.push(new MainMenu());
  for (const s of c.screens) {
    const replay = replayOf(app, s.action);
    if (replay !== "safe") { out.held.push(s.action); continue; }
    try {
      await app.dispatch.act({ action: s.action, args: s.args ?? {}, ...(s.tile !== undefined ? { tile: s.tile } : {}) }, USER);
      if (s.action === "screen.open") { out.screens++; app.flush(); }   // drawn now: its tiles adopt their programs
    } catch (e) { out.errors.push(`${s.action}: ${(e as Error).message}`); }
  }
  for (const s of c.reopen) {
    // A docked reader's edit: the dock's desk (made now, its tiles back from dock-tiles.json) answers it by the tile's name.
    if (s.dock && !app.dock.desk) { out.errors.push(`${s.action} in ${s.tile}: the dock isn't ready`); continue; }
    if (!s.dock && s.screen && app.screens().at(-1)?.title !== s.screen) { out.errors.push(`${s.action} in ${s.tile}: the ${s.screen} isn't open`); continue; }
    // The reader reads its note again as the screen opens: the edit waits for it (a few seconds at most).
    for (let tries = 0; ; tries++) {
      try {
        const via = s.dock ? app.dock.desk!.dispatch : app.dispatch;
        await via.act({ action: s.action, args: s.args ?? {}, ...(s.tile !== undefined ? { tile: s.tile } : {}) }, USER);
        if (s.action === "edit") out.reopened++;
        break;
      } catch (e) {
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
  return [
    how === "upgrade" ? "the session was handed over to a new daemon" : "the session came back after its daemon stopped",
    r.screens ? `${r.screens} screen${r.screens === 1 ? "" : "s"} reopened` : "",
    adopted ? `${adopted} program${adopted === 1 ? "" : "s"} kept running` : "",
    r.reopened ? `${r.reopened} edit${r.reopened === 1 ? "" : "s"} back (e or ⏎ in it carries on)` : "",
    r.held.length ? `not run again (not replay-safe): ${[...new Set(r.held)].join(", ")}` : "",
  ].filter(Boolean).join(" · ");
}
