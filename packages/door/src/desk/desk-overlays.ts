// The desk's overlays, moved out of desk.ts whole: the layout picker (^W r), the screen saver (^W w), the screens to open,
// a dropped part's embed-or-copy, a kind's choices and the policy panel (^W P). Pickers on the desk's mode stack; each
// acts through the desk's own actions.
import type { WireVerb } from "./screen-layout";
import { centred, linePrompt, ListPicker, pickRows, pickRow } from "../surface/picker";
import { screenNames, screenSlug, screenTargetArg, screenTitleProblem } from "./screen-spec";
import { screenNotes } from "./screen-notes";
import type { TileSpec } from "./tiles";
import { C, fg, RESET, selected } from "../style";
import type { Container } from "./layout";

// ── the desk's overlays (the layout picker, the policy panel, the search): pickers on its mode stack ─────────

/**
 * What an overlay asks of the screen it opens on, and nothing else: its actions (`run`), the shell's press, the screen
 * saver's save, and ^W P's rows. The pickers act through these; none reaches into the desk.
 */
export interface OverlayHost {
  run(name: string, args?: Record<string, unknown>, reader?: string): void;
  readonly ctx: { press?(name: string, args?: Record<string, unknown>, tile?: string): Promise<unknown> };
  saveFromPrompt(typed: string): Promise<void>;
  policyNodes(tile: number): { label: string; node: Container | null }[];
  wireRows(tile: number): PanelRow[];
  policyRows(tile: number, node: Container | null): PanelRow[];
}
type DeskPicker = ListPicker<any, OverlayHost>;

/** A row of the policy panel (^W P): what it is, its value, what ⏎ or a click does, + and -; `wide` rows say it all in the label. */
export interface PanelRow { label: string; value: string; clear?: () => void; run?: () => void; adjust?: (by: number) => void; wide?: boolean; wire?: "follows" | WireVerb }


/** ^W r: the layouts to lay this screen out as: the built-ins, and the screens people made (screen notes). */
export function layoutPicker(items: { name: string; title: string; saved: boolean; builtin: boolean }[]): DeskPicker {
  return new ListPicker({
    name: "layouts", items: () => items,
    row: (it, _i, on, w) => [...pickRows(` ${it.title}${it.saved ? (it.builtin ? " · a screen you made, over the built-in" : " · a screen you made") : " · built-in"}`, on, w)],
    choose: (it, _i, d) => d.run("layout.load", { name: it.name }),
    frame: (a, n) => ({ rect: centred(a, Math.min(60, a.cols - 4), Math.min(a.rows - 4, n + 2)), title: "lay this screen out as" }),
  });
}

/** ^W w: the name to save this screen as (its own, typed over): a screen note in the outline. */
export function screenSaver(name: string): DeskPicker {
  return linePrompt<OverlayHost>({
    name: "layouts", title: "save this screen as", text: name, w: 100,
    doing: t => (screenNotes().some(n => n.name === screenSlug(t)) ? `save it over the screen ${t.trim()} (a note in the outline)` : `save it as ${t.trim()}, a screen note in the outline`),
    // The reason shows as it's typed, and ⏎ on a name that can't be saved leaves the prompt open with what was typed.
    hint: t => { const why = screenTitleProblem(t); return why ? { text: why, warn: true } : { text: `saves as ${screenSlug(t)}`, ...{} }; },
    done: (t, d) => void d.saveFromPrompt(t),
  });
}

/**
 * The screens to open: the ones people made, then the built-ins that open on nothing in particular. ⏎ or a double click
 * is screen.open; x on one a person made is screen.delete (twice: it asks first).
 */
export function screensToOpen(): { name: string; title: string; made: boolean }[] {
  const made = screenNotes().map(n => ({ name: n.name, title: n.title, made: true }));
  return [...made, ...screenNames().filter(n => !made.some(m => m.name === n) && !screenTargetArg(n) && n !== "home").map(name => ({ name, title: name, made: false }))];
}
export function screenPicker(): DeskPicker {
  const items = screensToOpen;
  const p: DeskPicker = new ListPicker<{ name: string; title: string; made: boolean }, OverlayHost>({
    name: "screens", items,
    row: (it, _i, on, w) => [...pickRows(` ${it.title} · ${it.made ? "a screen you made" : "built-in"}`, on, w)],
    // screen.open is the App's (the shell's), as the menu's letters run it.
    choose: (it, _i, d) => void d.ctx.press?.("screen.open", { name: it.name }),
    bindings: [{ key: "x", action: "screen.delete", label: "delete made screen" }],
    dispatch: (_, d) => { const it = items()[p.sel]; if (it?.made) d.run("screen.delete", { name: it.name }); },
    frame: (a, n) => ({ rect: centred(a, Math.min(60, a.cols - 4), Math.min(a.rows - 4, n + 2)), title: "open a screen" }),
  });
  return p;
}

/** A part dropped on a note (PIE-1247): embed it there (a reference, live), or copy its own lines (a figure with its query). */
export function dropAsPicker(title: string, then: (as: "reference" | "copy") => void): DeskPicker {
  const items = [
    { as: "reference" as const, label: "embed it: a reference that stays live (its anchor written if it has none)" },
    { as: "copy" as const, label: "copy it: its own lines, a figure with its query, answering for this note" },
  ];
  return new ListPicker({
    name: "drop-as", items: () => items,
    row: (it, _i, on, w) => [...pickRows(` ${it.label}`, on, w)],
    choose: it => then(it.as),
    frame: (a, n) => ({ rect: centred(a, Math.min(84, a.cols - 4), Math.min(a.rows - 4, n + 2)), title: `into ${title}` }),
  });
}

/** A kind's choices for a new tile (a query tile's view): one picked runs `then`. */
export function choicePicker(title: string, items: { label: string; spec: Partial<TileSpec> }[], then: (it: { label: string; spec: Partial<TileSpec> }) => void): DeskPicker {
  return new ListPicker({
    name: "choices", items: () => items,
    row: (it, _i, on, w) => [...pickRows(` ${it.label}`, on, w)],
    choose: it => then(it),
    frame: (a, n) => ({ rect: centred(a, Math.min(60, a.cols - 4), Math.min(a.rows - 4, Math.max(n, 1) + 2)), title }),
  });
}

/**
 * ^W P: the containers over a tile (the screen first, then each one down to it) and one's policy, a row per field.
 * ⏎, space or a click changes a row through the same action an agent calls; h l (or a click on a name) pick the
 * container; + - change a size; esc, q or a click outside closes it.
 */
export function policyPanel(d: OverlayHost, tile: number): DeskPicker {
  let wireWidth = 0;
  let node = Number.MAX_SAFE_INTEGER, crumbs: { from: number; to: number; y: number; i: number }[] = [];
  const nodes = () => { const ns = d.policyNodes(tile); node = Math.min(node, ns.length - 1); return ns; };
  const rows = () => [...d.wireRows(tile), ...d.policyRows(tile, nodes()[node]!.node)];
  const first = () => d.wireRows(tile).length;
  const p: DeskPicker = new ListPicker<PanelRow, OverlayHost>({
    name: "policy", items: rows, closers: "q", stays: true,
    closed: () => { d.run("tile.link", { ask: false }); },
    row: (r, _i, on, w) => {
      wireWidth = w;
      const text = ` ${r.label}${!r.clear && !r.wide ? ` ${r.value}` : ""}`;
      return pickRows(text, on, r.clear ? w - 4 : w, r.clear || r.wire ? C.white : C.grey).map(line => line + (r.clear ? pickRow(" × ", on, 4) : ""));
    },
    clickedItem: (r, x) => { if (!r.clear || x < wireWidth - 4) return false; r.clear(); return true; },
    choose: r => r.run?.(),
    bindings: [
      ...["left", "h", "right", "l"].map(key => ({ key, action: "policy.container", label: "container", args: { by: ["left", "h"].includes(key) ? -1 : 1 } })),
      { key: "space", action: "policy.change", label: "change" },
      { key: "x", action: "policy.clear", label: "clear wire" },
      ...["+", "-"].map(key => ({ key, action: "policy.size", label: "size", args: { by: key === "+" ? 1 : -1 } })),
    ],
    dispatch: binding => {
      switch (binding.action) {
        case "policy.container": node = Math.max(0, Math.min(nodes().length - 1, node + (binding.args!.by as number))); p.sel = first(); break;
        case "policy.change": rows()[p.sel]?.run?.(); break;
        case "policy.clear": rows()[p.sel]?.clear?.(); break;
        case "policy.size": rows()[p.sel]?.adjust?.(binding.args!.by as number); break;
      }
    },
    clicked: (x, y) => { const n = crumbs.find(h => h.y === y && x >= h.from && x < h.to); if (n) { node = n.i; p.sel = first(); } return !!n; },
    frame: (a, n) => {
      const rect = centred(a, Math.min(96, a.cols - 4), Math.min(a.rows - 4, n + 4));
      let x = rect.col + 2, line = " ";
      crumbs = [];
      nodes().forEach((c, i) => {
        if (i) { line += fg(C.dark) + " › " + RESET; x += 3; }
        crumbs.push({ from: x, to: x + c.label.length, y: rect.row + 1, i });
        line += (i === node ? selected() : fg(C.grey)) + c.label + RESET; x += c.label.length;
      });
      return { rect, title: "policy", head: [line, ""] };
    },
  });
  return p;
}
