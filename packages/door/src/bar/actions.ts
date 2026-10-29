// The power bar's actions (PIE-656), on the App's dispatcher so every screen has them: `bar.open` (ctrl+k, cmd+k, the
// status bar's ^K, the desk's / and a river column's g in its notes scope), `bar.pick` (⏎ or a double click, alt+⏎ or
// an alt-click the alternate) and `bar.close` (esc). The person's open the bar over the screen and take their keys
// until it's put away. An agent's never touch the person's bar: `bar.open` answers the rows it would list, and
// `bar.pick` lists them for itself and picks one, which runs through the source's shared path as the agent, so every
// rule an action has for an agent (never their keys, focus or screen) is that path's own.
import { ActionRefused, actionSet, actRequestOf, def, lineWords, type ActRequest } from "../surface/actions";
import type { Actor } from "../socket";
import type { PowerBar } from "./bar";
import { clearPrivateForm, formFocus, formLine, formOpen, formRun, formSet, formState } from "./ask";
import { formFor, openActionForm } from "./form";
import { barSource, barSources, type BarHost } from "./source";

/** What the bar's actions run on: the door's open bar (the person's), and how to make one (the person's, or an agent's own unseen). */
export interface BarOn {
  bar(): PowerBar | null;
  open(o: { query?: string; scope?: string | null }): PowerBar;
  /** A bar of the agent's own, never drawn: its rows once its sources answered. */
  unseen(o: { query?: string; scope?: string | null }): Promise<PowerBar>;
  close(): void;
  /** What the bar's sources reach (an action's form opens through it). */
  host(): BarHost;
}

/** The call a form starts from: line= (an act line, some of its arguments given) or action= alone. */
function formRequest(action: string | undefined, line: string | undefined): ActRequest {
  if (line !== undefined) {
    const req = actRequestOf(lineWords(line));
    if (action !== undefined && action !== req.action) throw new ActionRefused(`line= runs ${req.action}, not action=${action}: give one of them`);
    return req;
  }
  if (action === undefined) throw new ActionRefused("which action? action=<name> (layout.move), or line=<an act line> to start from (\"layout.move to=notes\")");
  return { action };
}

const FORM_OPS = ["open", "focus", "set", "clear", "back", "copy", "run"] as const;

const scopeArg = (scope: string | undefined): string | null => {
  if (scope === undefined || scope === "all" || scope === "") return null;
  const s = barSource(scope);
  if (!s) throw new ActionRefused(`no scope ${scope}; the scopes: all, ${barSources().map(x => `${x.id} (${x.prefix})`).join(", ")}`);
  return s.id;
};
const scopes = () => barSources().map(s => ({ scope: s.id, prefix: s.prefix, title: s.title, about: s.about, by: s.by }));

export const BAR_ACTIONS = actionSet<{ on: BarOn; standing: boolean }>()("bar", {
  "bar.open": def({
    summary: "the power bar: one palette over every screen. With nothing typed it lists the tiles open on every screen and in your drawer (indented as each screen's layout tree, with the note each shows), then what others changed since you looked; typed, the tiles, the outline's notes (the service's one search), the actions you can do here (with their keys), what changed and the screens, each under its heading; scope=tiles|notes|actions|recent|screens|extensions or an extension's (or its prefix: % / > + @ &, ~ and so on) lists one. The person's opens it with their keys in it (query= typed in); an agent's answers the rows it would list (numbered from 1, with scope=, query=) and opens nothing",
    keys: [{ keys: "ctrl+k cmd+k alt+k", does: "on every screen and in your drawer, not while typing, in a terminal tile or the drawer's program (cmd+k where the terminal sends it; alt+k is PIE-1346)" }, { keys: "alt+left alt+right alt+b alt+f", does: "in the open bar, move between scopes" }, { keys: "click", does: "on a scope in the open bar, or on the status bar's ^K" }, { via: "a prefix typed on the bar's empty line" }, { keys: "✦p", does: "hyper chord, also while typing" }, { keys: "✦g", does: "hyper chord, in the bar's screens scope" }, { keys: "/", does: "on the desk and the screens on it" }, { keys: "g", does: "in a river column, the notes scope" }, { keys: "^W ?", does: "on the desk: the actions scope on the ^W keys, to filter and press one" }],
    touches: "nothing", replay: "safe",
    args: {
      query: { type: "string", optional: true, about: "what's typed in it" },
      scope: { type: "string", optional: true, about: "one source: tiles, notes, actions, recent, screens, extensions, an extension's (ext.<id>.<source>), or its prefix; all (the default) lists every one" },
      by: { type: "number", optional: true, about: "the person's open bar: the next scope (1) or the one before (-1), round again, keeping what's typed" },
      keep: { type: "boolean", optional: true, about: "the person's open bar: change only its scope, keeping what's typed (its scope tabs and prefixes)" },
    },
    examples: [
      { act: "bar.open scope=notes query=garden", does: "answers the notes that match garden, numbered for bar.pick; nothing opens" },
      { act: "bar.open query=zoom", does: "answers every source's rows for zoom: tiles, notes, actions, screens" },
    ],
    async run({ query, scope, by, keep }, { on, standing }, actor: Actor) {
      const s = scopeArg(scope);
      if (!standing) { const b = await on.unseen({ query, scope: s }); try { return { ...b.describe(), scopes: scopes() }; } finally { b.close(); } }
      const open = on.bar();
      if ((by !== undefined || keep) && open && !open.ended()) {
        const all = open.scopes();
        open.setScope(by !== undefined ? all[((all.indexOf(open.scope) + Math.sign(by)) % all.length + all.length) % all.length]! : s);
        return { open: true, scope: open.scope ?? "all", query: open.describe().query };
      }
      const b = on.open({ query, scope: s });
      return { open: true, scope: b.scope ?? "all", query: b.query };
    },
  }),
  "bar.pick": def({
    summary: "pick a row of the power bar (n= from 1, default the lit one): a tile goes to it (its spine opened, its screen brought up), a note opens where opens land, an action runs, a screen opens, an extension's row does what it says; alt=true is the alternate (a tile zoomed, a note in a new detail). The person's picks from their open bar and puts it away. An agent's lists the rows for itself (query=, scope=, as bar.open answers them) and picks from those, as itself: a tile on another screen is refused, a note lands where an agent's opens land, never the person's keys",
    keys: "enter, a double click · alt+enter, an alt-click, a ctrl-click",
    touches: "nothing", replay: "ask",
    args: {
      n: { type: "number", optional: true, about: "the row, from 1 (bar.open and peek number them)" },
      source: { type: "string", optional: true, about: "with key=: the row by its source and key (as bar.open answers them), whatever its number now" },
      key: { type: "string", optional: true, about: "with source=: the row's key" },
      alt: { type: "boolean", optional: true, about: "the alternate: zoom a tile, open a note in a new detail" },
      query: { type: "string", optional: true, about: "an agent's: what to list before picking" },
      scope: { type: "string", optional: true, about: "an agent's: the scope to list" },
    },
    examples: [
      { act: "bar.pick scope=notes query=garden n=1", does: "opens the first note matching garden where an agent's opens land" },
      { act: "bar.pick source=notes key=7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34 alt=true", does: "opens that note (a row bar.open answered) in a new detail" },
    ],
    async run({ n, alt, query, scope, source, key }, { on, standing }, actor: Actor) {
      if (!standing) {
        const b = await on.unseen({ query, scope: scopeArg(scope) });
        try {
          const at = source !== undefined || key !== undefined ? b.rowNamed(source, key) : n ?? 1;
          return await b.pickRow(at, !!alt, actor);
        } catch (e) { throw new ActionRefused(e instanceof Error ? e.message : String(e)); } finally { b.close(); }
      }
      const b = on.bar();
      if (!b) throw new ActionRefused("the power bar isn't open · ctrl+k opens it");
      if (query !== undefined || scope !== undefined) throw new ActionRefused("the person's pick is from the bar as they see it: query= and scope= are an agent's");
      const lit = b.litPick(n), at = typeof lit === "number" ? lit : await lit;
      if (on.bar() !== b) throw new ActionRefused("the power bar was put away");
      if (!b.keepsRun(at)) on.close();
      try { return await b.pickRow(at, !!alt, actor); } catch (e) { throw new ActionRefused(e instanceof Error ? e.message : String(e)); }
    },
  }),
  "bar.edit": def({
    summary: "edit the power bar's shared line: clear, complete, paste, select, cut, delete-word or undo. An agent edits an unseen line supplied by query= and scope=",
    keys: [{ keys: "esc", does: "with text in the line, clears it" }, { keys: "ctrl+u", does: "clear the line" }, { keys: "tab", does: "complete", says: "complete the word in the power bar's line" }, { keys: "paste", does: "paste into the line" }, { keys: "shift+left shift+right shift+up shift+down", does: "select", says: "select text in the power bar's line" }, { keys: "drag", does: "select" }, { keys: "double-click", does: "select" }, { keys: "ctrl+x", does: "cut", says: "cut the selection from the power bar's line" }, { keys: "ctrl+w", does: "delete a word" }, { keys: "ctrl+z", does: "undo", says: "undo the last change to the power bar's line" }],
    touches: "nothing", replay: "safe",
    args: {
      op: { type: "string", about: "clear, complete, paste, select, cut, delete-word or undo" },
      text: { type: "string", optional: true, about: "text to paste" },
      from: { type: "number", optional: true, about: "selection start, zero-based UTF-16 offset" },
      to: { type: "number", optional: true, about: "selection end, zero-based UTF-16 offset" },
      query: { type: "string", optional: true, about: "an agent's own line" },
      scope: { type: "string", optional: true, about: "an agent's own scope" },
    },
    examples: [
      { act: "bar.edit op=clear", does: "clears the power bar's line" },
      { act: "bar.edit op=complete", does: "fills the next part of the lit row into the line, selected" },
    ],
    async run({ op, text, from, to, query, scope }, { on, standing }, actor: Actor) {
      if (!["clear", "complete", "paste", "select", "cut", "delete-word", "undo"].includes(op)) throw new ActionRefused("choose clear, complete, paste, select, cut, delete-word or undo");
      const b = !standing ? await on.unseen({ query, scope: scopeArg(scope) }) : on.bar();
      if (!b) throw new ActionRefused("the power bar isn't open · ctrl+k opens it");
      try { await b.edit(op, { text, from, to }, actor.kind === "user"); return { query: b.query, selected: b.input.selectedText() }; }
      finally { if (!standing) b.close(); }
    },
  }),
  "bar.docs": def({
    summary: "scroll, select and copy the power bar's docs, or put an example on the command line",
    keys: "alt+j, alt+k scroll; alt+v docs keys (up down left right h j k l, pgup pgdn home end, y copy, enter example, esc or v line), wheel over docs, drag or double click to select, cmd+c to copy, click an example",
    touches: "nothing", replay: "safe", person: "the docs reading position and selection belong to the person",
    args: {
      op: { type: "string", choices: ["scroll", "select", "extend", "copy", "example", "focus", "key"], about: "the reader operation" },
      key: { type: "string", optional: true, about: "a key in docs selection mode" }, by: { type: "number", optional: true, about: "rows to scroll" }, row: { type: "number", optional: true, about: "content row from zero" },
      col: { type: "number", optional: true, about: "column from zero" }, clicks: { type: "number", optional: true, about: "2 for a word, 3 for a line" },
    },
    examples: [{ act: "bar.docs op=scroll by=5", does: "scrolls the open bar's docs down five rows" }],
    run({ op, ...o }, { on }) { const b = on.bar(); if (!b) throw new ActionRefused("the power bar isn't open"); return b.docs(op, o); },
  }),
  "bar.command": def({
    summary: "copy the command as an ep0ch act line or a note button, recall the last run, or open its copy menu",
    keys: [{ keys: "alt+o", does: "copy command", says: "copy the command as an act line" }, { keys: "alt+y", does: "copy button", says: "copy the command as a note button" }, { keys: "alt+m", does: "menu", says: "open the command's copy menu" }, { keys: "up", does: "on an empty line recalls the last run" }, { keys: "right-click", does: "a row" }],
    touches: "nothing", replay: "safe", person: "the bar and clipboard are the person's",
    args: { op: { type: "string", choices: ["copy", "button", "recall", "menu"], about: "copy, button, recall or menu" }, n: { type: "number", optional: true, about: "row from 1; default the lit row" } },
    examples: [{ act: "bar.command op=button", does: "copies the selected command as an authored note button" }],
    async run({ op, n }, { on }) {
      const b = on.bar();
      if (!b) throw new ActionRefused("the power bar isn't open");
      return b.command(op, n);
    },
  }),
  "bar.insert": def({
    summary: "insert the command as a button into the note at the person's cursor, as one unsaved draft edit",
    keys: [{ keys: "alt+i", does: "insert the command as a button into the note" }, { via: "the insert button in the command menu" }],
    touches: "nothing", replay: "ask", person: "inserting at the person's cursor is their action",
    args: {},
    async run(_, { on }, actor) {
      const b = on.bar();
      if (!b) throw new ActionRefused("the power bar isn't open");
      // Whoever pressed it is who inserted it (in yolo an agent may, and is said as itself).
      return on.host().dispatch.act({ action: "edit.button", args: { line: b.commandLine() } }, actor);
    },
  }),
  "bar.form": def({
    summary: "an action's form in the power bar (PIE-1031): a field per argument (the ones it needs first, then tile= when it runs on a tile, then the rest), each with what it means; the field in focus lists its values, the things in the system it can name (a tile, a note, a page, a screen, a saved view, a property's key or value, a tile kind), its choices, or true and false, typing filtering them; the act line it will run under them, and its examples, a pick of one filling the form. op=open action=<name> (or line=<an act line> to start from some of its arguments) opens it; op=focus field=<name> (run: the act line) moves to a field; op=set field= value= answers one and goes on; op=clear field= leaves one out; op=back goes back a field; op=copy copies the act line; op=run runs it as the person, through the dispatcher. An agent's op=open answers the fields (their kinds, choices and defaults) and opens nothing; an agent runs the action itself",
    keys: "enter on an action that takes arguments in the power bar's actions (alt+enter runs one that needs none as it is); in the form: enter picks a value and goes on, alt+enter picks and runs, shift+tab or backspace on an empty line goes back a field, a click on a field or the act line",
    touches: "nothing", replay: "ask",
    personWith: a => (a.op === "open" ? null : "the form open in the power bar is the person's; an agent runs the action itself (ep0ch act <action> …, op=open answers its fields)"),
    args: {
      op: { type: "string", choices: FORM_OPS, about: "open, focus, set, clear, back, copy or run" },
      action: { type: "string", optional: true, about: "op=open: the action whose form it is" },
      line: { type: "string", optional: true, about: "op=open: an act line to start from, some of its arguments answered" },
      field: { type: "string", optional: true, about: "op=focus, set or clear: the field (run, with op=focus: the act line)" },
      value: { type: "string", optional: true, about: "op=set: the field's answer" },
    },
    examples: [
      { act: "bar.form op=open action=layout.move", does: "opens layout.move's form: tile, to, where and the rest, each with its values" },
      { act: "bar.form op=open line=\"layout.move to=notes\"", does: "an agent's: answers layout.move's fields, to= already notes; nothing opens" },
    ],
    async run({ op, action, line, field, value }, { on }, actor: Actor) {
      if (op === "open") {
        const req = formRequest(action, line);
        if (actor.kind === "agent") return formFor(on.host(), req);
        await openActionForm(on.host(), req, actor);
        return formState();
      }
      if (!formOpen()) throw new ActionRefused("no form is open · pick an action that takes arguments in the power bar (ctrl+k then >)");
      const need = () => { if (field === undefined) throw new ActionRefused(`op=${op} names field=`); return field; };
      if (op === "run") { const why = formState()?.refused; if (typeof why === "string") throw new ActionRefused(why); on.close(); return formRun(); }
      if (op === "copy") { const l = `ep0ch act ${formLine()}`; on.host().ctx.copy?.(l); on.host().ctx.flash(`copied: ${l}`); return { copied: l }; }
      if (op === "focus") formFocus(need());
      else if (op === "back") formFocus("back");
      else if (op === "set") { if (value === undefined) throw new ActionRefused("op=set names value="); formSet(need(), value, true); }
      else formSet(need(), undefined);
      // The bar again, on the field in focus now: its values listed.
      on.open({ scope: "ask" });
      return formState();
    },
  }),
  "bar.close": def({
    summary: "put the power bar away, nothing picked. The person's: an agent never closes the bar the person has open",
    keys: "esc on an empty line, or right after a typed line ran; a click outside it",
    touches: "nothing", replay: "safe",
    person: "the power bar is the person's while it's open; an agent lists and picks with its own (bar.open, bar.pick)",
    args: {},
    run(_, { on }) {
      if (!on.bar()) throw new ActionRefused("the power bar isn't open");
      on.close();
      clearPrivateForm();
      return { closed: true };
    },
  }),
});
