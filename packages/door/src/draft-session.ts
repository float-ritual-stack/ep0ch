import { droppedFiles } from "./paste-image";
import type { ReaderPosition } from "./reader-position";
import { Again } from "./arm";
// One draft session (PIE-516): the lifecycle every draft goes through, whatever it's for. A draft opens
// (bringing back the text put aside at its place), is typed in, is held on the service while it edits a
// block, and ends in one of three ways: written (saved, sent or created), closed with nothing changed, or
// put aside as unsent where it was written. Where it's written is a target adapter: a block's text
// (`blockTarget`), a comment or reply (`commentTarget`), or a new card or child note (`cardTarget`). Hosts
// (the reader, the board's composer, the comment session) call `key` and `leave`; the actions the keys run
// call `submit`, `close` and `replace`. Every rule about an agent and a draft is `agentRefusal`, here.
import { propertyListOf, type PropertyList, prop } from "./props";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { subject, type Msg } from "./board";
import { strayWords } from "./stray";
import { dayOf, keptNot, onDay } from "./unsent-compare";
import { DraftStatus, type DraftPhase } from "./draft-status";
import { DRAFT_ACTIONS, pruneOld, sameParty, tidy, whenPut, PATCH_FLASH_MS, Draft, type DraftAction, type DraftActionArgs, type Step } from "./edit";
import { actorIdOf, EditConflict, isExtensionWriter, Refused, USER, type Actor, type Comment, type CommentPassage, type AnnotationProps, type DraftAnswer, type DraftHoldHandle, type DraftRequest, type SocketBoard } from "./socket";
import { ActionRefused, agentLabel, keyName, type DraftUse } from "./surface/actions";
import type { ElementEdit } from "./surface/element-editor";
import { completerOf, defaultCompleter, completionKey, type Completer } from "./surface/completer";
import { outlineState } from "./state";
import type { Key } from "./term";
import { markStart } from "@ep0ch/outline-core/draft-patch-compare";
import { actorHandle, actorName } from "@ep0ch/outline-core/attribution";
import { heldBack, MARK_THEM } from "./whereabouts";

// ── the target adapters' seam ─────────────────────────────────────────────────

/** What writing a draft did: written (`said`, for a flash), or not, with why. */
export type Outcome =
  | { ok: true; said?: string; revision?: number; result?: unknown }
  /**
   * `stale`: the service refused it because what it was based on moved on (the draft is kept, copied to disk).
   * `again`: not refused, only held for a second save (a property change shown first).
   */
  | { ok: false; why: string; stale?: boolean; again?: boolean; said?: string };

/**
 * How a target reports while it writes (PIE-1560): the phase it's in (asking how the properties read, saving, creating;
 * null once the write has landed or failed), for its session's one status line. A target never writes the draft's fields.
 */
export interface TargetReport { phase(p: DraftPhase | null): void }

/** Where a draft goes when it's written: one adapter per kind of destination. */
export interface DraftTarget {
  /** Where it's put aside and brought back from (the unsent key): `edit:<id>`, `comment:<id>`, `reply:<thread>`, `remark:<mark>`, `card:<view>`, `child:<id>`. */
  readonly place: string;
  /** What brings it back, as said: "e brings it back". */
  readonly back: string;
  /** Its copy's name on disk (`drafts/<label>-<time>.md`). */
  readonly label: string;
  /** How a flash names it: "the edit to “Plant the leeks”", "the comment on …", "the new card in Doing". */
  readonly what: string;
  /** Saved, sent or created. */
  readonly verb: "save" | "send" | "create";
  /** The block it edits in place: held on the service while open (`drafts.hold`), and what the agent rule keys on. */
  readonly blockId?: string;
  /** The note it's written about (the edited note, the commented one, the parent, the view): `((` and `[[` search from there. */
  readonly near?: string;
  /** A click away writes it (an edit), or puts it aside unsent (a comment, a reply, a new card: sending is explicit). */
  readonly leaveWrites: boolean;
  /**
   * Write the text, recorded as `by` (`recordAs`); `asked` is who asked (pressed save, sent `edit.save`).
   * `away`: leaving by a click, which never confirms a second save.
   */
  submit(s: DraftSession, by: Actor, how: { asked: Actor; away: boolean; confirmed: boolean; report: TargetReport }): Promise<Outcome>;
  /** ctrl+r: read what the service has now and report only that (`ReloadRead`). A read that fails throws. The session does the rest. */
  reload?(s: DraftSession): Promise<ReloadRead>;
}

/**
 * What a target read on ctrl+r (PIE-1591). The session owns everything else: the hold and the replay, copying what was
 * typed, where the text lands, when the conflict clears and what the line says.
 * - `loaded`: the block as it is now, which the draft takes.
 * - `stays`: the draft's text stands and its place was found again (a comment's quote); what to say about it.
 * - `none`: nothing to load (it's gone, or nothing is out of date), so the conflict stands; why.
 */
export type ReloadRead = { loaded: Msg } | { stays: string } | { none: string };

/** What a session asks of whoever hosts it: its connection (for the hold), a redraw, and what to say. */
export interface SessionEnv {
  /** The connection: it holds a block target's draft (`holdDraft`) and scopes the agent rule. */
  board?: Pick<SocketBoard, "holdDraft"> | null;
  redraw?(): void;
  /** An agent's patch landed in the draft: the host says so (its header line). */
  agentDid?(by: Actor, did: string): void;
  answered?(ask: string, by: Actor): void;
  /** The session ended (written, closed or put aside); the host lets go of it. */
  closed?(how: Ended, s: DraftSession): void;
  /** What a leave kept as unsent, said at once (before the click that left does what it does). */
  said?(msg: string): void;
}

/** How a session ended. */
export type Ended = "written" | "closed" | "aside";

/** What a key in a draft asks its host to run as an action (the key path is the action path, PIE-506). */
export type DraftCommand = "save" | "close" | "discard" | "editor" | "pick" | "reload" | "copy" | "follow" | "image" | "drop" | "attach";

/**
 * What leaving a draft by a click (or ^W) did: `closed` (nothing changed), `saved`, `kept` as unsent (with
 * why and the copy on disk), or left alone while a write already on its way lands.
 */
export type LeaveResult =
  | { left: "closed" | "nothing" | "saving" | "sending" | "creating" }
  | { left: "saved"; revision?: number }
  | { left: "kept"; keptAt: string; why?: string; said: string };

/** What a host says once the click that left a draft has done what it does: the kept-as-unsent line. */
export const leaveSaid = (r: unknown): string | null => (r && typeof r === "object" && "said" in r && typeof r.said === "string" ? r.said : null);

// ── the session ───────────────────────────────────────────────────────────────

/**
 * (The other "invitation" is the screen grant a button press mints for a script run: src/surface/invite.ts. They share the
 * dispatcher's `invitation=` argument and nothing else.)
 * The person's invitation to one agent (an `@name` line in their own draft, PIE-516's seam for `@yo`): it
 * grants that agent one reply for one range, the draft's text above the line, and nothing else. The request
 * carries the range as it was (`snapshot`) and its hash (`base`); the reply names the hash it was written on.
 */
export interface Invitation { id: string; agent: string; mark: string; range: { start: number; end: number }; snapshot: string; base: string; used: boolean }
/** A reply that came after the person changed the invited range: offered under it, never applied by itself. */
export interface Suggestion { invitation: string; by: Actor; replacement: string; at: number }
/** What a reply to an invitation did: swapped in (one undo step, the cursor shifted with it), or offered. */
export type ReplyResult = { applied: true } | { applied: false; suggested: true };

/** The hash an invitation's range is named by (sha256, the first 16 hex digits). */
export const rangeHash = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);

/** Open sessions that edit a block, by connection: what the agent rule asks. */
const openOn = new WeakMap<object, Set<DraftSession>>();
/** Sessions on no connection (a test's, a host without one). */
const loose = new Set<DraftSession>();
const registry = (board: object | null | undefined) => {
  if (!board) return loose;
  let s = openOn.get(board);
  if (!s) openOn.set(board, s = new Set());
  return s;
};

/** A key that writes in a draft, or moves between what's written (a command is anything else: `DraftSession.holding`). */
const WRITES = new Set<Key["kind"]>(["char", "paste", "enter", "alt-enter", "backspace", "alt-backspace", "delete", "tab", "backtab", "left", "right", "up", "down", "home", "end", "pgup", "pgdn"]);
/** A held key that only adds text: what's safe wherever it lands. */
const inserts = (k: Key) => k.kind === "paste" || (k.kind === "char" && !k.ctrl);
const writes = (k: Key, d: Draft) => WRITES.has(k.kind) && !(k.kind === "char" && k.ctrl && k.ch !== "a" && k.ch !== "e") && !(k.kind === "enter" && d.enterSaves);

export class DraftSession {
  readonly draft: Draft;
  /** Who opened it: the person (their `e`, `C`, `n`) or an agent (`edit.text`, `comment.write`). */
  readonly openedBy: Actor;
  /** How it ended, once it has. */
  ended: Ended | null = null;
  /** What happened to the text when it ended put aside (or dropped), for the host to say. */
  closedWith: string | null = null;
  private hold: DraftHoldHandle | null = null;
  private readonly env: SessionEnv;
  /** Invitations the person's `@name` lines gave, by id: each good for one reply. */
  private readonly invitations = new Map<string, Invitation>();
  /** Replies offered because the person changed the invited range meanwhile (`accept` takes one). */
  suggestions: Suggestion[] = [];

  private constructor(readonly target: DraftTarget, draft: Draft, by: Actor, env: SessionEnv) {
    this.draft = draft; this.openedBy = by; this.env = env;
  }

  /**
   * Open a draft for `target`: on `text` (a block's, at revision `base` with its parsed `props`), or empty.
   * The person's brings back what they put aside at the target's place; an agent's never picks it up. A
   * block's draft is held on the service, so an agent's `draft.patch` lands in it while it's open. An agent
   * doesn't open a draft of a block someone else has open in one (`agentRefusal`).
   */
  static open(target: DraftTarget, init: { text?: string; base?: number; props?: PropertyList; by?: Actor; position?: ReaderPosition }, env: SessionEnv = {}): DraftSession {
    const by = init.by ?? USER;
    if (target.blockId) { const why = agentRefusal(by, { board: env.board, blockId: target.blockId }); if (why) throw new ActionRefused(why); }
    const s = new DraftSession(target, new Draft(target.blockId ?? target.place, init.base ?? 0, init.text ?? "", init.props ?? []), by, env);
    // A new draft here supersedes strays dropped here earlier: ctrl+z never lays them over what came after.
    strays.delete(target.place);
    s.draft.near = target.near;
    s.draft.redraw = env.redraw ?? null;
    s.draft.titlesPages = target.verb !== "send";
    // Only an edit the person opened can be one opened by mistake: an agent's they typed into is theirs to put aside.
    s.draft.straysClose = target.place.startsWith("edit:") && by.kind !== "agent";
    if (by.kind !== "agent" && !s.restore()) {
      // The last draft written here, on the text this one starts from: its history carries on (PIE-621).
      const h = histories.get(target.place);
      if (h && h.revision === s.draft.base) s.draft.adopt(h.steps, h.revision);
    }
    if (init.position) {
      if (s.draft.restored !== null) Object.assign(init.position, s.draft.position);
      s.draft.usePosition(init.position);
    }
    if (target.blockId) {
      registry(env.board).add(s);
      s.hold = env.board?.holdDraft?.(target.blockId, s.draft.base, r => s.answer(r), ask => { s.draft.asks.set(ask.line, ask); env.redraw?.(); }) ?? null;
      // The person's typing reaches the service (drafts.touch): an @name line they write runs before any save.
      s.draft.onPersonTyped = () => { if (!s.ended) s.hold?.touched?.(); };
    }
    return s;
  }

  get open() { return this.ended === null; }
  get dirty() { return this.draft.dirty; }
  get busy() { return this.draft.busy; }
  /** Its one status line: the session writes it, from what its target reports and what its draft's keys say. */
  get status(): DraftStatus { return this.draft.status; }
  /** Held on the service now (`drafts.hold`). */
  get held() { return !!this.hold && !this.ended; }
  get board() { return this.env.board ?? null; }

  // ── keys ────────────────────────────────────────────────────────────────────

  /**
   * A key in the draft. Typing, the cursor, the list keys and the completion popup are the draft's; what ends
   * or hands it off is a command the host runs as its action (`run`): save, close (esc on nothing changed),
   * discard (the second esc on changed text: put aside), editor, pick (insert from a picker), reload, copy. Nothing while a write lands.
   */
  /** A submit is on its way to its target: keys wait for it (`key`). */
  private submitting = false;
  /** Keys and pastes that came during a reload, in order, each with its host's key path. */
  private heldKeys: { k: Key; replay: (k: Key) => void }[] = [];
  /** The reload took away or changed the table the held keys were typed in: how, in words. */
  private tableLost: "is gone" | "changed" | null = null;
  /** Commands pressed during that reload: never run, said when it ends. */
  private heldBack = new Set<string>();
  /** Its held keys are going in: a host's key path runs no command for them. */
  replaying = false;
  /** `replay`: the host's whole key path, for one with steps before this (`holding`); by default a held key comes back here. */
  key(k: Key, host: { run(cmd: DraftCommand): void; completer?: Completer | null; replay?(k: Key): void }): void {
    if (this.holding(k, host.replay ?? (held => this.key(held, { ...host, run() {} })))) return;
    // While a submit is in flight the keys are held (PIE-1542 review): typing then would show and be lost with the field.
    if (!this.open || this.draft.busy || this.submitting) return;
    // The default attachment (PIE-626): a session's draft completes from its own connection, whoever hosts it; a host
    // that passes `completer: null` opts out, one that passes its own (a note's, with the draft's note as context) keeps it.
    const completer = host.completer === undefined ? defaultCompleter(this.draft, this.env.board, () => this.env.redraw?.()) : host.completer;
    const a: DraftAction = completionKey(this.draft, k, completer);
    this.watchPaste(k, host);
    // A draft with nothing behind it to read (a new card, a note reply, a field) says so, whoever hosts it.
    if (a === "reload" && !this.target.reload) { void this.reload(); return; }
    if (a !== "keep") host.run(a);
  }

  /** What the last paste holds, when it is nothing but image files: its host's `drop` command takes it (draft.drop). */
  dropped = "";
  private pasteSoFar: string | null = null;
  /**
   * Every draft's paste, whole (a `paste`) or typed out key by key (the App's): written first, then, once it's all in,
   * files dropped on a terminal go to the host as `drop` (PIE-1589). A key replayed after a reload runs no command, whichever host's path it comes back by: a held paste stays text.
   */
  private watchPaste(k: Key, host: { run(cmd: DraftCommand): void }): void {
    const piece = k.kind === "paste" ? k.text : !("pasted" in k && k.pasted) ? null : k.kind === "enter" ? "\n" : k.kind === "tab" ? "\t" : k.kind === "char" ? k.ch : "";
    if (piece === null || this.replaying) return;
    if (this.pasteSoFar === null) queueMicrotask(() => {
      const text = this.pasteSoFar ?? "";
      this.pasteSoFar = null;
      if (this.open && droppedFiles(text)) { this.dropped = text; host.run("drop"); }
    });
    this.pasteSoFar = (this.pasteSoFar ?? "") + piece;
  }

  // ── writing ─────────────────────────────────────────────────────────────────

  /**
   * Write it to its target, recorded as whoever wrote the text (`recordAs`, not always `actor`, who asked).
   * Written: the session ends. A stale refusal keeps the draft as typed and copies it to disk (ctrl+r starts
   * over from what the service has now); any other refusal keeps it with the reason.
   */
  async submit(actor: Actor = USER, away = false, confirmed = false): Promise<Outcome> {
    if (!this.open) return { ok: false, why: "the draft is closed" };
    const d = this.draft;
    if (d.busy) return { ok: false, why: `the ${this.target.verb} is still landing` };
    // An agent's save of the draft itself is allowed, recorded as whoever wrote it (recordAs: honest provenance, not
    // an approval); a write underneath someone else's open draft of the same block is not.
    const why = this.target.blockId ? agentRefusal(actor, { board: this.env.board, blockId: this.target.blockId, except: this }) : null;
    if (why) return { ok: false, why };
    this.submitting = true;
    let r: Awaited<ReturnType<DraftTarget["submit"]>>;
    const report: TargetReport = { phase: p => { d.status.phase = p; this.env.redraw?.(); } };
    try { r = await this.target.submit(this, recordAs(d, actor), { asked: actor, away, confirmed, report }); } finally { this.submitting = false; d.status.phase = null; }
    if (r.ok) {
      // Undo survives the save: an edit of this note opened again on what was written takes up its history, stopping
      // at the save to ask before it takes saved text back (PIE-1414).
      if (r.revision !== undefined && d.undos.length) keepHistory(this.target.place, r.revision, d.undos);
      if (this.open) this.end("written");
      return r;
    }
    if (r.said !== undefined && this.open) { d.status.say(r.said); this.env.redraw?.(); }
    if (r.stale && this.open) {
      d.status.conflict = r.why;
      const copied = d.copyOut(this.target.label);
      d.status.say(`your draft is kept and copied to ${copied}${this.target.reload ? ` · ctrl+r ${this.target.verb === "save" ? "loads the current text" : "finds it again"}` : ""}`);
    }
    return r;
  }

  /**
   * The person clicked (or ^W'd) away from the draft, as in any editor: nothing typed is lost and nothing is
   * posted that wasn't meant to be. Unchanged, it closes. A changed edit is written against the revision it
   * started from; one that can't be (stale, offline, refused, a property change not yet confirmed) is put
   * aside as unsent, and so is one brought back unsent and not typed in since. A comment, reply or new card is put aside, never sent: sending is an explicit act. The
   * hold goes with it. An agent leaves only a draft it opened and alone typed in.
   */
  async leave(actor: Actor = USER): Promise<LeaveResult> {
    const no = agentRefusal(actor, this, { op: "leave" });
    if (no) throw new ActionRefused(no);
    if (!this.open) return { left: "nothing" };
    const d = this.draft, t = this.target;
    if (d.busy) return { left: t.verb === "send" ? "sending" : t.verb === "create" ? "creating" : "saving" };
    if (!d.written) { this.end("closed"); return { left: "closed" }; }
    // An edit put aside, brought back and left as it came: a click away puts it aside again. Only typing (or
    // ctrl+s) says the person means to write it now; a click elsewhere never writes it over the note.
    if (t.leaveWrites && d.restored !== null && d.restored === d.text) {
      const keptAt = this.keep();
      this.end("aside");
      const said = `${keptNot(t.what, "saved")}: it came back and nothing was typed since · ${this.persons ? t.back : `a copy is at ${tidy(keptAt)}`}`;
      this.env.said?.(said);
      return { left: "kept", keptAt, said };
    }
    if (t.leaveWrites) {
      const r = await this.submit(actor, true);
      if (r.ok) return { left: "saved", revision: r.revision };
      if (!this.open) return { left: "closed" };
      // Not written: put aside where it was written (with a copy on disk). On a stale refusal the block moved
      // on, so opening it again shows its current text and says where this one is (restore).
      const reason = r.stale ? "it changed elsewhere since you started" : r.why || "refused";
      const keptAt = this.keep();
      this.end("aside");
      const said = `not saved: ${reason} · ${t.what} is kept here · ${r.stale || !this.persons ? `a copy is at ${tidy(keptAt)}` : t.back}`;
      this.env.said?.(said);
      return { left: "kept", why: reason, keptAt, said };
    }
    const keptAt = this.keep();
    this.end("aside");
    const said = `${keptNot(t.what, t.verb === "send" ? "sent" : t.verb === "create" ? "created" : "saved")} · ${this.persons ? t.back : `a copy is at ${tidy(keptAt)}`}`;
    this.env.said?.(said);
    return { left: "kept", keptAt, said };
  }

  /**
   * Close it (esc, `edit.close`, `comment.close`): unchanged, it just closes; changed, only with `discard`, and
   * then it's put aside as unsent (`putAside`: text brought back and left unchanged is dropped, its copy kept).
   * The caller says the refusal in its own words when there's changed text and no discard.
   */
  close(discard = false): { closed: boolean; keptAt?: string; said?: string } {
    if (!this.open) return { closed: false };
    if (this.draft.busy) throw new ActionRefused(`the ${this.target.verb} is still landing`);
    // Only spaces and line breaks in what started empty (a new note's Enter) is nothing written: it just closes.
    if (this.draft.written) {
      if (!discard) throw new ActionRefused("there's unsaved text; discard=true puts it aside as unsent");
      const said = this.putAside();
      this.end("aside");
      return { closed: true, keptAt: this.status.savedCopy ?? undefined, said };
    }
    this.end("closed");
    return { closed: true };
  }

  /**
   * Let it go on purpose (the person answered "discard" to leaving it, PIE-785): nothing is put aside to come back,
   * and a copy of changed text stays on disk all the same.
   */
  discard(): { said: string } {
    if (!this.open) return { said: "" };
    if (this.draft.busy) throw new ActionRefused(`the ${this.target.verb} is still landing`);
    const copy = this.draft.written ? this.draft.copyOut(this.target.label) : null;
    this.end("closed");
    return { said: copy ? `discarded ${this.target.what} · a copy is at ${tidy(copy)}` : "closed" };
  }

  /**
   * One of the draft's own actions (DRAFT_ACTIONS: the list keys, a click, the wheel, the preview, copy, undo) as
   * `actor`: the person's always; an agent's only in a draft it opened and alone typed in (undo: its own patches).
   */
  act<K extends keyof DraftActionArgs>(name: K, args: DraftActionArgs[K], actor: Actor): Promise<unknown> {
    const no = name === "draft.undo" ? null : agentRefusal(actor, this);
    if (no) return Promise.reject(new ActionRefused(no));
    return DRAFT_ACTIONS.run(name, args, this.draft, actor);
  }

  /**
   * ctrl+r, in any draft, the one lifecycle (PIE-1591): keys wait (`holding`) while its target reads (`ReloadRead`); what
   * was read lands, the conflict clears once and the line says one thing (`land`); what was typed meanwhile goes in on
   * what it holds (`replayHeld`). A read that fails changes nothing but the line.
   */
  async reload(): Promise<void> {
    if (!this.open) return;
    if (!this.target.reload) { this.status.say("nothing to reload"); this.env.redraw?.(); return; }
    if (this.draft.busy) return;
    if (!this.status.conflict && !this.status.changedElsewhere) { this.status.say("nothing newer to load"); this.env.redraw?.(); return; }
    try { await this.reading(); } finally { this.replayHeld(); }
  }

  private async reading(): Promise<void> {
    const d = this.draft, was = d.text, rich = d.views.rich?.on ? d.views.rich : null, cell = rich?.cellNow() ?? null;
    let read: ReloadRead;
    // Keys wait for it and an agent's writes are refused: what they'd add now the reload's rebase would drop (PIE-1560).
    this.status.phase = "reloading"; this.status.say(""); this.env.redraw?.();
    // A read that fails isn't a reload: the conflict stands and the draft says why (PIE-1560).
    try { read = await this.target.reload!(this); }
    catch (e) { this.status.say(`couldn't read it now · your text is kept · ctrl+r tries again (${e instanceof Error ? e.message : String(e)})`); return; }
    finally { this.status.phase = null; }
    if (this.open) this.land(read, was, rich, cell);
  }

  /** What the target read goes where it belongs, the conflict clears unless nothing was loaded, and the line says so. */
  private land(read: ReloadRead, was: string, rich: ElementEdit | null, cell: ReturnType<ElementEdit["cellNow"]>) {
    if ("none" in read) { this.status.say(read.none); return; }
    this.status.settled();
    if ("stays" in read) { this.status.say(read.stays); return; }
    const d = this.draft, copy = d.dirty ? d.copyOut(this.target.label) : this.status.savedCopy;
    d.rebase(read.loaded);
    this.hold?.revise(d.base);
    const loaded = `loaded revision ${d.base}${copy ? ` · your earlier draft is at ${tidy(copy)}` : ""}`;
    if (d.text === was) { this.status.say(loaded); return; }
    // Rich edit stays in its cell over the new text, or says it can't: nothing typed goes into a table's syntax (PIE-1560).
    // Anywhere else the cursor waits at the end: the same place whether a key came before the read answered or after.
    const landed = rich ? rich.landIn(cell) : (d.place(d.lines.length - 1, d.lines.at(-1)!.length), "kept");
    this.tableLost = landed === "gone" ? "is gone" : landed === "changed" ? "changed" : null;
    this.status.say(this.tableLost ? `the table ${this.tableLost}, so rich edit closed and what you type gets its own line · ${loaded}` : loaded);
  }

  /**
   * A key during a reload (PIE-1560): true when this session took it. Every host asks this first, before anything of its
   * own acts on the key. What a person writes always lands, so what they wrote (characters, pastes and the moves between
   * them) waits for `replayHeld`, through `replay`: their key path. A command (ctrl+s, esc, ctrl+r, anything else) never
   * runs later on text they haven't seen: it doesn't run at all, and the line says to press it again.
   */
  holding(k: Key, replay: (k: Key) => void): boolean {
    if (this.status.phase !== "reloading") return false;
    if (writes(k, this.draft)) { this.heldKeys.push({ k, replay }); return true; }
    const name = keyName(k) ?? "that key";
    this.heldBack.add(name);
    this.status.say(`reloading · press ${[...this.heldBack].join(", ")} again once it has loaded`);
    this.env.redraw?.();
    return true;
  }

  /** What was typed or pasted during the reload goes in now, in order, where it landed. */
  private replayHeld() {
    const held = this.heldKeys, back = [...this.heldBack], d = this.draft, said = d.note, lost = this.tableLost;
    this.heldKeys = []; this.heldBack = new Set(); this.tableLost = null;
    // Disposed while the read was out (its reader went elsewhere): no key path is left to take them.
    if (!this.open || (!held.length && !back.length)) return;
    this.replaying = true;
    // Where the keys were meant for is gone (a table): a delete or a move would act on text they weren't pressed for.
    const gone = !!lost, off = gone ? [...new Set(held.filter(h => !inserts(h.k)).map(h => keyName(h.k) ?? h.k.kind))] : [];
    try { for (const { k, replay } of held) if (!gone || inserts(k)) replay(k); } finally { this.replaying = false; }
    // Typing clears the line; what the reload said is still news (unless a replayed key said something of its own).
    if (!d.note) this.status.say(said);
    if (off.length) this.status.say(`${off.join(", ")} didn't apply: the table they were for ${lost} · ${d.note}`);
    // What to do first: a narrow line cuts its end, never this.
    if (back.length) this.status.say(`${back.join(", ")} didn't run: press ${back.length > 1 ? "them" : "it"} again${d.note ? ` · ${d.note}` : ""}`);
    this.env.redraw?.();
  }

  /**
   * What it's written on moved to `revision` (an outline event, a comment list read again): it says so before any save.
   * Never during a save or a reload, which answer that themselves; never for an older read arriving late.
   */
  changedTo(revision: number) {
    if (this.open && !this.status.saving && this.status.phase !== "reloading" && revision > this.draft.base) this.status.changedElsewhere = true;
  }

  /**
   * Replace the whole text (`edit.text`, `comment.write`, $EDITOR coming back). Text someone else changed last
   * (the person's typing, or another agent's) is copied to disk first and the note says where.
   */
  replace(text: string, actor: Actor): string | null {
    const d = this.draft, last = d.lastWriter;
    const kept = d.dirty && last && !sameParty(last, actor) ? { at: d.copyOut(this.target.label), whose: last.kind === "user" ? "you" : agentLabel(last) } : null;
    d.replace(text, actor);
    this.status.say(kept ? `${agentLabel(actor)} replaced the ${this.target.verb === "save" ? "draft" : "text"} · what ${kept.whose} had typed is at ${kept.at}` : "");
    return kept?.at ?? null;
  }

  // ── unsent: put aside, never lost, brought back where it was written ──────

  /**
   * Keep it under its place with a copy on disk (a screen closing, the door quitting, a refused leave).
   * Text only agents wrote is only copied: it never covers the person's put-aside text there.
   */
  keep(): string {
    const copy = this.draft.copyOut(this.target.label);
    if (this.persons) shelve(this.target.place, this.draft, copy);
    return copy;
  }

  /** The person had a hand in the text (or nobody is recorded, as for text typed before writers were kept). */
  private get persons() { const w = this.draft.writers; return !w.length || w.some(x => x.kind === "user"); }

  /**
   * Esc, esc on changed text: put aside where it was written (and copied to disk); opening the same draft again
   * brings it back. Text already brought back and left unchanged is dropped instead, its copy kept.
   */
  private putAside(): string {
    const d = this.draft, t = this.target;
    // An edit opened by mistake (src/stray.ts): copied, never put aside; ctrl+z right after brings the strays back.
    const typed = d.stray();
    if (typed !== null) {
      const copy = d.copyOut(t.label);
      strays.set(t.place, { u: { key: t.place, text: d.text, base: d.base, at: Date.now(), copy, writers: d.writers, from: d.started }, at: Date.now(), row: d.row, col: d.col });
      return this.closedWith = `${strayWords(typed)} · ctrl+z brings them back`;
    }
    if (d.restored !== null && d.restored === d.text) {
      unshelve(t.place);
      const copy = d.copyOut(t.label);
      return this.closedWith = `let go of the kept draft · a copy stays at ${tidy(copy)}`;
    }
    const copy = this.keep();
    return this.closedWith = this.persons ? `kept here · ${t.back} · a copy is at ${tidy(copy)}` : `closed · your text is at ${tidy(copy)}`;
  }

  /**
   * The draft put aside at this place comes back, when it was written on the revision this draft starts from
   * (a comment or a new card always). One on an older revision stays put aside (the reader's "■ unsent" line
   * keeps saying so) with its copy on disk, and is said.
   */
  private restore(): boolean {
    const d = this.draft, u = unsent(this.target.place);
    if (!u) return false;
    if (u.base !== d.base) { this.status.say(`you started an edit ${onDay(dayOf(u.at))} and didn't save; the note has changed since · your edit is kept (open the note's kept-edit line to compare it) · its copy is at ${tidy(u.copy ?? "")}`); return false; }
    unshelve(this.target.place);
    d.lines = u.text.split("\n");
    d.row = d.lines.length - 1; d.col = d.lines[d.row]!.length;
    // Its place as it was, with the cursor kept in view: the frame around it may not be the size it was (PIE-1573).
    if (u.position) { d.usePosition(u.position); d.position.caret = null; d.follow = true; }
    d.restored = u.text;
    // Whoever wrote it then wrote it now: a save names them all (recordAs).
    for (const w of u.writers?.length ? u.writers : [USER]) d.wrote(w, "bringing back the unsent draft");
    // Restoring words is not a new edit: undo continues with the steps the person actually made.
    d.undos = (u.history?.undos ?? []).map(step => ({ ...step, open: false }));
    d.redos = u.history?.redos ?? [];
    d.patches = u.history?.patches ?? [];
    this.status.say(`brought back your ${this.target.verb === "send" ? "words" : this.target.verb === "create" ? "new note" : "edit"} from ${dayOf(u.at)} · ctrl+s ${this.target.verb}s · esc twice drops it`);
    return true;
  }

  // ── the hold: an agent's patch lands in the draft, not the saved block ─────

  /**
   * The service asks about the held draft: its text now, an agent's patch (compared against the text as
   * typed; the cursor, selection and view shift with it), or a revert of one. A patch that doesn't apply becomes a
   * proposal beside the note, never a line in the draft (PIE-725).
   * Never the person's keys: nothing here moves focus or ends the draft.
   */
  answer(r: DraftRequest): DraftAnswer {
    const d = this.draft;
    if (!this.open) throw new Error("the draft was closed");
    if (r.kind === "read") return { text: d.text, revision: d.base };
    const redraw = () => this.env.redraw?.();
    if (r.kind === "revert") { const reverted = d.revertPatch(r.patchId); redraw(); return { reverted }; }
    const by = patchActor(r.mutation);
    const a = d.applyPatch(r, by);
    if (a.applied) {
      if (r.replyTo) this.env.answered?.(r.replyTo, by);
      this.env.agentDid?.(by, r.proposal?.op === "dismiss" ? "took a dismissed proposal's line out of your draft" : r.output ? "placed output in your draft" : r.proposal || r.force ? "applied a proposal in your draft" : "edited text above your cursor");
      setTimeout(redraw, PATCH_FLASH_MS + 50);
      redraw();
    }
    return a.applied && r.undoPatches ? { ...a, inverse: { before: d.text, text: d.withoutPatches([...r.undoPatches, r.patchId]), revision: d.base } } : a;
  }

  // ── invitations: an `@name` line asks one agent for one range ─────────────

  /**
   * The person's `@agent` line (the last one in the draft) invites that agent to one step in their draft: a reply
   * that rewrites the text above the line (`reply`, `comment.write invitation=`), or one reference put in at their
   * cursor (`complete insert= invitation=`, `spend`), once. Null when the draft has no such line or nothing above it. The person keeps typing: nothing blocks.
   */
  invite(agent: string): Invitation | null {
    const d = this.draft, name = agent.replace(/^@/, "");
    const line = [...d.lines].reverse().find(l => new RegExp(`^\\s*@${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`).test(l));
    if (line === undefined) return null;
    const end = markStart(d.text, line);
    const snapshot = d.text.slice(0, Math.max(0, end - 1));
    if (!snapshot.trim()) return null;
    const inv: Invitation = { id: `inv-${crypto.randomUUID()}`, agent: name, mark: line, range: { start: 0, end: snapshot.length }, snapshot, base: rangeHash(snapshot), used: false };
    this.invitations.set(inv.id, inv);
    return inv;
  }

  /** The invitation `id` if it's open to `agent`: this session's, not yet replied to. */
  invitation(id: string, agent: string): Invitation | null {
    const inv = this.invitations.get(id);
    // `@kitty` invites kitty under any principal (`kitty/claude-code@box-a`): the persona is the name a person writes.
    return inv && !inv.used && actorHandle(inv.agent) === actorHandle(agent) ? inv : null;
  }

  /**
   * An invited agent's reply: `replacement` for the range, written on `base`. A compare-and-swap on the range
   * (the text above the `@` line now): unchanged since the snapshot, it's swapped in place, the cursor and view
   * shift by the difference, and the text before it is one undo step (ctrl+z, `draft.undo`). Changed by the
   * person meanwhile, it's offered as a suggestion under the range instead (`accept` takes it; typing on leaves
   * it). Refused without the invitation, from another agent, or a second time: an invitation is one reply.
   */
  reply(invitationId: string, base: string, replacement: string, by: Actor): ReplyResult {
    const inv = this.invited(invitationId, by);
    if (base !== inv.base) throw new ActionRefused("the reply names another base than the invitation's; it was written on other text");
    inv.used = true;
    const d = this.draft, mark = markStart(d.text, inv.mark);
    const now = mark > 0 ? d.text.slice(0, mark - 1) : null;
    if (now !== null && rangeHash(now) === inv.base && !d.busy) {
      const a = d.applyPatch({ patchId: inv.id, patches: [{ observed: now, replacement, range: { start: 0, end: now.length } }], revision: d.base, mark: inv.mark, force: true }, by);
      if (a.applied) {
        this.env.agentDid?.(by, "rewrote the text above its @ line, as you asked");
        this.env.redraw?.();
        return { applied: true };
      }
    }
    this.suggestions.push({ invitation: inv.id, by, replacement, at: Date.now() });
    this.env.agentDid?.(by, "suggested a rewrite of the text above its @ line (you changed it meanwhile)");
    this.env.redraw?.();
    return { applied: false, suggested: true };
  }

  /**
   * Use up an invitation for a step it lets an agent take in the person's draft other than a reply to the range
   * (`complete insert=`, a reference put in at their cursor): checked as a reply is, then spent. One invitation, one step.
   */
  spend(invitationId: string, by: Actor): void {
    this.invited(invitationId, by).used = true;
  }

  /** The invitation `id`, open to `by` (the agent rule's check; for the person, only that it's open), or refused. */
  private invited(invitationId: string, by: Actor): Invitation {
    const no = agentRefusal(by, this, { invitation: invitationId });
    if (no) throw new ActionRefused(no);
    const inv = this.invitations.get(invitationId);
    if (!inv || inv.used) throw new ActionRefused(`no open invitation ${invitationId} in this draft`);
    return inv;
  }

  /** The person takes a suggestion (the last, by default): the text above its `@` line becomes it, one undo step. */
  accept(invitationId?: string): boolean {
    const i = invitationId ? this.suggestions.findIndex(x => x.invitation === invitationId) : this.suggestions.length - 1;
    const sg = this.suggestions[i];
    const inv = sg && this.invitations.get(sg.invitation);
    if (!sg || !inv) return false;
    const d = this.draft, mark = markStart(d.text, inv.mark);
    if (mark <= 0) return false;
    const now = d.text.slice(0, mark - 1);
    const a = d.applyPatch({ patchId: `${inv.id}-accepted`, patches: [{ observed: now, replacement: sg.replacement, range: { start: 0, end: now.length } }], revision: d.base, mark: inv.mark, force: true }, sg.by);
    if (a.applied) this.suggestions.splice(i, 1);
    return a.applied;
  }

  /** The surface is going away with its screen: let go of the hold, keeping nothing (keepDrafts already did). */
  dispose() { if (this.open) this.end("closed"); }

  private end(how: Ended) {
    this.ended = how;
    this.hold?.release();
    this.hold = null;
    registry(this.env.board).delete(this);
    // Its popup goes with it, and a Jev re-order still waiting for its pause is never asked.
    completerOf(this.draft)?.dismiss();
    this.env.closed?.(how, this);
  }

  /** For `peek`. */
  describe() {
    const d = this.draft;
    return {
      id: d.blockId, place: this.target.place, baseRevision: d.base, dirty: d.dirty, changedElsewhere: d.status.changedElsewhere, conflict: d.status.conflict, savedCopy: d.status.savedCopy, note: d.note || null,
      openedBy: actorIdOf(this.openedBy), writers: d.writers.map(actorIdOf), held: this.held,
      cursor: { line: d.row + 1, col: d.col + 1 }, patches: d.patches.map(u => ({ id: u.patchId, by: actorIdOf(u.by) })), lit: d.flashes.map(f => f.label),
      // The open completion popup, as the last frame placed it (PIE-1511): under the caret, above it, or the sheet.
      completion: (c => c?.shown ? { rows: c.shown.items.length, lit: c.shown.items[c.shown.index]?.label ?? null, layout: c.drawn?.layout ?? null } : null)(completerOf(d)),
    };
  }
}

/** Who a patch the service passes on is by: an agent by its actor id, else the person. */
const patchActor = (m: { author: string; actorId?: string }): Actor => (m.author === "agent" ? { kind: "agent", id: m.actorId || "agent" } : USER);

/**
 * Who a write by `saver` is recorded as. One party wrote every change since the draft opened: them, whoever
 * presses save. Several did: the saver, naming the others (`with`), so neither is left out. An extension
 * (`ext:<id>`, an `@tidy` line's patch) is never who a write is recorded as: only the service's extension
 * runtime writes as one, and it refuses a client that names it. The saver records it, naming the extension.
 */
export function recordAs(d: Draft, saver: Actor): Actor {
  const only = d.writers.length === 1 ? d.writers[0]! : null;
  if (only && !(only.kind === "agent" && isExtensionWriter(only.id))) return only;
  if (!d.writers.length) return saver;
  const others = d.writers.filter(w => !sameParty(w, saver)).map(actorIdOf);
  const { with: _, ...me } = saver;
  return { ...(me as Actor), with: others };
}

// ── the agent rule: stated once ───────────────────────────────────────────────

/**
 * Whether an agent may do this, and why not. Two cases, one rule: the person's draft is theirs.
 * - In a session (`leave`, or `type`: the draft's own actions): only one the agent opened and alone typed in.
 *   (Replacing the whole text, `edit.text` and `comment.write`, is allowed in one the agent opened: text the person
 *   typed in it since is copied out first. In one the person opened, it's refused: `draftRule`.)
 * - On a block (`{ board, blockId }`): an agent never writes a block someone else has open in a draft here, nor
 *   opens a second draft of it; the write would land underneath them and make their save stale. It patches
 *   their draft instead (`draft.patch`, which reaches it through the hold). `except`: the agent's own session.
 * The person is never refused here. Null: allowed.
 */
export function agentRefusal(actor: Actor, on: DraftSession | { board?: object | null; blockId: string; except?: DraftSession }, how: { op?: "type" | "leave"; invitation?: string } = {}): string | null {
  if (actor.kind !== "agent") return null;
  const op = how.op ?? "type";
  // An invitation (the person's `@name` line) is the one way into their draft uninvited edits never have.
  if (how.invitation !== undefined) {
    const s = on instanceof DraftSession ? on : [...registry(on.board)].find(x => x.target.blockId === on.blockId && x.invitation(how.invitation!, actor.id));
    if (!s?.invitation(how.invitation, actor.id)) return `no open invitation ${how.invitation} for ${actorName(actor.id)} in this draft: an @${actorName(actor.id)} line in the person's draft invites one reply, once`;
    return null;
  }
  if (on instanceof DraftSession) {
    if (!sameParty(on.openedBy, actor)) {
      // Another agent's draft is its own; the person's is theirs while they're in it.
      const why = on.openedBy.kind === "agent" ? `${actorName(actorIdOf(on.openedBy))} has this ${op === "leave" ? "edit or comment" : "draft"} open` : `the person is typing in this ${op === "leave" ? "edit or comment" : "draft"}`;
      return op === "leave" ? heldBack(why, "save or close it") : heldBack(why, "type in it", `draft.patch lands in an edit; ${MARK_THEM}`);
    }
    if (on.draft.writers.some(w => !sameParty(w, actor))) return heldBack("someone else is typing in this draft", "type in it", `draft.patch lands in an edit; ${MARK_THEM}`);
    return null;
  }
  const theirs = [...registry(on.board)].find(s => s !== on.except && s.target.blockId === on.blockId && !(sameParty(s.openedBy, actor) && s.draft.writers.every(w => sameParty(w, actor))));
  if (!theirs) return null;
  const title = theirs.target.what.replace(/^the edit to /, "");
  return `${theirs.openedBy.kind === "user" ? "the person has" : `${agentLabel(theirs.openedBy)} has`} ${title} open in a draft${theirs.dirty ? " with unsaved changes" : ""}; an agent doesn't write it underneath · draft.patch lands in their draft, or wait until it's saved or closed`;
}

/**
 * The rule for an action declared `touches: "draft"` (PIE-514), as the dispatcher asks it before the action runs: the
 * rule above, for what the action does (`use`) in a tile that shows `blockId` and holds `session`.
 * - `type`: typing in the tile's draft (draft.*, a passage picked, a reference put in at the cursor by
 *   `complete insert=`): only one the agent opened and alone typed in.
 * - `leave`: saving, closing or sending it: the same.
 * - `write`: writing the block (an edit opened, a property, a step): never under a draft someone else has open on it
 *   elsewhere (the tile's own is the action's to handle: edit.text replaces it, copying theirs out first).
 * - `safe`: what the session keeps safe itself (draft.undo takes back only that actor's own patch): allowed.
 * - `text`: replacing the whole text of the tile's draft (comment.write, a comment or reply): only one the agent
 *   opened (text someone else typed in it since is copied out first). It writes no block, so a note open in an edit
 *   elsewhere doesn't stop it.
 * - `replace`: `text`, for a draft that writes the block (edit.text), so also as `write`: never under a draft
 *   someone else has open on the block elsewhere.
 * The person typing in that tile right now is the actor rule's to refuse for `text` and `replace` (`actorRule`: it
 * knows where they type).
 *
 * `invitation`: the agent says it was invited (an `@name` line in the person's draft, `DraftSession.invite`), for an
 * action that takes one (it declares an `invitation` argument and spends it). Into the person's draft, the
 * invitation is the one way: the session must hold it open for this agent; the action then uses it up.
 */
export function draftRule(actor: Actor, use: DraftUse, at: { board?: object | null; blockId?: string | null; session?: DraftSession | null }, how: { invitation?: string } = {}): string | null {
  if (actor.kind !== "agent") return null;
  if (how.invitation !== undefined && (use === "type" || use === "text" || use === "replace")) {
    return at.session?.open ? agentRefusal(actor, at.session, { invitation: how.invitation }) : `nothing is being written here to be invited into (invitation ${how.invitation})`;
  }
  if (use === "type" || use === "leave") return at.session ? agentRefusal(actor, at.session, { op: use }) : null;
  if ((use === "replace" || use === "text") && at.session && at.session.open && !sameParty(at.session.openedBy, actor)) {
    const s = at.session, who = s.openedBy.kind === "user" ? "the person" : agentLabel(s.openedBy);
    return s.target.blockId
      ? `${who} has this note open in an edit here; an agent doesn't replace their draft · draft.patch lands in it, or comment on the note or block.mark it to get their attention`
      : `${who} is writing ${s.target.what} here; an agent doesn't replace their text · block.mark gets their attention, or wait until it's sent or closed (an @${actorName(actor.id)} line in it invites one reply)`;
  }
  if (use === "text") return null;
  if (use === "replace") use = "write";
  if (use === "write" && at.blockId) return agentRefusal(actor, { board: at.board, blockId: at.blockId, ...(at.session ? { except: at.session } : {}) });
  return null;
}

/** The blocks with a draft open on them here. */
export function openDraftIds(board: object | null | undefined): string[] {
  return [...registry(board)].map(s => s.target.blockId).filter((id): id is string => !!id);
}

/** The draft open on `blockId` here, if any (a card's move waits for it). */
export function openDraftOf(board: object | null | undefined, blockId: string): DraftSession | null {
  return [...registry(board)].find(s => s.target.blockId === blockId) ?? null;
}

// ── adapter 1: a block's whole text ───────────────────────────────────────────


export { propertyListOf, type PropertyList };

/**
 * What a save changes in a note's properties (PIE-802), in plain words, "" when nothing: each key's values compared as
 * a multiset (a key written several times, as tags are, is a list), so adding tags beside others never reads as
 * removing one. Tags read `+#pow -#beep`; a key that had one value and has another, `stage: queued → doing`; one
 * added or dropped, `+due: friday`, `-due: friday`. Every flash and notice that says what a save changed says this.
 */
export function propertyChange(before: PropertyList, after: PropertyList): string {
  const count = (l: PropertyList) => { const m = new Map<string, Map<string, number>>(); for (const { key, value } of l) { const v = m.get(key) ?? new Map<string, number>(); v.set(value, (v.get(value) ?? 0) + 1); m.set(key, v); } return m; };
  const was = count(before), now = count(after), out: string[] = [];
  const less = (a: Map<string, number> | undefined, b: Map<string, number> | undefined) => [...(a ?? [])].flatMap(([v, n]) => Array<string>(Math.max(0, n - (b?.get(v) ?? 0))).fill(v));
  for (const key of [...new Set([...was.keys(), ...now.keys()])]) {
    const gone = less(was.get(key), now.get(key)), added = less(now.get(key), was.get(key));
    if (key === "tag") { out.push(...added.map(v => `+#${v}`), ...gone.map(v => `-#${v}`)); continue; }
    if (gone.length === 1 && added.length === 1) { out.push(`${key}: ${gone[0]} → ${added[0]}`); continue; }
    out.push(...added.map(v => `+${key}: ${v}`), ...gone.map(v => `-${key}: ${v}`));
  }
  return out.join(" ");
}

/**
 * Update a block (`update`, from the draft's base revision): its subject line, body and [key::value]
 * properties together. The service is asked first how it will read the properties; a save that changes
 * them is shown and needs a second save (never by a click away). `saved` is the host's: show the result.
 */
export function blockTarget(m: Msg, o: {
  board: Pick<SocketBoard, "update" | "previewPropertyList" | "get">;
  /** A note `note.new` just made for this edit (PIE-544): it has no properties to lose, so it saves on the first ctrl+s. */
  isNew?: boolean;
  /** Saved as `by` (who `asked`), changing the properties by `change`: the host shows it. */
  saved?(m: Msg, by: Actor, asked: Actor, change: string): void;
  /** ctrl+r read the block again: the host shows it. */
  reread?(m: Msg): void;
  redraw?(): void;
}): DraftTarget {
  const redraw = () => o.redraw?.();
  /** The text a "this save changes properties" warning was shown for; saving that same text again goes ahead. */
  let warned: string | null = null;
  return {
    place: `edit:${m.id}`, back: "e brings it back", label: m.id.slice(0, 8), what: `the edit to “${subject(m)}”`,
    verb: "save", blockId: m.id, near: m.id, leaveWrites: true,
    async submit(s, by, { asked, away, confirmed, report }) {
      const d = s.draft;
      if (!d.dirty) return { ok: true, said: "nothing changed" };
      const text = d.text;
      // Ask the service how it will read the draft's [key::value] tokens before writing, when it can say.
      // Meanwhile the draft holds still: keys wait, and edit.text / edit.close / edit.reload are refused.
      // A new note being written (PIE-544) has no properties to lose: it's written at once.
      if (warned !== text && !confirmed && !o.isNew) {
        report.phase("checking");
        let next: PropertyList | null = null;
        try { next = await o.board.previewPropertyList(text).catch(() => null); } finally { report.phase(null); }
        // Nothing should have changed it, but if the draft closed or its text moved on, this save is off.
        if (!s.open || d.text !== text) { redraw(); return { ok: false, why: "the draft changed while it was checked" }; }
        const change = next ? propertyChange(d.baseProps, next) : "";
        if (change) {
          // Leaving by a click isn't the second save a property change asks for: it's kept unsent.
          if (away) { const why = `it changes properties (${change}); ctrl+s twice saves it`; return { ok: false, why, said: why }; }
          warned = text;
          const why = `this save changes properties: ${change} · ctrl+s again saves`;
          return { ok: false, why, said: why, again: true };
        }
      }
      report.phase("saving");
      try {
        const saved = await o.board.update(m.id, text, d.base, by);
        report.phase(null);
        // An edit put aside on an older revision can't come back over this one: it's left to its copy on disk.
        const old = unsent(`edit:${m.id}`);
        if (old && old.base < (saved.revision ?? Infinity)) unshelve(`edit:${m.id}`);
        o.saved?.(saved, by, asked, propertyChange(d.baseProps, propertyListOf(saved)));
        return { ok: true, revision: saved.revision, result: by };
      } catch (e) {
        report.phase(null);
        if (e instanceof EditConflict) return { ok: false, stale: true, why: "changed elsewhere since you started · not saved" };
        const why = e instanceof Error ? e.message : String(e);
        return { ok: false, why, said: `not saved: ${why}` };
      } finally { redraw(); }
    },
    async reload() {
      const now = await o.board.get(m.id);
      if (!now) return { none: "the note is gone from the outline" };
      o.reread?.(now);
      return { loaded: now };
    },
  };
}

// ── adapter 2: a comment on a passage, or a reply to a thread ─────────────────

/**
 * Where a comment goes: a passage of a note at a revision, the whole note (PIE-846), a thread, or (PIE-763) a posted
 * comment or reply's own words.
 */
export type CommentWhere =
  | { kind: "quote"; blockId: string; revision: number; passage: CommentPassage; props?: AnnotationProps }
  | { kind: "note"; blockId: string; revision: number; props?: AnnotationProps }
  | { kind: "reply"; thread: Comment }
  | { kind: "edit"; thread: Comment; mark: EditedMark };

/** Where something new is sent: a comment on a passage, or a reply. */
export type NewCommentWhere = Exclude<CommentWhere, { kind: "edit" }>;

/** A posted comment (the thread's own) or one of its replies, as an edit of its words starts from it. */
export interface EditedMark { id: string; revision: number; body: string; author: string; reply: boolean }

/**
 * One requestId per thing the person means to send. A retry of the same text reuses it, so the service
 * answers with the comment it already saved. A changed text gets a new id; if the last send's outcome is
 * unknown, the adapter asks before sending, because both could land.
 */
export class Outgoing {
  private last: { key: string; id: string; unsure: boolean } | null = null;
  /** The requestId for this payload, and whether it replaces a send whose outcome is unknown. */
  peek(key: string): { requestId: string; replacesUnsure: boolean } {
    if (this.last?.key === key) return { requestId: this.last.id, replacesUnsure: false };
    return { requestId: "", replacesUnsure: !!this.last?.unsure };
  }
  begin(key: string): string {
    if (this.last?.key !== key) this.last = { key, id: `ep0ch-door-${crypto.randomUUID()}`, unsure: false };
    return this.last.id;
  }
  /** No answer: it may have been saved. */
  unsure() { if (this.last) this.last.unsure = true; }
  /** The service answered no: nothing was written under this id. */
  refused() { if (this.last) this.last.unsure = false; }
  done() { this.last = null; }
  get requestId() { return this.last?.id ?? null; }
}

/**
 * Send a comment or reply (`annotations.create` / reply), with a request id reused on retry so a send whose
 * answer was lost can't land twice. A stale passage (the note moved on, the quote gone) is refused as stale;
 * ctrl+r (`relocate`) finds it again. `landed` is the host's: what follows a send (the thread list reloaded).
 */
export function commentTarget(o: {
  /** Where it goes now (a relocate moves a quote's revision and offset). */
  where(): NewCommentWhere;
  /** The note it's on, for its place and name. */
  note: Msg;
  board(): Pick<SocketBoard, "comment" | "commentOnResource" | "reply">;
  out: Outgoing;
  landed(r: { id: string; deduplicated?: boolean }, where: NewCommentWhere, body: string): Promise<void>;
  /** Not sent, and why (said by the host at once, before the outcome reaches whoever asked). */
  refused?(why: string, stale: boolean): void;
  relocate?(): Promise<ReloadRead>;
}): DraftTarget {
  const w0 = o.where(), title = `“${subject(o.note)}”`;
  // ctrl+s again sends a text that differs from a send with no answer (Again: the same key within its window).
  const sendAnyway = new Again<string>();
  const no = (why: string, more: { stale?: boolean; again?: boolean } = {}): Outcome => { o.refused?.(why, !!more.stale); return { ok: false, why, ...more }; };
  const key = (t: NewCommentWhere, body: string) => JSON.stringify(t.kind === "quote" ? ["comment", t.blockId, t.revision, t.passage.start, t.passage.quote, body] : t.kind === "note" ? ["comment", t.blockId, t.revision, body] : ["reply", t.thread.id, body]);
  // A comment on a passage or on the whole note is put aside on the note: either brings it back.
  const comment = w0.kind !== "reply";
  const back = comment ? "C brings it back, on selected words or the whole note" : "r on the thread brings it back";
  const label = `${o.note.id.slice(0, 8)}-${comment ? "comment" : "reply"}`;
  return {
    place: w0.kind !== "reply" ? `comment:${o.note.id}` : `reply:${w0.thread.id}`, near: o.note.id,
    back, label,
    what: `the ${comment ? "comment" : "reply"} on ${title}`,
    verb: "send", leaveWrites: false,
    async submit(s, by, { report }) {
      const d = s.draft, t = o.where();
      const body = d.text.trim();
      if (!body) return { ok: false, why: "write the comment first", said: "write the comment first" };
      const k = key(t, body);
      if (o.out.peek(k).replacesUnsure && !sendAnyway.take(k)) {
        sendAnyway.arm(k);
        return no("the last send got no answer and may be saved; this text differs, so it would be a second comment · ctrl+s again sends it anyway", { again: true });
      }
      sendAnyway.clear();
      const requestId = o.out.begin(k);
      report.phase("saving");
      try {
        const b = o.board();
        const r = t.kind === "reply" ? await b.reply(requestId, t.thread.id, body, by)
          : o.note.resource ? await b.commentOnResource(requestId, o.note.resource, t.revision, body, t.kind === "quote" ? t.passage : null, by, t.props)
          : await b.comment(requestId, t.blockId, t.revision, body, t.kind === "quote" ? t.passage : null, by, t.props);
        o.out.done();
        report.phase(null);
        await o.landed(r, t, body);
        return { ok: true, result: r };
      } catch (e) {
        report.phase(null);
        const msg = e instanceof Error ? e.message : String(e);
        if (e instanceof Refused) {
          o.out.refused();
          const stale = t.kind === "quote" && /revision is stale|was not found|ambiguous/i.test(msg);
          // A refusal never strands the text (PIE-761): it stays open here, and a copy is on disk, said with what to do
          // next. A stale one is the session's to copy and say, as a note's edit is.
          if (stale) return no(/revision is stale/i.test(msg) ? "the note changed since you picked the passage · not sent" : /was not found/i.test(msg) ? "the quote isn't in the note's current text · not sent" : `refused, not sent: ${msg}`, { stale });
          return no(`refused, not sent: ${msg} · your text is kept here and copied to ${tidy(d.copyOut(label))} · ctrl+s tries again, esc esc puts it aside (${back})`);
        }
        o.out.unsure();
        return no(`no answer from the outline (${msg}) · it may be saved · your text is kept here and copied to ${tidy(d.copyOut(label))} · ctrl+s retries with the same request id, so it can't land twice`);
      }
    },
    ...(o.relocate ? { reload: () => o.relocate!() } : {}),
  };
}

// ── adapter 4: a posted comment's or reply's words, edited ────────────────────

/**
 * Edit a posted comment or reply in place (`annotations.update`, PIE-763), from the revision the edit started on: the
 * service keeps its target, lifecycle and replies, marks it edited and keeps its earlier words in the block's revisions.
 * It's an edit, so a click away saves it, as a note's does; a stale one (changed meanwhile) is refused, kept and copied,
 * and ctrl+r loads its words as they are now. It holds no draft on the service: the draft is its words, not its block's
 * text (heading and properties), so an agent's `draft.patch` has nothing to land in; it edits through `comment.edit`.
 */
export function commentEditTarget(o: {
  mark: EditedMark;
  /** The note it's on, for its name. */
  note: Msg;
  board(): Pick<SocketBoard, "updateComment">;
  /** Saved (or nothing changed, `unchanged`): the host reloads the thread and shows it. */
  landed(r: { id: string; revision: number; body: string; unchanged?: boolean }): Promise<void>;
  /** Not saved, and why (said by the host at once). */
  refused?(why: string, stale: boolean): void;
  /** ctrl+r after a stale refusal: the mark's words and revision as the service has them now (null: it's gone). */
  reread(): Promise<EditedMark | null>;
}): DraftTarget {
  let mark = o.mark;
  const what = mark.reply ? "reply" : "comment", label = `${mark.id.slice(0, 8)}-${what}`;
  const no = (why: string, stale = false): Outcome => { o.refused?.(why, stale); return { ok: false, why, ...(stale ? { stale } : {}) }; };
  return {
    place: `remark:${mark.id}`, near: o.note.id, label,
    back: `e on the ${what} brings it back`,
    what: `the edit to ${mark.author}'s ${what} on “${subject(o.note)}”`,
    verb: "save", leaveWrites: true,
    async submit(s, by, { report }) {
      const d = s.draft;
      const body = d.text.trim();
      if (!body) return no(`a ${what} can't be emptied by an edit · change its words, or esc esc to leave it as it was`);
      // Nothing changed: the edit closes as a saved one does, nothing written.
      if (body === mark.body.trim()) { await o.landed({ id: mark.id, revision: mark.revision, body: mark.body, unchanged: true }); return { ok: true, said: "nothing changed" }; }
      report.phase("saving");
      try {
        const r = await o.board().updateComment(mark.id, mark.revision, body, by);
        report.phase(null);
        mark = { ...mark, revision: r.revision, body: r.body };
        await o.landed(r);
        return { ok: true, revision: r.revision, result: r };
      } catch (e) {
        report.phase(null);
        const msg = e instanceof Error ? e.message : String(e);
        if (e instanceof Refused && /revision is stale/i.test(msg)) return no(`the ${what} changed since you started editing · not saved`, true);
        if (e instanceof Refused) return no(`refused, not saved: ${msg} · your text is kept here and copied to ${tidy(d.copyOut(label))}`);
        return no(`no answer from the outline (${msg}) · it may be saved · your text is kept here and copied to ${tidy(d.copyOut(label))} · ctrl+s tries again (a stale refusal then means it landed)`);
      }
    },
    async reload() {
      const now = await o.reread();
      if (!now) return { none: `the ${what} is gone from the outline` };
      mark = now;
      return { loaded: { id: now.id, text: now.body, revision: now.revision, properties: [], parentId: null, childIds: [], createdAt: 0, updatedAt: 0, author: null } as unknown as Msg };
    },
  };
}

// ── adapter 3: a new card in a lane, or a note under a card ───────────────────

/**
 * Create a card in a lane (its text born with what the lane's view needs, `views.planWrite`, through
 * `card.create`) or a child note under a card (`note.create`). `create` has no revision or request id, so a
 * lost answer is looked for by the action, never retried here. A new card is put aside under its lane's view
 * (`card:<view id>`): a view is one hub's, so two hubs' "Doing" lanes never share one.
 */
export function cardTarget(o:
  | { kind: "card"; lane: string; view: string; create(text: string, by: Actor): Promise<unknown> }
  | { kind: "child"; parent: Msg; create(text: string, by: Actor): Promise<unknown> },
): DraftTarget {
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "lane";
  const card = o.kind === "card";
  const label = card ? `new-card-${slug(o.lane)}` : `new-note-${o.parent.id.slice(0, 8)}`;
  return {
    place: card ? `card:${o.view}` : `child:${o.parent.id}`, near: card ? o.view : o.parent.id,
    back: card ? `n in ${o.lane} brings it back` : "N on the card brings it back",
    label,
    what: card ? `the new card in ${o.lane}` : `the new note under “${subject(o.parent)}”`,
    verb: "create", leaveWrites: false,
    async submit(s, by, { report }) {
      const d = s.draft;
      report.phase("creating");
      try {
        const result = await o.create(d.text, by);
        report.phase(null);
        return { ok: true, result };
      } catch (e) {
        report.phase(null);
        const why = e instanceof Error ? e.message : String(e);
        return { ok: false, why: `not created: ${why}`, said: `not created: ${why}${d.dirty ? ` · your text is kept (and copied to ${d.copyOut(label)})` : ""}` };
      }
    },
  };
}

/** A note reply is created only on Save: abandoning the editor leaves no empty child. */
export function noteReplyTarget(parent: Msg, board: Pick<SocketBoard, "newNote">): DraftTarget {
  const target = cardTarget({ kind: "child", parent, async create(text, by) {
    const lines = text.split("\n");
    lines.splice(1, 0, `[replyTo::${parent.id}]${prop(parent, "thread") ? ` [thread::${prop(parent, "thread")}]` : ""}`);
    const { note } = await board.newNote(lines.join("\n"), parent.id, by, true);
    return note;
  } });
  return { ...target, place: `note-reply:${parent.id}`, back: "R brings the reply back", what: `the reply to “${subject(parent)}”` };
}

// ── unsent drafts on disk ─────────────────────────────────────────────────────

/** A draft put aside (esc twice, a screen closed, the door quit): by its place, with a copy on disk. */
/**
 * A draft put aside: its text, the revision it was written on, when, its copy on disk and who wrote it. `from`: the text
 * it started from ("add them" and the comparison read the edit's own changes from there; absent on older ones, then the note's history stands in).
 */
export interface Unsent { key: string; text: string; base: number; at: number; copy: string | null; writers?: Actor[]; from?: string; position?: ReaderPosition; history?: { undos: Step[]; redos: Step[]; patches: Draft["patches"] } }

/** The outline's own (a draft's key is its blocks', threads' and views'): in its folder of the state dir, `outlineState()`. */
const unsentDir = () => join(outlineState(), "drafts", "unsent");
/**
 * A place's file: `<kind>-<id>.json` when the id is plain (letters, digits, . - _). Anything else (an older
 * `card:<lane name>`) is named by its hash too, so two keys never share a file ("To do" and "To-do").
 */
const unsentPath = (key: string) => {
  const plain = /^([a-z]+):([\w.-]+)$/.exec(key);
  const name = plain ? `${plain[1]}-${plain[2]}` : `${key.replace(/[^\w.-]+/g, "-").slice(0, 60)}-${createHash("sha256").update(key).digest("hex").slice(0, 10)}`;
  return join(unsentDir(), `${name}.json`);
};

/** Keep `d`'s text under `key` (its place: `edit:<id>`, `comment:<id>`, `reply:<thread>`, `card:<view>`, `child:<id>`). */
export function shelve(key: string, d: Draft, copy: string | null, at = Date.now()): Unsent {
  return keepUnsent({ key, text: d.text, base: d.base, at, copy, writers: d.writers, from: d.started, position: d.position, history: { undos: d.undos, redos: d.redos, patches: d.patches } });
}

/** Write a put-aside entry under its key (`shelve`, and stray characters brought back by ctrl+z). */
export function keepUnsent(u: Unsent): Unsent {
  const key = u.key;
  try {
    // The draft's whole text: private, like its copy (the folder 0700, the file 0600).
    mkdirSync(unsentDir(), { recursive: true, mode: 0o700 });
    const path = unsentPath(key), tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(u), { mode: 0o600 });
    renameSync(tmp, path);
    pruneUnsent(path);
  } catch { /* the copy on disk still has it */ }
  return u;
}

/** A written draft's history by place, for the next draft there on the revision it wrote (`Draft.adopt`): the last few places. */
const histories = new Map<string, { revision: number; steps: Step[] }>();
const HISTORY_PLACES = 20;
function keepHistory(place: string, revision: number, steps: Step[]) {
  histories.delete(place);
  histories.set(place, { revision, steps: [...steps] });
  for (const k of histories.keys()) { if (histories.size <= HISTORY_PLACES) break; histories.delete(k); }
}

/** How long after strays are dropped ctrl+z brings them back (ms). */
export const STRAY_BACK_MS = 60_000;
/** Stray characters dropped by esc (src/stray.ts), by place, for ctrl+z right after: never on disk as unsent. */
const strays = new Map<string, { u: Unsent; at: number; row: number; col: number }>();
/** The strays dropped at `place` in the last STRAY_BACK_MS, taken (once). */
export function takeStrays(place: string, now = Date.now()): { u: Unsent; row: number; col: number } | null {
  const s = strays.get(place);
  strays.delete(place);
  return s && now - s.at < STRAY_BACK_MS ? s : null;
}
/** Whether strays were dropped at `place` lately (ctrl+z asks before running its other undos). */
export const hasStrays = (place: string, now = Date.now()) => { const s = strays.get(place); return !!s && now - s.at < STRAY_BACK_MS; };

/** Drop old put-aside entries by the same rule as the copies (DRAFT_KEEP, DRAFT_DAYS). The one just written stays. */
export function pruneUnsent(keep: string, now = Date.now()): string[] {
  let files: { path: string; at: number }[];
  try {
    files = readdirSync(unsentDir()).filter(f => f.endsWith(".json")).map(f => {
      const path = join(unsentDir(), f);
      try { return { path, at: (JSON.parse(readFileSync(path, "utf8")) as Unsent).at }; } catch { return { path, at: 0 }; }
    });
  } catch { return []; }
  return pruneOld(files, keep, now);
}

/** The draft put aside at `key`, if there is one. */
export function unsent(key: string): Unsent | null {
  try { const p = unsentPath(key); return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) as Unsent : null; } catch { return null; }
}

/** Forget `u` if it is still the entry kept at its key: one written there since (a newer edit, put aside while this was being read) stays. */
export function unshelveIf(u: Unsent): boolean {
  const now = unsent(u.key);
  if (!now || now.at !== u.at || now.text !== u.text) return false;
  unshelve(u.key);
  return true;
}

/** Forget the draft put aside at `key` (it was brought back or dropped; its copy on disk stays). */
export function unshelve(key: string): void { try { rmSync(unsentPath(key), { force: true }); } catch { /* best effort */ } }

/** Every draft put aside, newest first. */
export function unsentAll(): Unsent[] {
  try {
    return readdirSync(unsentDir()).filter(f => f.endsWith(".json")).map(f => { try { return JSON.parse(readFileSync(join(unsentDir(), f), "utf8")) as Unsent; } catch { return null; } })
      .filter((u): u is Unsent => !!u).sort((a, b) => b.at - a.at);
  } catch { return []; }
}

/** Whether a draft is put aside at `key` (a lane's title asks on every paint: no read, only whether its file is there). */
export function hasUnsent(key: string): boolean { try { return existsSync(unsentPath(key)); } catch { return false; } }
