import { AsyncLocalStorage } from "node:async_hooks";
import { actionLine, type ActRequest } from "@ep0ch/outline-core/action-line";
import { BLOCK_ID_PATTERN } from "@ep0ch/outline-core/addressable-resource";
import { titleOf } from "@ep0ch/outline-core/query-expression";
import type { Ctx } from "./app";
import { USER } from "./socket";
import { scriptNamed } from "./extensions";
import { ActionRefused, actionSet, def, type RecordStep, type Replay } from "./surface/actions";

/** A step the person took while recording: the line it saves once it finished (null: it failed, or saves nothing). */
interface Step { replay: Replay; finished: Promise<string | null>; tile?: string }

/** The session owns the recording; each dispatcher contributes only its completed person actions. */
export class MacroRecording {
  private saving = false;
  /** The names this door's recordings were saved under. */
  private readonly names = new Set<string>();
  private readonly inside = new AsyncLocalStorage<boolean>();
  private recording: { name?: string; near?: string; since: number; keys?: "screen" | "host"; steps: Step[] } | null = null;
  get active() { return this.recording !== null; }

  /** Unnamed, it's named when it stops, for what it did (`comment-on-planting-checklist`): never by a timestamp. */
  start(name: string | undefined, near?: string, keys?: "screen" | "host") {
    if (this.saving) throw new ActionRefused("The previous recording is saving; keep working, then macro.record starts the next one");
    if (this.recording) throw new ActionRefused("Already recording; macro.stop saves it first");
    this.recording = { name, near, since: Date.now(), ...(keys ? { keys } : {}), steps: [] };
    // Unnamed, the name comes when it stops (macro.stop answers it as `script`).
    return name ? { recording: name } : {};
  }

  /** `records`: the line a finished step saves, as its action says (ActionDef.record); left out, the step as pressed. */
  run(req: ActRequest, replay: Replay, work: () => unknown, records?: RecordStep): unknown {
    // Palette navigation and its screen-list lookup are not commands; composed actions record only their outer command.
    if (!this.recording || req.action === "screen.list" || /^(macro\.|bar\.)/.test(req.action) || this.inside.getStore()) return work();
    const { since, keys } = this.recording;
    let finish!: (line: string | null) => void;
    // The line is settled when the step finishes: what the person typed exists only then (the comment they sent).
    const finished = new Promise<string | null>(resolve => { finish = resolve; });
    const settle = (out: unknown) => {
      if (!records) return finish(actionLine(req));
      const as = records({ action: req.action, args: req.args ?? {}, out, since, ...(keys ? { keys } : {}) });
      finish(as && actionLine({ ...as, ...(req.tile !== undefined ? { tile: req.tile } : {}) }));
    };
    this.recording.steps.push({ replay, finished, ...(req.tile !== undefined ? { tile: req.tile } : {}) });
    return this.inside.run(true, () => {
      try {
        const out = work();
        if (out instanceof Promise) return out.then(value => { settle(value); return value; }, error => { finish(null); throw error; });
        settle(out);
        return out;
      } catch (error) { finish(null); throw error; }
    });
  }

  async stop(ctx: Ctx) {
    const recording = this.recording;
    if (!recording) throw new ActionRefused("Nothing is recording; macro.record starts a recording");
    this.recording = null;
    this.saving = true;
    const finished = await Promise.all(recording.steps.map(s => s.finished));
    const lines = finished.filter((line): line is string => line !== null);
    // Nothing to replay is no script: one with an empty fence only fails to load.
    if (!lines.length) { this.saving = false; ctx.flash("Nothing recorded · no script saved · alt+Q records again"); return { actions: 0, saved: false }; }
    const replay = recording.steps.some((s, i) => finished[i] !== null && s.replay === "ask") ? "Includes actions that write or reach outside the door. Run explicitly from the power bar." : "Recorded actions are safe to replay.";
    // The notes its steps write on (the dispatcher names a comment's or an edit's note by its id, PIE-1725): said in the
    // note and the flash, so the person knows the replay lands there, not on whatever the tile shows then.
    const notes = [...new Set(recording.steps.filter((s, i) => finished[i] !== null && s.tile && BLOCK_ID_PATTERN.test(s.tile)).map(s => s.tile!))];
    const titled = await Promise.all(notes.map(id => ctx.board.get(id).then(m => ({ id, title: m ? titleOf(m.text) : id }), () => ({ id, title: id }))));
    const lands = titled.length ? `Acts on ${titled.map(n => `((${n.id}|${n.title.replace(/[|)]/g, " ")}))`).join(", ")}, in whichever tile shows it when it runs.` : "";
    const body = lines.join("\n");
    const actions = [...new Set(lines.map(line => line.split(/\s/)[0]!))];
    // Named for what it does (PIE-1727): its actions and the note they land on, `comment-on-planting-checklist`, short
    // enough to read whole in the flash and to type the start of in ^K. A second of the same takes the next number.
    const does = whatItDoes(actions, titled.find(n => n.title !== n.id)?.title);
    // A name an action has (`comment`, a recording of one comment with no note) would never run it: typed, the action wins.
    const plain = slugOf(does), base = recording.name ?? (ctx.dispatch?.has(plain) ? `recorded-${plain}` : plain);
    let name = base;
    for (let n = 2; !recording.name && (this.names.has(name) || scriptNamed(name).length); n++) name = `${base}-${n}`;
    this.names.add(name);
    const title = recording.name ?? `Recorded: ${does.replace(/[[\]]/g, " ").replace(/\s+/g, " ").trim()}`;
    const fence = "`".repeat(Math.max(3, ...[...body.matchAll(/`+/g)].map(m => m[0].length + 1)));
    const text = `${title} [script::${name}] [effects::write]\n${replay}${lands ? ` ${lands}` : ""}\n\n${fence}actions\n${body}\n${fence}`;
    try {
      const saved = await ctx.board.newNote(text, recording.near, USER);
      const on = titled.length ? ` · acts on ${titled.map(n => `“${n.title}”`).join(", ")}` : "";
      // Its name and how to run it first, where a narrow status bar still shows them; the rest after (PIE-1727).
      ctx.flash(`Saved ${name} · run it from ^K${on} · ${lines.length} action${lines.length === 1 ? "" : "s"} · ((${saved.note.id}))`, 12_000);
      return { block: saved.note.id, actions: lines.length, script: name };
    } catch (error) {
      this.recording = recording;
      throw error;
    } finally { this.saving = false; }
  }
}

/**
 * What a recording does, in words (PIE-1727): its actions' first words (`comment`, `threads and comment`), then the note
 * they land on (`on Planting checklist`); with no note, its actions as named (`tile split then tile focus`).
 */
export function whatItDoes(actions: readonly string[], on: string | undefined): string {
  const words = (list: string[], join: string) => list.length > 2 ? `${list.slice(0, 2).join(join)} and ${list.length - 2} more` : list.join(join);
  if (on) return `${words([...new Set(actions.map(a => a.split(".")[0]!))], " and ")} on ${on.trim()}`;
  return words(actions.map(a => a.replace(/\./g, " ")), " then ");
}

/** A script name from those words: lower case, dashes between, at most 40 characters cut at a dash; never empty. */
export function slugOf(words: string): string {
  const slug = words.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const cut = slug.length > 40 ? slug.slice(0, 41).replace(/-[^-]*$/, "") || slug.slice(0, 40) : slug;
  return cut || "recorded";
}

export const MACRO_ACTIONS = actionSet<{ ctx: Ctx; recording: MacroRecording }>()("macros", {
  "macro.record": def({
    summary: "record your actions into an editable script; macro.stop saves it beside the note in front",
    keys: [{ keys: "alt+Q", does: "when not recording" }, { via: "^K then macro.record in the power bar" }, { keys: "click", does: "on the status bar's ⇧⌥Q or its power bar row" }],
    touches: "nothing", replay: "ask", person: "A recording belongs to the person; an agent writes a [script::] block instead",
    args: { name: { type: "string", optional: true, about: "script name; default: named for what it did when it stops (comment-on-planting-checklist, -2 for a second of the same), editable after saving" } },
    examples: [
      { act: "macro.record", does: "starts recording your actions, named after them when it stops" },
      { act: "macro.record name=seed-swap-setup", does: "starts recording your actions into a script named seed-swap-setup" },
    ],
    run({ name }, { ctx, recording }) {
      const result = recording.start(name, ctx.noteInFront?.() ?? undefined, ctx.person?.().keys);
      ctx.flash(`Recording${name ? ` ${name}` : ""} · alt+Q or macro.stop saves it`);
      return result;
    },
  }),
  "macro.stop": def({
    summary: "stop recording and save its action lines in a [script::] block (nothing recorded saves nothing, and says so); edit argument values to {{props.slot}} to fill them at replay",
    keys: [{ keys: "alt+Q", does: "while recording" }, { via: "^K then macro.stop in the power bar" }, { keys: "click", does: "on REC stop or its power bar row" }],
    touches: "nothing", replay: "ask", person: "Only the person stops their recording",
    args: {}, run(_, { ctx, recording }) { return recording.stop(ctx); },
  }),
});
