// note.move, note.route and note.move.undo: moving the note shown under another (src/note-move.ts owns the move).
import type { On } from "./shared";
import { ATTACHED_KEYS } from "../attached-keys";
import { RECORDED_AS } from "../../socket";
import { askInBar } from "../../bar/ask";
import { intentOf, type MoveArgs, moveNote, moveQuestion, routeNote, undoMove } from "../../note-move";
import { modeActionKeys } from "../modes";
import { readerKeys } from "../reader-keys";
import { type ActionDef, ActionRefused, asActor, def } from "../actions";

/**
 * note.move as every set that mounts it says it (PIE-1672): one summary, one set of arguments, its keys from the one key
 * table (REORDER_KEYS). A reader runs it on the note it shows (MOVE_DEFS, here), a list on its lit row (LIST_ACTIONS).
 */
export const NOTE_MOVE = {
  summary: "move a note (PIE-943; PIE-883's note.place is this with to=): the one shown (a list's: its lit row), or id=, under a note (to= inbox, root, or a note's id, ((ref)), [[page]], Work ID; position= its place among the children, from 1, default first), beside a sibling (before= or after=) or one step in its list (step= up, down, in under the note above, out after its parent). The service's move, the note checked at revision= when given (one changed since is refused), recorded as whoever asks and put back by ctrl+z (note.move.undo). The person's, left out, is asked in the power bar (\"Move to…\"): the note's parents and the notes changed lately first, the Inbox, then any note by its words. An agent's goes by outline_move's rules (the outliner's moveBlock)",
  keys: modeActionKeys(ATTACHED_KEYS, "note.move"),
  touches: "nothing", replay: "ask", answer: RECORDED_AS,
  says: (r: unknown) => String((r as { said?: string }).said ?? "moved a note"),
  args: {
    id: { type: "string", optional: true, about: "the note to move (default: the one shown, or a list's lit row)" },
    to: { type: "string", optional: true, about: "the note to put it under: inbox, root (the top level), or an id, ((ref)), [[page]] or Work ID" },
    before: { type: "string", optional: true, about: "a sibling to go just above" },
    after: { type: "string", optional: true, about: "a sibling to go just below" },
    position: { type: "number", optional: true, about: "with to=: its place among the children, from 1 (default: first)" },
    step: { type: "string", optional: true, about: "up or down one place among its siblings, in (last under the sibling above) or out (right after its parent)" },
    revision: { type: "number", optional: true, about: "the note's revision as you read it; a note changed since is refused" },
  },
  examples: [
    { act: "note.move tile=reader to=inbox", does: "moves the note the reader shows under the inbox, first among its children" },
    { act: "note.move id=7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34 after=3e8b2c71-9d40-4f6a-b1e5-2a7c9f0d4b18", does: "moves that note to just below the other, its sibling" },
  ],
} as const;
/** note.move.undo as every set that mounts it says it (PIE-1672). */
export const NOTE_MOVE_UNDO = {
  summary: "put the note shown (a list's: the one it moved last) back where the last move made here (by you) took it from",
  keys: modeActionKeys(ATTACHED_KEYS, "note.move.undo"), touches: "nothing", replay: "ask", answer: RECORDED_AS,
  args: { id: { type: "string", optional: true, about: "the moved note; default the one shown, or the one a list moved last" } },
  examples: [
    { act: "note.move.undo", does: "puts the note shown back where your last move took it from" },
    { act: "note.move.undo id=7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34", does: "puts that note back where your last move took it from" },
  ],
} as const;

export const MOVE_DEFS = {
  "note.move": def({
    ...NOTE_MOVE,
    menu: { label: "move to…", group: "note", key: "Z", now: (_h, t) => (t.kind === "river.column" ? { hide: true } : null) },
    async run(args, { surface, host }, actor) {
      const id = args.id ?? surface.requireNote().id;
      const revision = args.revision ?? (surface.msg?.id === id ? surface.msg.revision : undefined);
      const asked = [args.to, args.before, args.after, args.step].some(x => x !== undefined);
      const run = async (a: MoveArgs) => {
        const done = await moveNote(host.ctx.board, id, intentOf(a), actor, { revision });
        if (surface.replyLinks) await surface.openReplyLinks(host, { kind: "user" }, true);
        // The reader showing it reads its place again; the person's is told where it went.
        if (surface.msg?.id === id) {
          const fresh = await host.ctx.board.get(id).catch(() => null);
          if (fresh) surface.refresh(fresh);
          await surface.rereadPlace(host);
        }
        asActor(host.ctx, actor).flash(done.said);
        surface.noteAgent(actor, done.said);
        return done;
      };
      if (asked) return run(args);
      if (actor.kind === "agent") throw new ActionRefused("say where: to=<inbox, root, or a note's id, ((ref)), [[page]], Work ID>, before=, after= or step=up|down|in|out");
      return askInBar(host.ctx as never, "Move the note", [moveQuestion(id)], {}, actor, answers => run({ ...args, to: answers.to! }));
    },
  }),
  "note.route": def({
    summary: "route a note by the outline's note mover rules (PIE-1010): the one shown, or id=. The first rule note ([note-mover::((id))] [query::…], listed in the Note mover view) whose query holds for it moves it there, by the service's one move, as ext:note-mover with you recorded as who asked, in one revision; ctrl+z puts it back (note.move.undo). dry=true says what would move where and why (which rule) and moves nothing; a note no rule holds for is said so, and a rule that can't be used is named. A note being written in a door is never moved under the person: it routes when the draft closes",
    keys: [...readerKeys("note.route"), { via: "the tile menu's \"route by rules\"" }],
    touches: "nothing", replay: "ask",
    menu: { label: "route by rules", group: "note", key: "alt+z", now: (_h, t) => (t.kind === "river.column" ? { hide: true } : null) },
    says: r => String((r as { said?: string }).said ?? "routed a note"),
    args: {
      id: { type: "string", optional: true, about: "the note to route (default: the one shown)" },
      dry: { type: "boolean", optional: true, about: "say what would move where and why, moving nothing" },
    },
    examples: [
      { act: "note.route dry=true", does: "says where the note shown would move and which rule, moving nothing" },
      { act: "note.route", does: "moves the note shown by the first note mover rule that holds for it" },
    ],
    async run({ id, dry }, { surface, host }, actor) {
      const target = id ?? surface.requireNote().id;
      const done = await routeNote(host.ctx.board, target, actor, { dryRun: dry === true });
      if (done.outcome === "moved") {
        if (surface.replyLinks) await surface.openReplyLinks(host, { kind: "user" }, true);
        if (surface.msg?.id === target) {
          const fresh = await host.ctx.board.get(target).catch(() => null);
          if (fresh) surface.refresh(fresh);
          await surface.rereadPlace(host);
        }
      }
      asActor(host.ctx, actor).flash(done.said);
      surface.noteAgent(actor, done.said);
      host.redraw();
      return done;
    },
  }),
  "note.move.undo": def({
    ...NOTE_MOVE_UNDO,
    async run({ id }, { surface, host }, actor) {
      const m = surface.requireNote();
      const target = id ?? m.id;
      const done = await undoMove(host.ctx.board, actor, target);
      const fresh = await host.ctx.board.get(m.id).catch(() => null);
      if (fresh) surface.refresh(fresh);
      if (surface.replyLinks) await surface.openReplyLinks(host, { kind: "user" }, true);
      await surface.rereadPlace(host);
      asActor(host.ctx, actor).flash(done.said);
      return done;
    },
  }),
} satisfies Record<string, ActionDef<any, On>>;
