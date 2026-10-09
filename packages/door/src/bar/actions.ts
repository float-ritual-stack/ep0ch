// The power bar's actions (PIE-656), on the App's dispatcher so every screen has them: `bar.open` (ctrl+k, cmd+k, the
// status bar's ^K, the desk's / and a river column's g in its notes scope), `bar.pick` (⏎ or a double click, alt+⏎ or
// an alt-click the alternate) and `bar.close` (esc). The person's open the bar over the screen and take their keys
// until it's put away. An agent's never touch the person's bar: `bar.open` answers the rows it would list, and
// `bar.pick` lists them for itself and picks one, which runs through the source's shared path as the agent, so every
// rule an action has for an agent (never their keys, focus or screen) is that path's own.
import { ActionRefused, actionSet, def } from "../surface/actions";
import type { Actor } from "../socket";
import type { PowerBar } from "./bar";
import { barSource, barSources } from "./source";

/** What the bar's actions run on: the door's open bar (the person's), and how to make one (the person's, or an agent's own unseen). */
export interface BarOn {
  bar(): PowerBar | null;
  open(o: { query?: string; scope?: string | null }): PowerBar;
  /** A bar of the agent's own, never drawn: its rows once its sources answered. */
  unseen(o: { query?: string; scope?: string | null }): Promise<PowerBar>;
  close(): void;
}

const scopeArg = (scope: string | undefined): string | null => {
  if (scope === undefined || scope === "all" || scope === "") return null;
  const s = barSource(scope);
  if (!s) throw new ActionRefused(`no scope ${scope}; the scopes: all, ${barSources().map(x => `${x.id} (${x.prefix})`).join(", ")}`);
  return s.id;
};
const scopes = () => barSources().map(s => ({ scope: s.id, prefix: s.prefix, title: s.title, about: s.about, by: s.by }));

export const BAR_ACTIONS = actionSet<{ on: BarOn }>()("bar", {
  "bar.open": def({
    summary: "the power bar: one palette over every screen. With nothing typed it lists the tiles open on every screen and in your drawer (indented as each screen's layout tree, with the note each shows), then what others changed since you looked; typed, the tiles, the outline's notes (the service's one search), the actions you can do here (with their keys), what changed and the screens, each under its heading; scope=tiles|notes|actions|recent|screens or an extension's (or its prefix: % / > + @, ~ and so on) lists one. The person's opens it with their keys in it (query= typed in); an agent's answers the rows it would list (numbered from 1, with scope=, query=) and opens nothing",
    keys: "ctrl+k, cmd+k (where the terminal sends it), a click on the status bar's ^K, on every screen (not while typing, in a terminal tile or the drawer's program); / on the desk and the screens on it, g in a river column (the notes scope); ^W ? on the desk (the actions scope on the ^W keys, to filter and press one)",
    touches: "nothing", replay: "safe",
    args: {
      query: { type: "string", optional: true, about: "what's typed in it" },
      scope: { type: "string", optional: true, about: "one source: tiles, notes, actions, recent, screens, an extension's (ext.<id>.<source>), or its prefix; all (the default) lists every one" },
    },
    async run({ query, scope }, { on }, actor: Actor) {
      const s = scopeArg(scope);
      if (actor.kind === "agent") { const b = await on.unseen({ query, scope: s }); try { return { ...b.describe(), scopes: scopes() }; } finally { b.close(); } }
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
    async run({ n, alt, query, scope, source, key }, { on }, actor: Actor) {
      if (actor.kind === "agent") {
        const b = await on.unseen({ query, scope: scopeArg(scope) });
        try {
          const at = source !== undefined || key !== undefined ? b.rowNamed(source, key) : n ?? 1;
          return await b.pickRow(at, !!alt, actor);
        } catch (e) { throw new ActionRefused(e instanceof Error ? e.message : String(e)); } finally { b.close(); }
      }
      const b = on.bar();
      if (!b) throw new ActionRefused("the power bar isn't open · ctrl+k opens it");
      if (query !== undefined || scope !== undefined) throw new ActionRefused("the person's pick is from the bar as they see it: query= and scope= are an agent's");
      const at = n ?? b.selected + 1;
      on.close();
      try { return await b.pickRow(at, !!alt, actor); } catch (e) { throw new ActionRefused(e instanceof Error ? e.message : String(e)); }
    },
  }),
  "bar.close": def({
    summary: "put the power bar away, nothing picked. The person's: an agent never closes the bar the person has open",
    keys: "esc, a click outside it",
    touches: "nothing", replay: "safe",
    person: "the power bar is the person's while it's open; an agent lists and picks with its own (bar.open, bar.pick)",
    args: {},
    run(_, { on }) {
      if (!on.bar()) throw new ActionRefused("the power bar isn't open");
      on.close();
      return { closed: true };
    },
  }),
});
