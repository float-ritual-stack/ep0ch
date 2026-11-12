// Checklist steps (PIE-472: tasks, task.*) and ::use (use.fill, use.undo), and fields.anchor.
import { RECORDED_AS } from "../../socket";
import { parseStatus, STEP_CHOICES } from "../../steps";
import { readerKeys } from "../reader-keys";
import { type ActionDef, ActionRefused, def } from "../actions";
import { type On, STEP_ARGS } from "./shared";

export const TASK_DEFS = {
  "tasks": def({
    summary: "list the checklist steps this reader draws, in the note and inside its embeds (anchored ones too), in reading order: status, id, the note each is in",
    reads: true, touches: "nothing", replay: "safe",
    args: {},
    async run(_, { surface }) {
      await surface.whole();
      surface.requireDrawn();
      return { steps: surface.describeSteps() };
    },
  }),
  "task.status": def({
    summary: "set a checklist step's status (done, todo, waiting, problem, approved, rejected: approved is the person's yes) through checklist.update, checked against the step as it was read; recorded as whoever asks (an agent by its id) and said on screen. Works on steps inside embeds: the change is to the note the step is in",
    keys: [{ keys: "[ ]", does: "to a step" }, { keys: "⏎ click", does: "on its box opens the status choice" }, { keys: "x o + - w !", does: "set the status in the choice" }, ...readerKeys("task.status"), { via: "with no step named, the person's: the status choice open, else the step that is the current element" }],
    touches: "draft", draft: "write", replay: "ask", answer: RECORDED_AS,
    args: { ...STEP_ARGS, to: { type: "string", about: "done, todo, waiting, problem, approved or rejected (or a box's mark: x, space, ~, !, ✓ or +, ✗ or -)" } },
    examples: [
      { act: "task.status n=2 to=done", does: "marks the second checklist step done" },
      { act: "task.status id=t-8a6d7f to=waiting", does: "sets the step with that id to waiting" },
    ],
    async run({ to, ...which }, { surface, host }, actor) {
      const status = parseStatus(to);
      if (!status) throw new ActionRefused(`to is done, todo, waiting, problem, approved or rejected, not ${JSON.stringify(to)}`);
      const e = surface.stepFor(which, actor) ?? (await surface.whole(), surface.stepNamed(which));
      return surface.changeStep(e.task!, status, host, actor);
    },
  }),
} satisfies Record<string, ActionDef<any, On>>;

export const TASK_UNDO_DEFS = {
  "task.undo": def({
    summary: "undo the last step status change made in this reader while reading this note (an agent undoes its own, the person theirs); refused if the step changed again since",
    keys: readerKeys("task.undo"),
    touches: "draft", draft: "write", replay: "ask", answer: RECORDED_AS,
    args: {},
    run: (_, { surface, host }, actor) => surface.undoStep(host, actor),
  }),
  "task.link": def({
    summary: "a step's link ((note^id)), giving the step a stable id first if it has none; the person's copies it to their clipboard, an agent's is returned. copy=false only gives the step its id (Make addressable)",
    keys: [{ keys: "y", does: "in the status choice: Copy step link" }, { keys: "a", does: "in the status choice: Make addressable" }],
    touches: "draft", draft: "write", replay: "ask", answer: RECORDED_AS,
    args: { ...STEP_ARGS, copy: { type: "boolean", optional: true, about: "false: only give the step a stable id, copying nothing" } },
    examples: [
      { act: "task.link n=2", does: "gives the second step an id if it has none and returns its link" },
      { act: "task.link n=2 copy=false", does: "only gives the second step a stable id, copying nothing" },
    ],
    async run({ copy, ...which }, { surface, host }, actor) {
      const e = surface.stepFor(which, actor) ?? (await surface.whole(), surface.stepNamed(which));
      return surface.changeStep(e.task!, copy === false ? "address" : "copy-link", host, actor);
    },
  }),
  "use.fill": def({
    words: "fill in what a ::use template asks for",
    summary: "give a ::use the props its template needs (PIE-533): the person is asked for each in the power bar, in the picker of its kind (a choice's options, a note found by its words), then the answers are written onto the call's line through the note's save, checked against the line as drawn, recorded as whoever asks; ctrl+z (use.undo) takes them back. An agent names them: with='{\"owner\":\"ada\"}' (it is never asked, and its fill never takes the person's focus). line= which ::use (from 1; default: the only one)",
    keys: "⏎ or a click on a ::use's “needs …” line",
    touches: "draft", draft: "write", replay: "ask", answer: RECORDED_AS,
    args: {
      block: { type: "string", optional: true, about: "the note the ::use is written in, when it is drawn inside this one (an embed, a template): default the note shown" },
      line: { type: "number", optional: true, about: "the line of the ::use, from 1 (default: the only one the note has)" },
      with: { type: "string", optional: true, about: "the props to write, as JSON: names to text (an agent's; the person is asked for the rest)" },
    },
    examples: [
      { act: "use.fill line=9 with='{\"owner\":\"ada\"}'", does: "writes owner=ada onto the ::use on line 9, which needs it" },
    ],
    async run({ block, line, with: w }, { surface, host }, actor) {
      let given: Record<string, string> = {};
      if (w !== undefined) {
        let v: unknown;
        try { v = JSON.parse(w); } catch { throw new ActionRefused("with= is JSON: the props to write, names to text; for example with='{\"owner\":\"ada\"}'"); }
        if (!v || typeof v !== "object" || Array.isArray(v) || Object.values(v).some(x => typeof x !== "string")) throw new ActionRefused("with= maps names to text; for example with='{\"owner\":\"ada\"}'");
        given = v as Record<string, string>;
      }
      return surface.fillUse(block, line, given, host, actor);
    },
  }),
} satisfies Record<string, ActionDef<any, On>>;

export const USE_DEFS = {
  "use.undo": def({
    summary: "undo the last use.fill made in this reader while reading this note (an agent undoes its own, the person theirs); refused if the ::use line changed again since",
    keys: readerKeys("use.undo", { via: "when a ::use fill was the last change made here" }),
    touches: "draft", draft: "write", replay: "ask", answer: RECORDED_AS,
    args: {},
    run: (_, { surface, host }, actor) => surface.undoUse(host, actor),
  }),
  "fields.anchor": def({
    words: "give the line an anchor other notes can link to",
    summary: "give the line a ::fields row opens an anchor, so ((note^anchor)) links to that line for good (it works on the web too); the person's copies the link, an agent's is returned. The only thing a ::fields writes, and only when asked: key= which ::fields (its key; default the only one the note draws), n= its row (from 1)",
    keys: "⏎ or a click on a ::fields row's ¶",
    touches: "draft", draft: "write", replay: "ask", answer: RECORDED_AS,
    args: {
      key: { type: "string", optional: true, about: "which ::fields: its key (default the only one the note draws)" },
      n: { type: "number", optional: true, about: "the row, from 1 (default 1)" },
    },
    examples: [
      { act: "fields.anchor n=2", does: "anchors the line of the second ::fields row and returns its link" },
      { act: "fields.anchor key=beds n=1", does: "anchors the first row of the ::fields keyed beds" },
    ],
    async run({ key, n }, { surface, host }, actor) {
      return surface.anchorField(key, n ?? 1, host, actor);
    },
  }),
  "task.menu": def({
    summary: "open a step's status choice under its box, as ⏎ or a click does (the person's; an agent uses task.status)",
    keys: "⏎ or a click (or right-click) on a step's box",
    touches: "tile", replay: "safe", person: "the status choice is the person's; an agent sets a step with task.status",
    args: STEP_ARGS,
    examples: [
      { act: "task.menu n=3", does: "opens the status choice under the third step's box" },
    ],
    async run(which, { surface, host }, actor) {
      const e = surface.stepFor(which, actor) ?? (await surface.whole(), surface.stepNamed(which));
      surface.openPicker(e);
      host.redraw();
      // The choices as the panel draws them: on a live row, each says what it writes.
      return { open: true, step: e.task!.step.itemId ?? null, choices: (surface.picker?.list.items ?? STEP_CHOICES).map(c => ({ id: c.id, key: c.key, label: c.label })) };
    },
  }),
} satisfies Record<string, ActionDef<any, On>>;
