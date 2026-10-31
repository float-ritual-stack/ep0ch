import { ActionRefused, actionSet, def } from "./actions";
import { USER } from "../socket";
import type { Completer } from "./completer";

export const COMPLETION_PREVIEW = {
    summary: "scroll the docs panel beside the completion list (the lit row's docs, a reference's reader, a component's demo), or select text from a component demo; an agent reads that text without changing the person's selection",
    keys: "shift+up, shift+down, PgUp/PgDn, wheel over the docs",
    touches: "tile", replay: "safe",
    touchesWith: ({ text }: { text?: string }): "nothing" | "tile" => text === undefined ? "tile" : "nothing",
    args: { by: { type: "number", optional: true, about: "rows to scroll; negative goes up" }, text: { type: "string", optional: true, about: "component preview text to select; an agent reads it without changing the selection" } },
    examples: [{ act: "complete.preview by=3", does: "reads three rows further in the selected reference" }],
} as const;

export const COMPLETION_DOCS = {
  summary: "scroll the lit completion row's docs",
  keys: COMPLETION_PREVIEW.keys, touches: "draft", draft: "type", replay: "safe",
  args: { by: { type: "number", about: "rows to scroll; negative goes up" } },
  examples: [{ act: "complete.docs by=1", does: "reads one row further in the docs" }],
} as const;

export const COMPLETION_STEP = {
  summary: "show a component's variations and arguments, or return to components",
  keys: [{ keys: "right", does: "into a component's variations" }, { keys: "click", does: "on >" }, { keys: "left", does: "returns", says: "return from a component's variations to the components" }], touches: "nothing", replay: "safe",
  args: { direction: { type: "string", choices: ["right", "left"], about: "right opens variations; left returns" } },
  examples: [{ act: "complete.step direction=right", does: "shows the selected component's variations and arguments" }],
} as const;

export const COMPLETION_COPY = {
  summary: "copy the selected component's source, ready to paste into a note",
  keys: [{ keys: "y", does: "after choosing a component" }, { keys: "click", does: "[copy]" }], touches: "nothing", replay: "safe", args: {},
} as const;
export const COMPLETION_DEFINITION = {
  summary: "open the selected agent's defining script note beside the draft",
  keys: [{ keys: "g", does: "after choosing an agent" }, { keys: "click", does: "[g]" }], touches: "nothing", replay: "safe", args: {},
} as const;

export const COMPLETION_MOVE = {
  summary: "light another row of the open completion list (PIE-1339): by= rows, negative up; the docs beside it follow the lit row",
  keys: "up/down, ctrl+n, ctrl+p, hover, wheel over the list", touches: "draft", draft: "type", replay: "safe",
  args: { by: { type: "number", about: "rows to move; negative goes up" } },
  examples: [{ act: "complete.move by=2", does: "lights the row two below the lit one" }],
} as const;
export const COMPLETION_ACCEPT = {
  words: "insert the lit completion row",
  summary: "insert the lit row of the open completion list, or row n= (from 1), as tab or enter does: checked with the service first, one undo step",
  keys: "tab, enter (unless the footer says it's a new line), click, double click", touches: "draft", draft: "type", replay: "ask",
  args: { n: { type: "number", optional: true, about: "the row to insert (from 1); default the lit one" } },
  examples: [{ act: "complete.accept", does: "inserts the lit row" }, { act: "complete.accept n=3", does: "inserts the third row" }],
} as const;
export const COMPLETION_ASK = {
  words: "open the completion list where you're typing",
  summary: "open (or ask again) the completion list for the token at the cursor, as a deliberate choice: ⏎ then inserts its lit row",
  keys: "tab, ctrl+space in a [[, ((, ::, > [! or [key:: token", touches: "draft", draft: "type", replay: "safe", args: {},
  examples: [{ act: "complete.ask", does: "lists the candidates for the token at the draft's cursor, in the popup" }],
} as const;
export const COMPLETION_DISMISS = {
  summary: "close the open completion list, leaving what's typed as it is",
  keys: "esc, a click outside", touches: "draft", draft: "type", replay: "safe", args: {},
} as const;

export const COMPLETION_ACTIONS = actionSet<Completer>()("completion", {
  "complete.move": def({ ...COMPLETION_MOVE, run({ by }, c) {
    if (!c.shown?.items.length) throw new ActionRefused("no completion list is open; type [[, ((, :: or a [key:: first");
    c.moveBy(by);
    const s = c.shown!;
    return { index: s.index + 1, of: s.items.length, label: s.items[s.index]?.label };
  } }),
  "complete.accept": def({ ...COMPLETION_ACCEPT, async run({ n }, c) {
    const s = c.shown;
    if (!s?.items.length) throw new ActionRefused("no completion list is open; type [[, ((, :: or a [key:: first");
    const i = n === undefined ? s.index : n - 1, item = s.items[i];
    if (!item) throw new ActionRefused(`there is no row ${n}; there are ${s.items.length}`);
    if (!await c.accept(i)) throw new ActionRefused(`not inserted${s.message ? `: ${s.message}` : ""}`);
    return { inserted: item.insertion };
  } }),
  "complete.ask": def({ ...COMPLETION_ASK, async run(_, c) {
    if (!c.target()) throw new ActionRefused("the cursor isn't in a [[, ((, [file::, > [!, ::component, a [key:: property or a figure's YAML");
    await c.refresh(true);
    const s = c.shown;
    return { kind: s?.target.kind, rows: s?.items.length ?? 0, ...(s?.message ? { message: s.message } : {}) };
  } }),
  "complete.dismiss": def({ ...COMPLETION_DISMISS, run(_, c) { const open = !!c.state; c.dismiss(); return { closed: open }; } }),
  "complete.copy": def({ ...COMPLETION_COPY, run(_, c, actor) { return c.copySource(actor); } }),
  "complete.definition": def({ ...COMPLETION_DEFINITION, run(_, c, actor) { return c.jumpDefinition(actor); } }),
  "complete.step": def({
    ...COMPLETION_STEP,
    run({ direction }, c, actor) {
      if (actor.kind === "agent") return c.shown?.items[c.shown.index]?.children ?? [];
      return direction === "left" ? c.back() : c.expand();
    },
  }),
  "complete.docs": def({ ...COMPLETION_DOCS, run({ by }, c, actor) { return c.previewBy(by, actor); } }),
  "complete.preview": def({
    ...COMPLETION_PREVIEW,
    run({ by, text }, c, actor) { return text === undefined ? c.previewBy(by ?? 0, actor) : c.selectPreview(text, actor); },
  }),
});

/**
 * The person's key, wheel or click running one of the list's actions: a refusal (an insert the service turned down, a
 * second ⏎ while the first is checked) is already said in the popup's footer, so it ends there rather than as an
 * unhandled rejection. `act` callers await the action and get the refusal.
 */
export function personRuns<K extends "complete.move" | "complete.accept" | "complete.ask" | "complete.dismiss" | "complete.docs">(name: K, args: Parameters<typeof COMPLETION_ACTIONS.run<K>>[1], c: Completer): void {
  const refused = (e: unknown) => { if (!(e instanceof ActionRefused)) throw e; };
  // An action's own run is called at once (ActionSet.call), so a refusal can come before there's a promise to catch.
  try { COMPLETION_ACTIONS.run(name, args, c, USER).catch(refused); } catch (e) { refused(e); }
}

