// A reader's rung of Esc (esc-rule.ts): the steps of READER_ESC, and the two asks that became modes (PIE-1617): a mode that
// takes no keys of its own and goes with what it's over, and the passage menu after `a`. Part of the NoteSurface, kept apart for its size.
import type { Key } from "../term";
import { ESC_KEY, READER_ESC, type EscSteps } from "../esc-rule";
import { collectionBinding, collectionKey } from "./list-mode";
import type { ModeName, ModeStack, ReaderMode } from "./modes";
import type { NoteSurface, SurfaceHost } from "./note";
import { readerBinding } from "./reader-keys";
import type { ReaderGuard } from "./reader-keys";

/** The surface as these read it. */
export interface ReaderEscSurface {
  modes: ModeStack<SurfaceHost>; selection: object | null; msg: unknown;
  runKey(name: string, args: Record<string, unknown>, host: SurfaceHost, quiet?: boolean): unknown; holds(g: ReaderGuard, host: SurfaceHost): boolean;
  passageChoices(): { key?: string; label: string; action: string }[]; passagePick(action: string, host: SurfaceHost): void;
}

/** What Esc closes here: the mode with the keys, an attachment the keys are parked from, then what's lit. */
export function readerEscSteps(s: ReaderEscSurface, host: SurfaceHost): EscSteps<(typeof READER_ESC)[number]> {
  return {
    mode: () => {
      const m = s.modes.top() ?? s.modes.all().find(x => x.name === "sources" || x.name === "comment" || x.name === "replies" || x.name === "panel");
      return m ? { closes: m.escCloses?.() ?? `the ${m.word}`, run: () => m.key(ESC_KEY, host) } : null;
    },
    selection: () => (s.selection && s.msg ? { closes: "the selection", run: () => void s.runKey("select.clear", {}, host) } : null),
    collection: () => (collectionBinding(s as unknown as NoteSurface, ESC_KEY) ? { closes: "the list", run: () => collectionKey(s as unknown as NoteSurface, ESC_KEY, host) } : null),
    lit: () => {
      const row = readerBinding(ESC_KEY, g => s.holds(g, host));
      return row ? { closes: row.closes ?? `the ${row.label}`, run: () => void s.runKey(row.action, row.args ?? {}, host, !!row.quiet) } : null;
    },
  };
}

/** A mode that holds no keys and draws nothing of its own: only what it's over, and how it ends, are its. */
export function quietMode(modes: ModeStack<SurfaceHost>, name: ModeName, word: string, over: object, hint: () => string): ReaderMode<SurfaceHost> {
  return {
    name, word, over, of: {}, holdsKeys: false, editing: () => false, covers: () => false,
    key: () => false, click: () => undefined, rows: () => null, leave: async () => { modes.drop(name); return { left: "nothing" }; },
    hint, state: () => null, describe: () => ({ [name]: true }),
  };
}

/** The passage toolbar after `a`: the next key runs its choice on the selection, or says what they are; it ends with that selection. */
export function passageMenuMode(s: ReaderEscSurface, sel: object): ReaderMode<SurfaceHost> {
  const says = () => `a then ${s.passageChoices().filter(x => x.key).map(x => `${x.key} ${x.label.toLowerCase()}`).join(" · ")}`;
  return {
    ...quietMode(s.modes, "passage-menu", "passage menu", sel, says),
    ended: () => s.selection !== sel,
    key: (k: Key, host) => {
      s.modes.drop("passage-menu");
      const pick = s.passageChoices().find(x => k.kind === "char" && !k.ctrl && x.key === k.ch);
      if (pick) s.passagePick(pick.action, host);
      else if (k.kind !== "esc") host.ctx.flash(says());
      host.redraw();
      return true;
    },
  };
}
