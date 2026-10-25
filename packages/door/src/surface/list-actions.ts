// The lists' actions (PIE-747, ADR 0004 contract 3): one ActionSet for every list the door draws, whichever tile holds
// it. `list.blocks` reads the lists as drawn, `list.pick`, `list.step`, `list.open`, `list.filter` and `list.enter` move
// them, each with a key, a click and `act`. A host (the reader, whose lists are its inline `::links` components and its
// extensions' `list` views; the links tile, whose list is its body) lends its lists through `ListHost`; what an open
// does, and what a pick shows, stays the host's. An agent's pick, step and filter are its own, drawn in its tint, and
// never touch the person's selection or keys; `list.enter` gives a list the keyboard, so it is the person's.
import { ActionRefused, actionSet, def } from "./actions";
import { actorKey, PERSON, selectable, type ListHandle, type ListViewRow } from "./list-view";
import type { Actor } from "../socket";

/** What a host lends the lists' actions. */
export interface ListHost {
  /** The lists drawn now, numbered from 1 in drawing order. */
  lists(): ListHandle[];
  /** The key of the list the person is in, else the one their `[ ]` position is on. */
  current(): string | null;
  /** What a refusal says when nothing here draws a list. */
  none: string;
  /** The person's pick moved to `row`: show it where this host's selection goes (a preview following, the `[ ]` position). */
  picked(list: ListHandle, row: ListViewRow): void | Promise<void>;
  /** Open `row` for real, as `actor` (`standing`: as the person). `where`: where the host's opens land, or a new detail beside. */
  open(list: ListHandle, row: ListViewRow, where: "home" | "new", actor: Actor, standing: boolean): Promise<unknown>;
  /** The person goes into the list (their keys are its) or comes out. */
  enter(list: ListHandle, on: boolean): void;
  /** The person starts typing a filter. */
  type(list: ListHandle): void;
  redraw(): void;
}

export interface ListOn { host: ListHost; standing: boolean }

/** A tile that draws a list of its own and lends it to the actions (the links tile): it gives its `ListHost` for the desk it is on. */
export interface ListTile<D = unknown> { listHost(desk: D): ListHost }
export const isListTile = (p: unknown): p is ListTile => typeof (p as ListTile | undefined)?.listHost === "function";

/** The list a call names: by number, `^name` or title; left out, the one the person is in, else the only one. */
export function listNamed(host: ListHost, named?: string): ListHandle {
  const all = host.lists();
  if (!all.length) throw new ActionRefused(host.none);
  if (named !== undefined) {
    const v = named.trim();
    const found = /^\d+$/.test(v) ? all[Number(v) - 1] : all.find(l => l.key === v || l.key === `^${v}` || l.title.toLowerCase() === v.toLowerCase());
    if (!found) throw new ActionRefused(`no list ${named}; the lists here: ${all.map(l => `${l.n} ${l.title}`).join(", ")}`);
    return found;
  }
  const key = host.current();
  const here = key ? all.find(l => l.key === key) : all.length === 1 ? all[0] : undefined;
  if (!here) throw new ActionRefused(`say which list: list= its number or title (${all.map(l => `${l.n} ${l.title}`).join(", ")})`);
  return here;
}

const LIST_ARG = { type: "string", optional: true, about: "which list: its number (list.blocks lists them), its ^name or its title; left out, the one the person is in, else the only one" } as const;

/** A row of `list` by `n` (from 1, as list.blocks numbers them, among the rows `who` sees) or `id` (a row's, or the block it opens, or its start). */
function rowIn(list: ListHandle, who: string, { n, id }: { n?: number; id?: string }): ListViewRow {
  const rows = list.view.pickable(who);
  if (!rows.length) throw new ActionRefused(`${list.title} lists nothing${list.view.filter(who) ? ` that ${list.view.filter(who)} leaves` : " yet"}`);
  const opens = (r: ListViewRow) => (r.do && "open" in r.do ? r.do.open : undefined);
  const row = id !== undefined ? rows.find(r => r.id === id) ?? rows.find(r => !!opens(r) && opens(r)!.startsWith(id)) : rows[n! - 1];
  if (!row) throw new ActionRefused(id !== undefined ? `${list.title} has no row for ${id}` : `${list.title} has rows 1 to ${rows.length}`);
  return row;
}

export const LISTVIEW_ACTIONS = actionSet<ListOn>()("listview", {
  "list.blocks": def({
    summary: "the lists drawn here (an inline ::links, an extension's list view, a links tile's rows): each one's number, title, ^name key, whether the person is in it, its filter and the row its preview shows, every row numbered (kind, text, the block it stands for, the selected one), and what each agent has picked or filtered in it. Reads only",
    keys: "",
    touches: "nothing", replay: "safe",
    args: {},
    run(_, { host }, actor) {
      const who = actorKey(actor), lists = host.lists();
      if (!lists.length) throw new ActionRefused(host.none);
      return {
        lists: lists.map(l => {
          const mine = l.view.picked(PERSON), yours = who === PERSON ? null : l.view.picked(who);
          return {
            n: l.n, key: l.key, title: l.title, ...(l.about ? { query: l.about } : {}), ...(l.detail ?? {}), entered: l.entered,
            ...(l.view.filter(PERSON) ? { filter: l.view.filter(PERSON) } : {}),
            ...(mine ? { selected: mine.id } : {}),
            ...(who !== PERSON ? { yours: { ...(yours ? { picked: yours.id } : {}), ...(l.view.filter(who) ? { filter: l.view.filter(who) } : {}) } } : {}),
            agents: l.view.others().filter(o => o.who !== who).map(o => ({ by: o.who, ...(o.row ? { picked: o.row.id } : {}), ...(o.filter ? { filter: o.filter } : {}) })),
            rows: l.view.describe(PERSON, l.describeRow),
          };
        }),
      };
    },
  }),
  "list.pick": def({
    summary: "pick a row of a list: n= its number from 1 (list.blocks lists them), or id= the block it stands for (or its start); list= which list. The person's moves their selection and the [ ] position, and the preview follows; an agent's is its own, drawn in its tint, and moves nothing of the person's",
    keys: "[ ] onto a row, a click on it; j k ↑ ↓ Home End in the list",
    touches: "nothing", replay: "safe", says: r => (r.moved ? null : `picked row ${r.row} of ${r.title}`),
    args: {
      list: LIST_ARG,
      n: { type: "number", optional: true, about: "the row, from 1" },
      id: { type: "string", optional: true, about: "the block the row stands for, or its first characters" },
    },
    examples: [
      { act: "list.pick n=3", does: "picks row 3 of the list; an agent's call picks it for itself, in its tint" },
      { act: "list.pick list=orders id=7d9a1f40", does: "picks the row for block 7d9a1f40 in the list named ^orders" },
    ],
    async run({ list, n, id }, { host, standing }, actor) {
      if ([n, id].filter(x => x !== undefined).length !== 1) throw new ActionRefused("say one of n= (a row from 1) or id= (the block it stands for)");
      const l = listNamed(host, list), who = standing ? PERSON : actorKey(actor);
      const row = rowIn(l, who, { n, id });
      if (!selectable(row)) throw new ActionRefused(`${row.label} is a header: it has nothing to pick`);
      l.view.pick(who, row.id);
      if (who === PERSON) await host.picked(l, row);
      host.redraw();
      return { list: l.n, title: l.title, row: l.view.pickable(who).findIndex(r => r.id === row.id) + 1, text: row.label, ...(row.do && "open" in row.do ? { id: row.do.open } : {}), moved: who === PERSON };
    },
  }),
  "list.step": def({
    summary: "move the pick `by` rows (1 the next, -1 the one before) among the rows that can be picked, as j and k do; list= which list. The person's moves their selection and the [ ] position; an agent's is its own, in its tint",
    keys: "j k ↑ ↓ in the list",
    touches: "nothing", replay: "safe", says: r => (r.moved ? null : `stepped to row ${r.row} of ${r.title}`),
    args: {
      list: LIST_ARG,
      by: { type: "number", about: "1 the next row, -1 the one before" },
    },
    examples: [{ act: "list.step by=1", does: "moves to the next row, as j does" }],
    async run({ list, by }, { host, standing }, actor) {
      const l = listNamed(host, list), who = standing ? PERSON : actorKey(actor);
      const row = l.view.step(who, by);
      if (!row) throw new ActionRefused(`no row ${by > 0 ? "after" : "before"} the pick in ${l.title}`);
      if (who === PERSON) await host.picked(l, row);
      host.redraw();
      return { list: l.n, title: l.title, row: l.view.pickable(who).findIndex(r => r.id === row.id) + 1, text: row.label, moved: who === PERSON };
    },
  }),
  "list.open": def({
    summary: "open a row of a list for real: n= its number, id= its block, default the picked one; list= which list. where=home (default) opens it where the host's opens land, as ⏎ does (a reader's link, else the reader itself, kept in its history); where=new in a new detail beside, as alt+⏎. A row's activation runs as you, under your rules: an agent's is refused where it would move what the person is reading, and never moves their keys",
    keys: "⏎ on a row or in the list, a double click (home) · alt+⏎, an alt-, ctrl- or middle-click (new); the click that gives the list the keys only selects",
    // In a reader this is the most it touches (an agent's open there would move what the person reads); a links tile's lowers it (Registration.touchesAt).
    touches: "tile", replay: "ask", way: "opening a row there would move what they're reading · an agent opens the row's note with open id= (list.blocks gives it), naming no tile",
    args: {
      list: LIST_ARG,
      n: { type: "number", optional: true, about: "the row, from 1; default the picked one" },
      id: { type: "string", optional: true, about: "the block the row stands for, or its first characters" },
      where: { type: "string", optional: true, about: "home (default): where the host's opens land; new: a new detail beside it" },
    },
    examples: [
      { act: "list.open n=2", does: "opens row 2 where the host's opens land" },
      { act: "list.open id=7d9a1f40 where=new", does: "opens the row for block 7d9a1f40 in a new detail beside" },
    ],
    async run({ list, n, id, where }, { host, standing }, actor) {
      if (where !== undefined && where !== "home" && where !== "new") throw new ActionRefused(`where is home or new, not ${where}`);
      if (n !== undefined && id !== undefined) throw new ActionRefused("say n= or id=, not both");
      const l = listNamed(host, list), who = standing ? PERSON : actorKey(actor);
      const row = n === undefined && id === undefined
        ? l.view.picked(who) ?? (() => { throw new ActionRefused(`no row is picked in ${l.title}; say n=`); })()
        : rowIn(l, who, { n, id });
      return host.open(l, row, where ?? "home", actor, standing);
    },
  }),
  "list.filter": def({
    summary: "narrow a list to the rows its words match (the one search matcher, over a row's label and detail); words= \"\" clears it; list= which list. With no words the person starts typing one (/ in the list). An agent's filter is its own: the list it reads (list.blocks) narrows for it, the person's list is untouched and says so in the agent's tint",
    keys: "/ in the list; ⏎ keeps it, esc goes back",
    touches: "nothing", replay: "safe", says: r => `filtered ${r.title}${r.filter ? ` to ${r.filter}` : ""}`,
    args: {
      list: LIST_ARG,
      words: { type: "string", optional: true, about: "what to match; empty clears; left out, the person types it" },
    },
    examples: [{ act: "list.filter words=\"pea\"", does: "narrows the list to the rows matching pea (an agent's, for itself)" }],
    run({ list, words }, { host, standing }, actor) {
      const l = listNamed(host, list), who = standing ? PERSON : actorKey(actor);
      if (words === undefined) {
        if (!standing) throw new ActionRefused("typing a filter is the person's; an agent passes words=<text>");
        host.type(l);
        host.redraw();
        return { list: l.n, title: l.title, typing: true, filter: l.view.filter(PERSON) };
      }
      l.view.stopTyping(false);
      l.view.setFilter(who, words);
      host.redraw();
      return { list: l.n, title: l.title, filter: l.view.filter(who), rows: l.view.visible(who).length };
    },
  }),
  "list.enter": def({
    summary: "go into a list (on=true, the default), or come out of it (on=false): in it, j k Home End move its selection (the preview follows), ⏎ opens, alt+⏎ opens in a new detail, / filters its rows, esc comes out, and any other key leaves it and does what it does in the reader. list= which list. The person's: an agent reads it with list.blocks, picks with list.pick and opens a row with list.open",
    keys: "⏎ or a click on the frame's ⏎ in; esc, or a click outside it, comes out",
    touches: "tile", replay: "safe", person: "going into a list is the person's; an agent reads it with list.blocks, picks with list.pick and opens a row with list.open",
    args: {
      list: LIST_ARG,
      on: { type: "boolean", optional: true, about: "true goes in (the default), false comes out" },
    },
    examples: [
      { act: "list.enter on=true", does: "goes into the list, so j and k move its selection" },
      { act: "list.enter on=false", does: "comes out of the list, back to the reader's keys" },
    ],
    run({ list, on }, { host }) {
      const l = listNamed(host, list), into = on ?? !l.entered;
      host.enter(l, into);
      host.redraw();
      return { list: l.n, title: l.title, entered: into };
    },
  }),
});
