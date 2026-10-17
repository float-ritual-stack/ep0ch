import { AsyncLocalStorage } from "node:async_hooks";
import { actionLine, type ActRequest } from "@ep0ch/outline-core/action-line";
import type { Ctx } from "./app";
import { USER } from "./socket";
import { ActionRefused, actionSet, def, type Replay } from "./surface/actions";

/** The session owns the recording; each dispatcher contributes only its completed person actions. */
export class MacroRecording {
  private saving = false;
  private readonly inside = new AsyncLocalStorage<boolean>();
  private recording: { name: string; near?: string; steps: { line: string; replay: Replay; finished: Promise<boolean> }[] } | null = null;
  get active() { return this.recording !== null; }

  start(name: string, near?: string) {
    if (this.saving) throw new ActionRefused("The previous recording is saving; keep working, then macro.record starts the next one");
    if (this.recording) throw new ActionRefused("Already recording; macro.stop saves it first");
    this.recording = { name, near, steps: [] };
    return { recording: name };
  }

  run(req: ActRequest, replay: Replay, work: () => unknown): unknown {
    // Palette navigation and its screen-list lookup are not commands; composed actions record only their outer command.
    if (!this.recording || req.action === "screen.list" || /^(macro\.|bar\.)/.test(req.action) || this.inside.getStore()) return work();
    let finish!: (ok: boolean) => void;
    const finished = new Promise<boolean>(resolve => { finish = resolve; });
    this.recording.steps.push({ line: actionLine(req), replay, finished });
    return this.inside.run(true, () => {
      try {
        const out = work();
        if (out instanceof Promise) return out.then(value => { finish(true); return value; }, error => { finish(false); throw error; });
        finish(true);
        return out;
      } catch (error) { finish(false); throw error; }
    });
  }

  async stop(ctx: Ctx) {
    const recording = this.recording;
    if (!recording) throw new ActionRefused("Nothing is recording; macro.record starts a recording");
    this.recording = null;
    this.saving = true;
    const finished = await Promise.all(recording.steps.map(s => s.finished));
    const lines = recording.steps.filter((_, i) => finished[i]).map(s => s.line);
    const replay = recording.steps.some((s, i) => finished[i] && s.replay === "ask") ? "Includes actions that write or reach outside the door. Run explicitly from the power bar." : "Recorded actions are safe to replay.";
    const body = lines.join("\n");
    const fence = "`".repeat(Math.max(3, ...[...body.matchAll(/`+/g)].map(m => m[0].length + 1)));
    const text = `${recording.name} [script::${recording.name}] [effects::write]\n${replay}\n\n${fence}actions\n${body}\n${fence}`;
    try {
      const saved = await ctx.board.newNote(text, recording.near, USER);
      ctx.flash(`Saved ${recording.name} · ${lines.length} actions · ((${saved.note.id})) · run it from ^K`);
      return { block: saved.note.id, actions: lines.length };
    } catch (error) {
      this.recording = recording;
      throw error;
    } finally { this.saving = false; }
  }
}

export const MACRO_ACTIONS = actionSet<{ ctx: Ctx; recording: MacroRecording }>()("macros", {
  "macro.record": def({
    summary: "record your actions into an editable script; macro.stop saves it beside the note in front",
    keys: "alt+Q (when not recording), or ^K then macro.record; a click on the status bar's ⇧⌥Q or its power bar row",
    touches: "nothing", replay: "ask", person: "A recording belongs to the person; an agent writes a [script::] block instead",
    args: { name: { type: "string", optional: true, about: "script name; default: a timestamped recording, editable after saving" } },
    run({ name }, { ctx, recording }) {
      const result = recording.start(name ?? `recording-${Date.now()}`, ctx.noteInFront?.() ?? undefined);
      ctx.flash(`Recording ${result.recording} · alt+Q or macro.stop saves it`);
      return result;
    },
  }),
  "macro.stop": def({
    summary: "stop recording and save its action lines in a [script::] block; edit argument values to {{props.slot}} to fill them at replay",
    keys: "alt+Q (while recording), or ^K then macro.stop; a click on REC stop or its power bar row",
    touches: "nothing", replay: "ask", person: "Only the person stops their recording",
    args: {}, run(_, { ctx, recording }) { return recording.stop(ctx); },
  }),
});
