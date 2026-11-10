import { commandButton } from "../bar/command";
import type { DraftSession } from "../draft-session";
import { recordedAnswer, type Actor } from "../socket";
import { partyOf } from "../steps";
import { ActionRefused } from "./actions";
import type { NoteSurface, SurfaceHost } from "./note";

/** Buttons and render-script lines share the cursor placement rule and one draft undo step. */
async function pasteLine(text: string, session: DraftSession, actor: Actor) {
  const d = session.draft;
  // Source line zero is the title; inserted parts belong below it.
  if (d.row === 0) d.place(0, d.lines[0]!.length);
  const at = d.offsetOf(d.row, d.col), before = d.text.slice(0, at), after = d.text.slice(at);
  const prefix = before && !before.endsWith("\n") ? "\n" : "";
  const line = d.row + (prefix ? 1 : 0);
  const inserted = prefix + text + (after && !after.startsWith("\n") ? "\n" : "");
  await session.act("draft.paste", { text: inserted }, actor);
  return { line, start: at, inserted };
}

export async function insertButton(line: string, surface: NoteSurface, host: SurfaceHost, actor: Actor) {
  const button = commandButton(line), session = await surface.ensureDraft(host);
  if (session.openedBy.kind !== "user") throw new ActionRefused("this draft belongs to an agent; open your own edit first");
  await pasteLine(button, session, actor);
  host.redraw();
  return { inserted: button, dirty: session.dirty };
}

export async function insertNoteLine(text: string, surface: NoteSurface, host: SurfaceHost, actor: Actor) {
  const block = surface.requireNote().id, editing = !!surface.draft;
  const session = await surface.ensureDraft(host), keepDraft = editing || session.dirty;
  const { line, start, inserted } = await pasteLine(text, session, actor);
  if (!keepDraft) {
    // Run explicitly inserts this line; handler lines also read as properties. No earlier draft is being saved.
    const saved = await session.submit(actor, false, true);
    if (!saved.ok) throw new ActionRefused(saved.why);
    // The save closes the draft, so the reader must own the insertion's undo from here.
    surface.sourceHistory.push({ block, edits: [{ line, before: "", after: inserted }], patch: { start }, by: partyOf(actor), context: block });
  }
  surface.noteAgent(actor, "inserted a line");
  host.redraw();
  // Saved here only when no draft was open: this actor's line alone. Into an open draft, nothing is recorded yet.
  return { block, line, dirty: session.open && session.dirty, ...(keepDraft ? {} : { recordedAs: recordedAnswer(actor) }) };
}
