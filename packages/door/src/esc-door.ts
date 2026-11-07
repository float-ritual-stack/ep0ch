// The door's rung of Esc (esc-rule.ts): the steps of DOOR_ESC. The door's own layers, then the layer the keys are in; only the
// top screen's own answer decides between it and the drawer it's under: what's in front of the drawer, then the drawer, then
// its way home. Part of the App and the Drawer, kept apart for their size.
import type { Screen } from "./app";
import type { AgentDrawer as Drawer, DrawerRun } from "./drawer";
import type { Desk } from "./desk/desk";
import { rawKey } from "./kbd";
import { DOOR_ESC, ESC_KEY, escNext, escPress, type EscRung, type EscSteps } from "./esc-rule";
import { runningModules } from "./door-modules";
import { nothingToClose } from "./shell-keys";
import { keyName } from "./surface/actions";
import { layerEntry } from "./surface/keymap";
import { scriptBindings } from "./extensions";

/** The App as these steps read it. */
export interface DoorEscHost {
  stack: Screen[]; probing: boolean; armed(): unknown; strips: any; bar: any; overflow: unknown; drawer: Drawer; drawerRun: DrawerRun; dispatch: any;
  keyLayers(): { over?: string }; probeKeys(on: boolean): void; disarm(): void; redraw(): void; flash(m: string, ms?: number): void; now(): number;
}

/** A second Esc this soon after one closed something over a program is that one again (PIE-1431). */
export const ESC_SPENT_MS = 600;
/** The door's reader of the ladder: what the next Esc closes, the key's work, and the hold over a program (PIE-1431). */
export class DoorEsc {
  constructor(private readonly a: DoorEscHost) {}
  next(): string | null { return escNext(DOOR_ESC, doorEscSteps(this.a)); }
  press(): void { escPress(DOOR_ESC, doorEscSteps(this.a)); }
  /** The key's work, for a click on the hint: what it closed. */
  close(): string | null { const closes = this.next(); this.press(); this.a.redraw(); return closes; }
  private shown: string | null = null;
  /** The hint row's word for it. A strip's picker lists that row's own parts by their place and has its esc on its foot, so while one is open the row says what it said. */
  hint(): string | null { if (!this.a.strips.engaged) this.shown = this.next(); return this.shown; }
  /** When an Esc last closed something over a terminal the person types in, or was held back for it. */
  private spentAt = -Infinity;
  spend() { this.spentAt = this.a.now(); }
  /** An Esc right after one closed something over the program: held back, and said. A fixed window from the Esc that closed something: a held one doesn't extend it, so tapping Esc gets through soon. */
  held(): boolean {
    if (this.a.now() - this.spentAt >= ESC_SPENT_MS) return false;
    this.a.flash("nothing to close · pause, then esc is the program's", 2500);
    return true;
  }
  /** Raw bytes that are an Esc (legacy, or a Kitty report), held back as `held` says. */
  spent(bytes: string): boolean { return this.a.now() - this.spentAt < ESC_SPENT_MS && (/^\x1b+$/.test(bytes) || rawKey(bytes)?.kind === "esc") && this.held(); }
}

export function doorEscSteps(a: DoorEscHost): EscSteps<(typeof DOOR_ESC)[number]> {
  const top = a.stack.at(-1), desk = top && (top as Partial<Desk>).escFront ? top as Desk : null;
    const over = a.keyLayers().over, typed = keyName(ESC_KEY);
    const raw = !!top?.rawKeys?.(), held = !!top?.holdsKeys?.();
    return {
      probe: () => (a.probing ? { closes: "the key probe", run: () => { a.probeKeys(false); } } : null),
      armed: () => (a.armed() ? { closes: "the armed edit", run: () => { a.disarm(); a.redraw(); } } : null),
      strip: () => (a.strips.engaged ? { closes: "the strip", run: () => { a.strips.input(ESC_KEY, a.overflow, false); } } : null),
      bar: () => {
        const b = a.bar;
        return b ? { closes: b.escCloses(), run: () => { if (!b.ended()) b.key(ESC_KEY, a as never); if (a.bar?.ended()) { a.bar.close(); a.bar = null; a.redraw(); } } } : null;
      },
      menu: () => (over === "menu" && top ? { closes: desk?.escNextFront() ?? "the menu", run: () => { top.key(ESC_KEY, a as never); } } : null),
      module: () => ({ closes: null, maybe: true, run: () => runningModules().some(([, m]) => m.key?.(ESC_KEY)) }),
      lift: () => a.drawer.desks().map(d => d.liftedDesk).find(Boolean)?.liftEsc() ?? null,
      "in-drawer": () => drawerEscIn(a.drawer, a.drawerRun),
      // The person's keymap gave Esc an action, or a script's binding did: never while the screen is using the key.
      keymap: () => {
        const mine = typed ? layerEntry(typed) : undefined, binding = !raw && !held ? scriptBindings().find((b: { key: string }) => b.key === typed) : undefined;
        if (mine && !raw && !held && a.dispatch.has(mine.action)) return { closes: null, maybe: true, run: () => { void a.dispatch.press(mine.action, mine.args); } };
        return binding ? { closes: null, maybe: true, run: () => { const no = a.dispatch.bindingProblem(binding, scriptBindings()); if (no) a.flash(no); else void a.dispatch.pressBinding(binding); return !no; } } : null;
      },
      // A desk answers what's in front of the drawer; any other screen is asked when it's using the key.
      screen: () => (desk ? { closes: desk.escNextFront(), ...(desk.rawKeys() ? {} : { maybe: true as const }), run: () => desk.escFront() } : top && (raw || held || top.escNext?.(true)) ? { closes: top.escNext?.(true) ?? null, run: () => { top.key(ESC_KEY, a as never); } } : null),
      "drawer-up": () => (top?.noDrawer ? null : drawerEscUp(a.drawer, a.drawerRun)),
      home: () => (top ? { closes: desk ? desk.escNextHome() : top.escNext?.(false) ?? null, run: () => { if (desk) { if (!desk.escHome()) nothingToClose(a as never, desk.floatCloseWord() ?? undefined); } else top.key(ESC_KEY, a as never); } } : null),
    };
}

/** Esc with the person in the drawer (the `in-drawer` step): the desk there closes what it holds, then the keys step out, of the glass tile or of the drawer. A program that exited holds nothing back; one running has the key itself. */
function drawerEscIn(dr: Drawer, run: DrawerRun): EscRung | null {
  if (!dr.entered) return null;
  const d = dr.desk, strip = dr.folded && (dr as unknown as { liftIn: unknown }).liftIn === null && !dr.glassHasKeys();
  const word = dr.glassHasKeys() ? "the glass tile" : "the drawer's keys";
  const out = () => { run("host.leave", { quiet: true }); return true; };
  if (!d || strip || d.waitsOnExit()) return { closes: word, run: out };
  return { closes: d.programKeys().typing ? d.escNextFront() : d.escNextFront() ?? word, run: () => d.escFront() || out() };
}
/** Esc with the person out of the drawer and nothing in front of it (the `drawer-up` step): it goes away. */
function drawerEscUp(dr: Drawer, run: DrawerRun): EscRung | null {
  return dr.shown && !dr.entered ? { closes: "the drawer", run: () => { run("host.toggle", { open: false }); return true; } } : null;
}
