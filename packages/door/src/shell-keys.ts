// The shell's actions (screen.back, video.cycle) for a screen whose module screens.ts imports (the desk, the
// showcase): screens.ts registers its `shellKey` here as it loads, so a q, Esc or V on those screens runs the
// shell's action at once, as the menu's and the lists' do, without importing screens.ts back (a module cycle
// would meet the menu half-built).
import type { Ctx, Screen } from "./app";

type ShellKey = (name: "screen.back" | "video.cycle", args: Record<string, never>, here: Screen, ctx: Ctx) => void;
let run: ShellKey | null = null;

/** screens.ts hands over its `shellKey` as it loads. */
export function registerShellKey(f: ShellKey) { run = f; }

/** A person's q, Esc or V: the shell's action, as `you`. Loaded on first use when screens.ts hasn't been. */
export function shellKeyOf(name: "screen.back" | "video.cycle", here: Screen, ctx: Ctx) {
  if (run) return run(name, {}, here, ctx);
  void import("./screens").then(m => m.shellKey(name, {}, here, ctx));
}

/**
 * Esc with nothing left to close (UI-GRAMMAR, "Esc"): it closes the innermost temporary thing, and never leaves a screen
 * or logs off, so here it does nothing and says what leaves (or a frame around the screen takes it: `Ctx.nothingToClose`).
 * `leave`: the screen's own way out (the menu's is G).
 */
export function nothingToClose(ctx: Pick<Ctx, "flash" | "nothingToClose">, leave = "q leaves") {
  if (ctx.nothingToClose) return ctx.nothingToClose(leave);
  ctx.flash(nothingLeft(leave));
}
/** What Esc says with nothing left to close. */
export const nothingLeft = (leave: string) => `nothing to close · ${leave}`;
