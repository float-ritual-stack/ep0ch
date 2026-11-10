// button.pin, button.press and button.slot: a note's ::button (and a view's pressable square) pressed, its slot written,
// or pinned to the status bar. The press itself is the surface's (runPress, askSlots, setButtonSlot).
import type { On } from "./shared";
import { noteRow } from "./shared";
import { readerKeys } from "../reader-keys";
import { RECORDED_AS } from "../../socket";
import { messageContext } from "../../status-log";
import { readNote } from "../../desk/outline-boards";
import { linkOccurrences } from "@ep0ch/outline-core/link-syntax";
import { drawingPending, drawnPresses, mayHaveProjections } from "../../projection";
import { BUTTON_GROUP } from "../../note-ref";
import { buttonCallsOf } from "@ep0ch/outline-core/button-call";
import { type ActionDef, ActionRefused, def } from "../actions";

export const BUTTON_DEFS = {
  "button.pin": def({
    summary: "pin to status bar: append this note's selected ::button to your [status-bar::true] note; label= picks a button by its exact label, or a note with one button needs no selection",
    touches: "nothing", replay: "ask", answer: RECORDED_AS,
    args: { label: { type: "string", optional: true, about: "the exact label of the ::button to pin; default: selected button, or the note's only one" } },
    keys: [{ via: "a right-click on a button (it becomes the [ ] position, unpressed), then pin to status bar in the tile menu" }],
    examples: [{ act: 'button.pin label="Collapse"', does: "pins the Collapse button from this note to your status bar" }],
    // In the Button group, the menu's first (PIE-1428): about the button the right-click landed on.
    menu: { ...noteRow("pin to status bar", "", { now: ({ surface }) => surface.statusButtonLine() ? null : { hide: true } }), group: BUTTON_GROUP },
    async run({ label }, { surface, host }, actor) {
      await surface.whole();
      const line = surface.statusButtonLine(label);
      if (!line) throw new ActionRefused("select one ::button with [ ], or say button.pin label=<its exact label>");
      return host.ctx.dispatch!.act({ action: "status.bar.pin", args: { line } }, actor);
    },
  }),
  "button.press": def({
    summary: "press a button or a pressable square of a view in this note by its label (or n from elements): a button runs its ordered action taps and script pipe stages as one undo group over reversible effects; a view square runs its action line. The dispatcher attributes whoever asks, and the first sequence failure reports the step and effects that remain. It opens nothing and moves nothing the person is reading, so it works on the reader they hold; tile= names another reader, and note=<id> presses a ::button, an [label](act: …) link or a control a render script drew (a view's button, badge, card or row, from the service's projection) in a note that is open nowhere, with no focus moved",
    keys: readerKeys("button.press", { keys: "click", does: "on a button" }, { keys: "alt+click", does: "a control's alt action (a breadcrumb's reveal)" }), touches: "nothing", replay: "ask",
    args: {
      label: { type: "string", optional: true, about: "the button's label, or part of it (`Fantasia` finds `✦ Fantasia`); the one pressable element that has it" },
      alt: { type: "boolean", optional: true, about: "run the button's alt= action, as alt+click does" },
      n: { type: "number", optional: true, about: "which element, from 1 (elements lists them), when it is a pressable one" },
      line: { type: "number", optional: true, about: "source line from 1, with note=, to press a specific button when labels repeat" },
      note: { type: "string", optional: true, about: "a note to press a button of by its label, whether or not it is open anywhere (a block id or its first 8+ characters, a Work ID or a [[page]]): a ::button, a link, or a control its render script drew; the button's script acts on that note, and a reader's action (comment.note) in a reader showing it, else at the person's own press their focus, else refused: open it first" },
    },
    examples: [
      { act: "button.press label=Water", does: "presses the Water button of this note, as whoever asks" },
      { act: 'button.press note=7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34 label="Water beds"', does: "presses that button of a note open nowhere, moving no focus" },
    ],
    async run({ label, n, note, alt, line }, { surface, host }, actor) {
      if (note !== undefined) {
        if (label === undefined) throw new ActionRefused("note= needs label= (the button's words); open the note in a reader and use elements for n=");
        // Its first 8+ characters, a Work ID or a [[page]] too, as open id= takes them (PIE-1428): the one resolver, readNote's.
        const m = await readNote(host.ctx, note);
        if (!m) throw new ActionRefused(`no note ${note}: button.press note= takes a note's id, its first 8+ characters, a Work ID or a [[page]]`);
        const found: { label: string; act: string; alt?: string; line: number }[] = [];
        for (const c of buttonCallsOf(m.text)) if (c.act || c.problem) found.push({ label: c.label, act: c.act ?? "", alt: c.alt, line: c.line });
        m.text.split("\n").forEach((l, line) => { if (!l.includes("](act:")) return; for (const o of linkOccurrences(l)) if (o.kind === "markdown") { const act = /^act:\s*(\S.*)$/.exec(o.url.trim())?.[1]?.trim(); if (act) found.push({ label: o.text, act, line }); } });
        const want = label.toLowerCase();
        const matching = (list: typeof found) => {
          const exact = list.filter(f => f.label.toLowerCase() === want);
          return (exact.length ? exact : list.filter(f => f.label.toLowerCase().includes(want))).filter(f => line === undefined || f.line === line - 1);
        };
        // Controls a render script drew on the note (a view's button, badge, card or row) are the service's projection of it, so a note open
        // nowhere has them too. Lines still being drawn are waited for (the read itself asks the service to draw them), so which
        // line answers a label never depends on which finished first.
        if (!matching(found).length && mayHaveProjections(m.text)) {
          for (const end = Date.now() + 10_000; ;) {
            const read = await host.ctx.board.request("resources.projection.read", { blockId: m.id, materialize: true }).catch(() => null);
            if (!read) break;
            const drawn = drawnPresses(read);
            if (!drawingPending(read) || Date.now() > end) { found.push(...drawn.filter(d => !found.some(f => f.act === d.act && f.line === d.line && f.label === d.label))); break; }
            await Bun.sleep(150);
          }
        }
        const hits = matching(found);
        if (!hits.length) throw new ActionRefused(`no button says "${label}" in that note; it has ${found.length ? found.map(f => `"${f.label}"`).join(", ") : "none"}. Example: button.press note=${m.id.slice(0, 8)} label="${found[0]?.label ?? "Review"}"`);
        if (hits.length > 1) throw new ActionRefused(`"${label}" matches ${hits.length} buttons of that note (${hits.map(f => `"${f.label}"`).join(", ")}); say more of the label`);
        const hit = hits[0]!, act = alt && hit.alt ? hit.alt : hit.act;
        const r = await surface.runPress({ act, block: m.id, line: hit.line, label: hit.label }, host, actor, !!alt && !hit.alt, { ...(surface.msg?.id === m.id ? { tile: messageContext.getStore()?.tile } : {}), note: m.id, actor }, !!alt && !!hit.alt);
        surface.noteAgent(actor, `pressed ${hit.label} (${act})`);
        return { note: m.id, kind: "control", act, ...(r && typeof r === "object" ? r : {}) };
      }
      await surface.whole();
      surface.requireDrawn();
      if ((label === undefined) === (n === undefined)) throw new ActionRefused("say label= (the button's words) or n= (its number in elements)");
      const all = surface.describeElements();
      const pressable = (i: number) => { const e = surface.element(i + 1); return e.kind === "control" && !!e.link?.press; };
      let hits = n !== undefined ? (n >= 1 && n <= all.length && pressable(n - 1) ? [n] : []) : all.map((_, i) => i + 1).filter(i => pressable(i - 1) && all[i - 1]!.label.toLowerCase().includes(label!.toLowerCase()));
      const exact = hits.filter(i => all[i - 1]!.label.replace(/^\[|\]$/g, "").toLowerCase() === label?.toLowerCase());
      if (exact.length) hits = exact;
      if (!hits.length) {
        const have = all.map((e, i) => ({ e, i: i + 1 })).filter(x => pressable(x.i - 1)).map(x => `${x.i}: ${x.e.label}`);
        throw new ActionRefused(`${n !== undefined ? `element ${n} is not a button` : `no button says "${label}"`} in this note; ${have.length ? `it has ${have.join(", ")}` : "it has none (a button is ::button{label=… act=…} or a view's pressable square)"}. Example: button.press label="${(have[0]?.split(": ")[1] ?? "Review").replace(/^\[|\]$/g, "")}"`);
      }
      if (hits.length > 1) throw new ActionRefused(`"${label}" matches ${hits.length} buttons (${hits.map(i => `${i}: ${all[i - 1]!.label}`).join(", ")}); say n=`);
      const i = hits[0]!, e = surface.element(i), p = e.link!.press!;
      const act = alt && p.alt ? p.alt : p.act;
      const r = await surface.runPress({ ...p, act }, host, actor, !!alt && !p.alt, undefined, !!alt && !!p.alt);
      surface.noteAgent(actor, `pressed ${e.label} (${act})`);
      return { element: i, kind: e.kind, act, ...(r && typeof r === "object" ? r : {}) };
    },
  }),
  "button.slot": def({
    words: "write one slot of a button's sequence",
    summary: "write one slot of a ::button onto its line (PIE-1298): `::button{act=\"tile.zoom tile={target}\" target=}` runs once target= says a tile. The note's checked save, recorded as whoever asks; ctrl+z (sources.undo) takes it back. A tile is kept as its id (t-<uuid>, exactly that tile) or the address of its place (drawer.agent, role:<role>, <slot>@<screen>: whichever tile fills it), never a number. The person, with no value=, is asked (the wire picker for a tile: click one); an agent passes value= and never opens the picker",
    keys: [{ keys: "click", does: "a button with an empty slot, then click a tile" }, { keys: "alt-click", does: "a button with a slot to choose again" }], touches: "nothing", replay: "ask", answer: RECORDED_AS,
    args: {
      note: { type: "string", optional: true, about: "the note the button is written in (a block id; default the one shown)" },
      line: { type: "number", optional: true, about: "the line of the button, from 1 (the note's text; with note=)" },
      label: { type: "string", optional: true, about: "or: the button's label (or part of it); with line=, its whole label: a moved line is found by it, a gone button refused" },
      key: { type: "string", optional: true, about: "the slot (the word on the line a {key} fills); default the first empty one" },
      value: { type: "string", optional: true, about: "what it holds: a tile's name, id or drawer.agent; a note's id; any text. Left out, the person is asked" },
      ask: { type: "boolean", optional: true, about: "after this, ask for the next empty slot of the same button (the person's)" },
      next: { type: "string", optional: true, about: "after this, ask for these slots of the same button, in order (key,key: a re-pick of filled ones)" },
      run: { type: "boolean", optional: true, about: "after the last slot is answered, press the button (the person's press that asked for them)" },
      alt: { type: "boolean", optional: true, about: "the alt press's slot: the value is read as alt='s argument (a slot act= and alt= both read), and with run= its alt= runs" },
    },
    examples: [
      { act: 'button.slot label="pop it" key=target value=drawer.agent', does: "writes target=drawer.agent on the pop it button, so its next press lifts the drawer's agent" },
      { act: "button.slot line=3 key=target", does: "asks the person to choose the tile again for the button on line 3" },
    ],
    run: (a, { surface, host }, actor) => surface.setButtonSlot(a, host, actor),
  }),
} satisfies Record<string, ActionDef<any, On>>;
