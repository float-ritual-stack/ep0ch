// callout.*: a callout's type, chosen from the outline's types (PIE-538), and its undo.
import { CALLOUT_ARGS, type On } from "./shared";
import { RECORDED_AS } from "../../socket";
import { calloutBlocks } from "@ep0ch/outline-core/callouts";
import { calloutProblems, calloutsOf } from "../../callouts";
import { readerKeys } from "../reader-keys";
import { type ActionDef, ActionRefused, def } from "../actions";

export const CALLOUT_DEFS = {
  "callout.list": def({
    summary: "list the note's callouts (PIE-538), outermost first in reading order: line, type, title, whether it starts folded and whether it's folded here; and the outline's callout types (the built-ins and those its notes declare with [callout-type::name])",
    touches: "nothing", replay: "safe",
    args: {},
    async run(_, { surface }) {
      const m = await surface.whole(), types = calloutsOf(surface.src);
      return {
        callouts: surface.calloutsIn(m).map((c, i) => ({ n: i + 1, line: c.line + 1, type: c.type, known: !!types.resolve(c.type), title: calloutBlocks([c.header])[0]?.title || types.style(c.type).title, starts: c.fold === "-" ? "folded" : "open", folded: !!c.foldKey && surface.folded.has(c.foldKey) })),
        types: types.types.map(t => ({ name: t.name, title: t.title, icon: t.icon, tone: t.tone, aliases: t.aliases, ...(t.block ? { declaredIn: t.block } : {}) })),
        problems: surface.src ? calloutProblems(surface.src.board) : [],
      };
    },
  }),
  "callout.menu": def({
    summary: "open a callout's type choice under its top edge, as ⏎ or a click on its icon or type does (the person's; an agent uses callout.type and callout.start)",
    keys: "⏎ or a click on a callout's icon or type",
    touches: "tile", replay: "safe", person: "the type choice is the person's; an agent changes a callout with callout.type or callout.start",
    args: CALLOUT_ARGS,
    examples: [
      { act: "callout.menu n=1", does: "opens the type choice under the first callout's top edge" },
    ],
    async run(which, { surface, host }, actor) {
      const c = await surface.calloutNamed(which, actor);
      surface.requireDrawn();
      const e = surface.calloutElement(c);
      if (!e) throw new ActionRefused("that callout's icon isn't drawn here (it's inside a folded callout or section; unfold it first)");
      surface.openCalloutPicker(e);
      host.redraw();
      return { open: true, callout: e.label, types: calloutsOf(surface.src).types.map(t => t.name) };
    },
  }),
  "callout.type": def({
    summary: "change a callout's type (PIE-538): its header's [!type] rewritten through the note's save, checked against the revision read now and the header as drawn, recorded as whoever asks and said on screen; ctrl+z (callout.undo) puts it back. to= is any type the outline has (callout.list), or a new name",
    keys: [{ keys: "⏎ click", does: "opens the type choice, on a callout's icon or type" }, { keys: "⏎", does: "in the type choice picks it" }],
    touches: "draft", draft: "write", replay: "ask", answer: RECORDED_AS,
    args: { ...CALLOUT_ARGS, to: { type: "string", about: "the type to write: a name or alias the outline has (callout.list), or a new name" } },
    examples: [
      { act: "callout.type n=1 to=warning", does: "rewrites the first callout's header to [!warning]" },
      { act: "callout.type line=12 to=tip", does: "changes the callout whose header is on line 12 to a tip" },
    ],
    async run({ to, ...which }, { surface, host }, actor) {
      const name = to.trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(name)) throw new ActionRefused(`to is a type's name (letters, digits, - and _), not ${JSON.stringify(to)}`);
      const c = await surface.calloutNamed(which, actor);
      return surface.changeCallout(c, { type: name }, host, actor);
    },
  }),
  "callout.start": def({
    summary: "make a callout start folded (folded=true writes [!type]-) or open (folded=false writes [!type]+): the one change to the text that folding ever makes, through the note's save like callout.type. Folding it in a reader is fold or f, which never writes",
    keys: [{ keys: "- +", does: "in the type choice" }],
    touches: "draft", draft: "write", replay: "ask", answer: RECORDED_AS,
    args: { ...CALLOUT_ARGS, folded: { type: "boolean", about: "true: it starts folded (-); false: it starts open (+)" } },
    examples: [
      { act: "callout.start n=2 folded=true", does: "makes the second callout start folded, writing [!type]-" },
      { act: "callout.start n=2 folded=false", does: "makes the second callout start open, writing [!type]+" },
    ],
    async run({ folded, ...which }, { surface, host }, actor) {
      const c = await surface.calloutNamed(which, actor);
      return surface.changeCallout(c, { fold: folded ? "-" : "+" }, host, actor);
    },
  }),
  "callout.undo": def({
    summary: "undo the last callout change (type or start) made in this reader while reading this note (an agent undoes its own, the person theirs); refused if the callout changed again since",
    keys: readerKeys("callout.undo", { via: "when a callout change was the last change made here" }),
    touches: "draft", draft: "write", replay: "ask", answer: RECORDED_AS,
    args: {},
    run: (_, { surface, host }, actor) => surface.undoCallout(host, actor),
  }),
} satisfies Record<string, ActionDef<any, On>>;
