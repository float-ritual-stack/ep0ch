// What a session's next daemon restores (PIE-418): after a handoff (`ep0ch session upgrade`) or a daemon that died,
// the person lands where they were. Most of it was never only in the daemon's memory: each screen saves its layout as
// it changes (desk.json and the rest), drafts are put aside as unsent on the way out, and the programs live in the
// terminal host (src/session/pty-host.ts). What's left is which screens were open, and which edits:
//
// - **The checkpoint** (`session-state.json`), written whenever the screens change and again at a handoff: the screens
//   open as the actions that open them (`screen.open`, and `screen.back` after one kept in the background), the edits
//   open on the screen on top and in the drawer (`Screen.reopen`: its note, then `edit` in its tile, or the comment being
//   written: the action that opened it, then `comment.place`, `comment.move` and `draft.preview`, so it
//   sits where it sat, PIE-847; the draft session keeps its cursor, view and history), the look's nudges not yet saved (the tune inspector's, as `look.nudge` steps, PIE-847), the size the session was drawn at.
// - **A restore runs those actions through the App's dispatcher, as the actions declare** (`ActionDef.replay`): a step
//   whose action is `replay: "safe"` runs again; one that isn't is never run by itself, and the restore says which.
//   The edits and comments are the one exception, and only the person's own: opening one writes nothing, and its text
//   is what the handoff put aside for it. A step that fails takes its tile's later steps with it (they were its).
//
// There is no journal of every action to replay: each screen already saves its layout as each action changes it, so a
// replay of layout actions would only apply them twice.
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { App, Screen } from "../app";
import { tuningOf } from "../look";
import { MainMenu } from "../screens";
import { USER, type Actor } from "../socket";
import { outlineState, writeState } from "../state";

/**
 * One step of a restore: an action as the App's dispatcher takes it. `opens`: the step that opens an edit or a comment
 * (what the status line counts), with `words` when text was typed in it (its answer says whether that came back); `as`: who it runs as, when not the person (a look nudge an agent made).
 */
export interface Step { action: string; args?: Record<string, unknown>; tile?: string; screen?: string; drawer?: boolean; opens?: "edit" | "comment"; words?: boolean; as?: Actor }
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
      // The screen on top's edits, and the drawer's (on every screen: its tiles come back from drawer-tiles.json, by name).
      reopen: reopen ? [
        ...(top ? (top.reopen?.() ?? []).map(r => ({ ...r, screen: top.title })) : []),
        ...(this.app.drawer.made?.reopen() ?? []).map(r => ({ ...r, drawer: true })),
        // The tune inspector's nudges not yet saved, each as whoever made it.
        ...[...tuningOf(this.app.board).layers].flatMap(([target, f]) => [...f].filter(([, t]) => !t.saved).map(([field, t]): Step => ({ action: "look.nudge", args: { target, field, value: t.value, ...(t.from ? { from: t.from } : {}) }, ...(t.by.kind === "user" ? {} : { as: t.by }) }))),
      ] : [],
    };
    // Whole or not at all (state.ts writeState: a temp file renamed over it): a daemon killed mid-write, or a reader
    // between two writes, never finds half a checkpoint. Not fatal when it fails: the screens save their own layouts.
    writeState("session-state.json", c, outlineState());
  }

  /** The daemon is going (a handoff): the checkpoint stays as written. */
  stop(): void { this.app.onStack = null; if (this.soon) { clearTimeout(this.soon); this.soon = null; } }
  /** The session ended: nothing is restored next time. */
  clear(): void { this.stop(); forgetSession(); }
}

export interface Restored {
  screens: number; held: string[]; reopened: number;
  /** Comments back as they were; `partly`: back with their words, but a step after (their place, size, cursor) refused. */
  comments?: number; partly?: number;
  /** Comments opened again whose words didn't come back (they stay put aside: the reader's ■ unsent line). */
  empty?: number; tuned?: number; errors: string[];
}



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
  await reopen(c.reopen, s => (s.drawer ? app.drawer.desk?.dispatch ?? "the drawer isn't ready"
    : s.screen && app.screens().at(-1)?.title !== s.screen ? `the ${s.screen} isn't open` : app.dispatch), out);
  return out;
}

/**
 * Open the edits and comments `steps` name again (Screen.reopen's), each through the dispatcher `via` gives its step (a
 * string: why there's none), as the person. A reader reads its note again as its screen opens: a step waits for it (a
 * few seconds at most). A step that fails takes its tile's later steps with it: they were its (a comment's place).
 */
export async function reopen(steps: readonly Step[], via: (s: Step) => Pick<App["dispatch"], "act"> | string, out: Pick<Restored, "reopened" | "comments" | "partly" | "empty" | "tuned" | "errors">): Promise<void> {
  const failed = new Set<string>(), opened = new Set<string>();
  for (const s of steps) {
    // Steps in a tile go together; one without a tile (a look nudge) stands alone.
    const where = s.tile === undefined ? null : `${s.drawer ? "drawer" : s.screen}:${s.tile}`;
    // The keys given back to a tile (desk.reopen's last step) are never a step of what's in it.
    if (where && failed.has(where) && s.action !== "tile.focus") continue;
    const d = via(s);
    if (typeof d === "string") { out.errors.push(`${s.action} in ${s.tile}: ${d}`); if (where) failed.add(where); continue; }
    for (let tries = 0; ; tries++) {
      try {
        const r = await d.act({ action: s.action, args: s.args ?? {}, ...(s.tile !== undefined ? { tile: s.tile } : {}) }, s.as ?? USER) as { restored?: boolean } | undefined;
        if (s.action === "look.nudge") out.tuned = (out.tuned ?? 0) + 1;
        if (s.opens === "edit") out.reopened++;
        if (s.opens === "comment") {
          // Opened, but what the handover put aside for it didn't come back: not "as you left it".
          if (s.words && r?.restored === false) { out.errors.push(`${s.action} in ${s.tile}: its words weren't brought back`); out.empty = (out.empty ?? 0) + 1; }
          else { out.comments = (out.comments ?? 0) + 1; if (where) opened.add(where); }
        }
        break;
      } catch (e) {
        const why = (e as Error).message;
        if (tries < 50 && /shows no note|no note here|still reading/i.test(why)) { await Bun.sleep(100); continue; }
        out.errors.push(`${s.action} in ${s.tile}: ${why}`);   // the note moved on: its text stays put aside
        if (s.action === "tile.focus" || !where) break;
        failed.add(where);
        // Its comment opened, but isn't where it sat: said so, not "as you left it".
        if (opened.delete(where)) { out.comments = (out.comments ?? 1) - 1; out.partly = (out.partly ?? 0) + 1; }
        break;
      }
    }
  }
}

/** What a restore says on the status bar. */
export function restoredSaying(r: Restored, how: "upgrade" | "crash", adopted: number): string {
  return [
    how === "upgrade" ? "the session was handed over to a new daemon" : "the session came back after its daemon stopped",
    // First after what happened: the person was typing it.
    r.comments ? `your comment${r.comments === 1 ? " is" : "s are"} as you left ${r.comments === 1 ? "it" : "them"} (ctrl+s sends)` : "",
    r.partly ? `your comment${r.partly === 1 ? " is" : "s are"} back with ${r.partly === 1 ? "its" : "their"} words, not where ${r.partly === 1 ? "it" : "they"} sat (ctrl+o, ctrl+g move ${r.partly === 1 ? "it" : "them"})` : "",
    r.empty ? `${r.empty === 1 ? "a comment" : `${r.empty} comments`} opened without ${r.empty === 1 ? "its" : "their"} words: they're kept, the reader's ■ unsent line has them` : "",
    r.screens ? `${r.screens} screen${r.screens === 1 ? "" : "s"} reopened` : "",
    adopted ? `${adopted} program${adopted === 1 ? "" : "s"} kept running` : "",
    r.reopened ? `${r.reopened} edit${r.reopened === 1 ? "" : "s"} back (e or ⏎ in it carries on)` : "",
    r.tuned ? `${r.tuned} look nudge${r.tuned === 1 ? "" : "s"} back, not saved yet` : "",
    r.held.length ? `not run again (not replay-safe): ${[...new Set(r.held)].join(", ")}` : "",
  ].filter(Boolean).join(" · ");
}
