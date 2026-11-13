// The board's card composer (PIE-1781, out of lanes.ts): a new card in a lane (`n`) or a note under a card (`N`),
// written in a draft over the board, checked for a twin as its title settles, and created through the board's own
// actions. It reads the lanes only through ComposerBoard, the few things it asks of the board it writes on.
import { drawCompletionFloat } from "../surface/completion-float";
import { errorDetails } from "../status-log";
import type { StyleValues } from "@ep0ch/outline-core/style-cascade";
import { type Msg } from "../board";
import type { Canvas, Rect } from "../canvas";
import { byOf, recordedAnswer, USER, type Actor, type RecordedAs } from "../socket";
import { ActionRefused, agentLabel, asActor } from "../surface/actions";
import { Dispatcher } from "../surface/dispatch";
import { draftPreviewDoc } from "../surface/note";
import { prop } from "../props";
import { bg, C, drawEllipsized, fg, pad, RESET, visible } from "../style";
import { type Key } from "../term";
import { headerLine } from "@ep0ch/outline-core/header-line";
import { DRAFT_ACTIONS } from "../edit";
import { cardTarget, DraftSession, type DraftCommand, type LeaveResult } from "../draft-session";
import { editHint, openInEditor, renderEditor, writtenBy } from "../surface/editor";
import { pickInto, type Picked } from "../pick";
import { completerFor, completerOf } from "../surface/completer";
import { Refused, type CreatePlan } from "../socket";
import { pickParent, titleOf, type ParentPick } from "./writes";
import { QueryPane } from "./query";
import { ReaderPane } from "./panes";
import type { ColumnsHost, SourceModel } from "./tile-kinds";
import { PROPERTY_KEY_SOURCE } from "@ep0ch/outline-core/property-grammar";
import { BOARD_ACTIONS } from "./lanes";

type Lane = QueryPane;

/** What the composer asks of the board it writes on (the lanes model, which its actions take): its host, its lanes and the lane the person is in, the selected card, the last write it reports. */
export interface ComposerBoard extends SourceModel {
  readonly host: ColumnsHost;
  readonly lanes: Lane[];
  lane: number;
  lastWrite: { what: string; id?: string; result: string; by?: string } | null;
  laneFor(name: string): Lane;
  card(): Msg | undefined;
  toLanes(): void;
  unfold(l: Lane): void;
  readers(): ReaderPane[];
}

/**
 * A new card's plan: born-with properties, create:: defaults, what the text must meet (the service's
 * plan, `plan`), and its parent (null: a roadmap item, placed by the allocator).
 */
interface CardPlan { born: { key: string; value: string }[]; defaults: { key: string; value: string }[]; needs: string[]; parent: ParentPick | null; plan: Extract<CreatePlan, { kind: "create" }> }
/** The tokens a roadmap item still needs from the text: `[priority::high|medium|low] [arc::…] [track::…]`. */
const roadmapHint = (C0: { born: { key: string }[]; defaults: { key: string }[] }) =>
  ["project", "priority", "arc", "track"].filter(k => !C0.born.some(p => p.key === k) && !C0.defaults.some(p => p.key === k))
    .map(k => k === "priority" ? "[priority::high|medium|low]" : `[${k}::…]`).join(" ");

/** Open work a new item looks like: the title it was asked for, its Work ID and the service's words for it. */
interface CardTwin { title: string; workId: string; said: string }
/** The service's answer for one title: its twin, if it named one. */
type TwinAsked = { title: string; twin?: CardTwin };
/** A person's own act, not an agent's or one an agent is carrying out for them. */
const isPerson = (actor: Actor) => actor.kind !== "agent" && !actor.with?.length;
/** A new card's title: its header line's prose, the chips left out (outline-core's header grammar), and a chip still being typed. */
const draftTitle = (text: string) => headerLine(text).prose.replace(/\s*\[[^\]]*$/, "").trim();
/** How long the title rests before its twins are asked, and how much of it there must be: two words of three letters. */
const TWIN_SETTLE_MS = 700;
const asksTwin = (title: string) => title.length >= 10 && title.split(/\s+/).filter(w => w.length >= 3).length >= 2;

export type Composer =
  | { kind: "card"; lane: Lane; planning: boolean; born: { key: string; value: string }[]; defaults: { key: string; value: string }[]; needs: string[]; parent: (ParentPick & { title: string }) | null; session: DraftSession;
      /** Open work the new item looks like (PIE-1258), on the composer's row: once shown, ctrl+s files it new. */
      twin?: CardTwin;
      /** The last title the service was asked about, and its answer; the pending ask while the title settles. */
      asked?: TwinAsked;
      twinTimer?: ReturnType<typeof setTimeout>;
      /** The lane's plan for it, asked when it opened (planning until it lands). */
      planned?: Promise<void>;
      /** Set by card.attach: the next submit adds the draft under this item instead of creating one. */
      attachTo?: string }
  | { kind: "child"; parent: Msg; session: DraftSession };

/** A step's first line, without its list mark, checkbox and ^id. */

const hintToken = (need: string) => { const m = need.match(new RegExp(`(${PROPERTY_KEY_SOURCE})=("[^"]*"|[^\\s()]+)`)); return m ? `${m[1]}::${m[2]!.replace(/^"|"$/g, "")}` : `${need.replace(/[()]/g, "")}::…`; };

export class CardComposer {
  constructor(private readonly b: ComposerBoard) {}
  /** A new card (`n`) or a note under a card (`N`) being written. Holds every key until created or closed. */
  composer: Composer | null = null;
  /** Where the composer was last drawn, for the mouse. */
  composerAt: Rect | null = null;
  /** A drag or shift+click is selecting in the composer's draft: the release copies it. */
  composerDrag = false;
  /** A double or triple click's word or line being selected in the composer: its release copies it after. */
  composerSelecting: Promise<void> | null = null;

  /**
   * What a new card in `lane` is born with, and where it goes; the reason when the lane can't define one.
   * A roadmap lane's items go where the workboard's allocator puts them (their project's work queue), so
   * it has no parent to pick and a named one is refused.
   */
  async cardPlan(lane: Lane, parent?: string, text = ""): Promise<CardPlan> {
    const plan = await this.b.host.ctx.board.planCreate(lane.view, text);
    if (plan.kind === "refused") throw new ActionRefused(plan.reason);
    const { needs } = plan;
    if (plan.roadmap) {
      if (parent) throw new ActionRefused(`${lane.name} lists roadmap items: the workboard's allocator puts them under their project's work queue, so parent= can't be chosen`);
      return { born: plan.born, defaults: plan.defaults, needs, parent: null, plan };
    }
    const where = parent ? { id: parent, why: "named by the caller" } : pickParent(lane.name, plan.parentId, lane.items ?? [], this.b.lanes.flatMap(l => l.items ?? []));
    if ("refused" in where) throw new ActionRefused(where.refused);
    return { born: plan.born, defaults: plan.defaults, needs, parent: where, plan };
  }

  /** `card.new` (n, ctrl+n on the lanes): the composer for a new card in lane `name` (default the person's), opened. */
  newCard(name?: string): { lane: string; composing: boolean } {
    if (name !== undefined) this.b.lane = this.b.lanes.indexOf(this.b.laneFor(name));
    const lane = this.b.lanes[this.b.lane];
    if (!lane) throw new ActionRefused("no lane here to write a card in");
    if (this.composer) throw new ActionRefused(`a new ${this.composer.kind === "card" ? "card" : "note"} is open already · ${visible(editHint(this.composer.session.draft, { save: "create", close: "back" }))}`);
    this.openCardComposer();
    return { lane: lane.name, composing: !!this.composer };
  }

  /**
   * `n`: a new card in the focused lane, written in a composer over the board. It opens at once, so what
   * is typed next is the card's text, never board keys; the parent's title is filled in when it's read.
   */
  openCardComposer() {
    const lane = this.b.lanes[this.b.lane];
    if (!lane || this.composer) return;
    // Open now, so what's typed next is the card's text; what the lane gives it is filled in when the
    // service's plan arrives. A lane that can't define a card says why, and the text is kept.
    // A new card put aside in this lane (esc twice, a click away, the board closed) comes back: the card adapter's
    // place is the lane's view, so another hub's lane of the same name never brings it back (or creates it there).
    const session = this.openComposer(cardTarget({ kind: "card", lane: lane.name, view: lane.view, create: (text, by) => C0.attachTo
      ? BOARD_ACTIONS.run("card.attach", { twin: C0.attachTo, text }, { model: this.b }, by).finally(() => { C0.attachTo = undefined; })
      : BOARD_ACTIONS.run("card.create", { lane: lane.name, text, ...(C0.parent ? { parent: C0.parent.id } : {}) }, { model: this.b }, by) }));
    const C0: Extract<Composer, { kind: "card" }> = { kind: "card", lane, planning: true, born: [], defaults: [], needs: [], parent: null, session };
    this.composer = C0;
    this.b.host.redraw();
    C0.planned = this.cardPlan(lane).then(plan => {
      if (this.composer !== C0 || C0.kind !== "card") return;
      const pick = plan.parent;
      Object.assign(C0, { planning: false, born: plan.born, defaults: plan.defaults, needs: plan.needs, parent: pick ? { ...pick, title: pick.id.slice(0, 8) } : null });
      this.watchTwin();
      this.b.host.redraw();
      if (pick) this.b.host.ctx.board.get(pick.id).then(parent => {
        if (this.composer !== C0 || C0.kind !== "card" || !C0.parent) return;
        if (parent) C0.parent.title = titleOf(parent);
        else C0.session.draft.status.say(`its parent ${pick.id.slice(0, 8)} isn't in the outline; creating will be refused`);
        this.b.host.redraw();
      }, () => {});
    }, (e: Error) => {
      if (this.composer !== C0 || C0.kind !== "card") return;
      C0.planning = false; C0.session.draft.status.say(`not created: can't create in ${lane.name}: ${e.message}`);
      if (!C0.session.dirty) { C0.session.close(); this.composer = null; }   // nothing typed yet: nothing to keep
      this.b.host.ctx.flash(`can't create in ${lane.name}: ${e.message}`, undefined, errorDetails(e));
      this.b.host.redraw();
    });
  }

  /** `N`: a note under the selected card, opened at once like `n`. */
  openChildComposer() {
    const card = this.b.card();
    if (!card) return this.b.host.ctx.flash("select a card to add a note under");
    if (this.composer) return;
    const session = this.openComposer(cardTarget({ kind: "child", parent: card, create: (text, by) => BOARD_ACTIONS.run("note.create", { text, parent: card.id }, { model: this.b }, by) }));
    this.composer = { kind: "child", parent: card, session };
    this.b.host.redraw();
  }

  /** The composer's draft session (the card adapter): it ends by itself once created, closed or put aside. */
  private openComposer(target: ReturnType<typeof cardTarget>): DraftSession {
    const s: DraftSession = DraftSession.open(target, {}, { redraw: () => this.b.host.redraw(), closed: () => { if (this.composer?.session === s) this.composer = null; }, said: m => this.b.host.ctx.flash(m, 8000) });
    return s;
  }

  /** A key in the composer: typing is its draft's; what ends it runs the board's action, as a click would. */
  composerKey(k: Key) {
    const s = this.composer!.session;
    // Reference completion ([[ (( [file::), as in every draft: the editing component's, from this board's connection.
    const before = s.draft.text;
    s.key(k, { completer: completerFor(s.draft, this.b.host.ctx.board, () => this.b.host.redraw()), run: cmd => this.composerCommand(cmd) });
    if (s.draft.text !== before) this.watchTwin();
    this.b.host.redraw();
  }

  /**
   * Open work the new roadmap item looks like, asked on its title as it's typed (PIE-1258, seen in use Oct 29: the offer
   * came only once the chips were in, two round trips). Once the title has settled for a moment the service's
   * `roadmap.items.similar` is asked, never on every key; the answer is dropped when the title moved on meanwhile.
   */
  private watchTwin() {
    const C0 = this.composer;
    if (C0?.kind !== "card" || C0.planning || C0.parent) return;
    const title = draftTitle(C0.session.draft.text);
    clearTimeout(C0.twinTimer);
    // A title cut too short to ask about takes the offer off the row; a changed one keeps it until its own answer lands.
    if (!asksTwin(title)) { C0.twin = undefined; C0.session.draft.attachChord = false; return; }
    if (C0.asked?.title === title) return;
    C0.twinTimer = setTimeout(() => {
      if (this.composer !== C0 || draftTitle(C0.session.draft.text) !== title) return;
      void this.askTwin(C0, title).then(asked => { this.keepTwin(C0, asked); this.b.host.redraw(); });
    }, TWIN_SETTLE_MS);
  }

  /** The service's twins for `title`: the first one it calls a twin, or none. Null when it didn't answer. */
  private async askTwin(C0: Extract<Composer, { kind: "card" }>, title: string, body?: string): Promise<TwinAsked | null> {
    const asked = await this.twinOf(title, body);
    return asked && this.composer === C0 ? asked : null;
  }

  /** Open work a new item looks like, by the service (`roadmap.items.similar`): its first twin, or none; null unanswered. */
  private async twinOf(title: string, body?: string): Promise<TwinAsked | null> {
    const answer = await this.b.host.ctx.board.request("roadmap.items.similar", { input: { title, ...(body ? { body } : {}) } }, 8000).catch(() => null);
    if (!answer) return null;
    const found = answer.candidates.find(c => answer.twins.includes(c.workId));
    return { title, ...(found ? { twin: { title, workId: found.workId, said: `looks like ${found.said}` } } : {}) };
  }

  /** An answer kept on the composer, and drawn on its row, while its title is still the draft's. */
  private keepTwin(C0: Extract<Composer, { kind: "card" }>, asked: TwinAsked | null) {
    if (!asked || this.composer !== C0 || draftTitle(C0.session.draft.text) !== asked.title) return;
    C0.asked = asked;
    C0.twin = asked.twin;
    C0.session.draft.attachChord = !!asked.twin;
  }

  /**
   * Ctrl+S on a new roadmap item: its twin, asked beside the plan and said before what the plan says of its chips
   * (attaching needs none). A twin already on the composer's row was seen, so this press files it new; one first found
   * now is shown, and refused once.
   */
  private async twinAtSave(C0: Extract<Composer, { kind: "card" }>, lane: Lane, parent: string | undefined, body: string): Promise<{ plan: CardPlan; fileNew: boolean }> {
    const shown = C0.twin, title = draftTitle(body);
    clearTimeout(C0.twinTimer);
    const rest = body.split("\n").slice(headerLine(body).line + 1).join("\n").trim();
    const [asked, planned] = await Promise.all([C0.asked?.title === title ? C0.asked : this.askTwin(C0, title, rest || undefined), this.cardPlan(lane, parent, body).then(plan => ({ plan }), (e: unknown) => ({ refused: e }))]);
    this.keepTwin(C0, asked);
    const twin = asked?.twin;
    if (twin && shown?.workId !== twin.workId) throw new ActionRefused(`open work looks like it: ctrl+s again files it new · [attach here] or ctrl+x a adds it to ${twin.workId}`);
    if ("refused" in planned) throw planned.refused;
    return { plan: planned.plan, fileNew: !!twin };
  }

  composerCommand(cmd: DraftCommand) {
    const C0 = this.composer!, d = C0.session.draft;
    if (cmd === "save") void this.submitComposer();
    else if (cmd === "editor") void this.b.host.pressAction(BOARD_ACTIONS, "composer.external", {});
    else if (cmd === "pick") void this.b.host.pressAction(BOARD_ACTIONS, "composer.pick", {});
    else if (cmd === "attach") void this.b.host.pressAction(BOARD_ACTIONS, "card.attach", {});
    // A new card has no reader beside it to open a link in: open it from the card once it's made.
    else if (cmd === "follow") this.b.host.ctx.flash("ctrl+l opens a link from a note's edit or a comment; a new card's links open once it's made");
    else if (cmd === "image") { this.b.host.ctx.flash("a picture goes into a note's edit or a comment; make the card, then e on it"); }
    // cmd+c: the draft's selection to the person's clipboard, through the draft's copy action.
    else if (cmd === "copy") void Dispatcher.of(DRAFT_ACTIONS, d, () => this.b.host.ctx).press("draft.copy").then(r => { const c = r as { text: string; chars: number } | undefined; if (c && this.b.host.ctx.copy?.(c.text) !== false) this.b.host.ctx.flash(`copied ${c.chars} chars`); this.b.host.redraw(); });
    // Esc on nothing typed closes it; esc, esc on typed text puts it aside as unsent (never created), and says where.
    else if (cmd === "close" || cmd === "discard") void this.b.host.pressAction(BOARD_ACTIONS, "composer.close", cmd === "discard" ? { discard: true } : {});
  }

  /**
   * The person leaves the new card or note they're writing (a click outside it, or esc twice): its session
   * leaves (never created: ctrl+s creates), and typed text is put aside as unsent where n or N brings it back.
   */
  async leaveComposer(): Promise<LeaveResult> {
    const C0 = this.composer;
    if (!C0) return { left: "nothing" };
    const r = await C0.session.leave(USER);
    this.b.host.redraw();
    return r;
  }

  /** Close the new card or note (esc): unchanged, it goes; typed text only with `discard`, put aside as unsent. */
  closeComposer(discard: boolean): { closed: boolean; keptAt?: string; said?: string } {
    const C0 = this.composer;
    if (!C0) return { closed: false };
    if (C0.session.dirty && !discard) throw new ActionRefused("there's typed text; ctrl+s creates it, discard=true puts it aside as unsent");
    const r = C0.session.close(discard);
    if (r.said) this.b.host.ctx.flash(r.said, 8000);
    this.b.host.redraw();
    return r;
  }

  /** Ctrl+T in the composer: insert from a picker at its cursor (src/pick.ts), as in every draft. */
  /** ctrl+x ctrl+e in the composer: its text to $EDITOR (the person's terminal: the board's shape is locked), back when it exits. */
  externalComposer() {
    const C0 = this.composer;
    if (!C0) throw new ActionRefused("no new card or note is being written");
    const d = C0.session.draft;
    if (d.busy) throw new ActionRefused("the new card is being created");
    void openInEditor(this.b.host.ctx, d, () => this.composer?.session.draft === d).then(() => { this.watchTwin(); this.b.host.redraw(); });
    return { external: true };
  }

  async pickComposer(channel?: string): Promise<Picked> {
    const C0 = this.composer;
    if (!C0) throw new ActionRefused("no new card or note is being written");
    const d = C0.session.draft, board = this.b.host.ctx.board;
    if (d.busy) throw new ActionRefused("the new card is being created");
    const r = await pickInto(this.b.host.ctx, d, { socket: board.path, name: board.outline }, { ...(channel !== undefined ? { channel } : {}), held: () => this.composer?.session.draft === d });
    if ("kept" in r) this.b.host.ctx.flash(`${r.why}: ${r.kept} · copied to ${r.at}`, 12000);
    else if ("nothing" in r) d.status.say(r.nothing);
    this.b.host.redraw();
    return r;
  }

  /** Ctrl+S in the composer: create it (the card adapter, through card.create or note.create). A refusal keeps the text, says why, and copies it to disk. */
  async submitComposer(actor: Actor = USER) {
    const C0 = this.composer;
    if (!C0) return;
    this.b.host.redraw();
    const r = await C0.session.submit(actor);
    if (!r.ok) this.b.host.ctx.flash(r.why);
    this.b.host.redraw();
  }

  /**
   * A new card in `lane`: the text, with the properties the lane needs appended to its first line, is
   * checked against the lane's whole query as the service would read it, then created under the lane's
   * parent. `create` has no revision or request id, so a lost answer is looked for, never retried.
   * A roadmap lane's card is a roadmap item, made by the workboard's allocator instead (createItem).
   */
  async createCard(lane: Lane, text: string, actor: Actor, parent?: string, fileNew = false): Promise<{ id: string; workId?: string; lane: string; parent: string; text: string; bornWith: string[]; recordedAs: RecordedAs }> {
    const body = text.replace(/\s+$/, "");
    if (!body.trim()) throw new ActionRefused("type the card's title first");
    // A person's new roadmap item in its composer: the twin is asked on the title beside the plan, and said first.
    // Only the composer's own text: a person's card.create of other words is answered by createItem, as without one.
    const C0 = this.composer?.kind === "card" && this.composer.lane === lane && draftTitle(this.composer.session.draft.text) === draftTitle(body) ? this.composer : null;
    const person = isPerson(actor);
    // Pressed before the lane's plan arrived: wait for it, so a roadmap lane's twin is still said first.
    if (C0?.planning) await C0.planned?.catch(() => undefined);
    if (C0 && !C0.planning && !C0.parent && person && !fileNew) {
      const saved = await this.twinAtSave(C0, lane, parent, body);
      return this.createItem(lane, actor, saved.plan, saved.fileNew, true);
    }
    const plan = await this.cardPlan(lane, parent, body);
    if (!plan.parent) return this.createItem(lane, actor, plan, fileNew);
    const composed = plan.plan.text;
    if (composed === undefined) throw new ActionRefused(`the outline planned no text for the card in ${lane.name}`);
    const m = await this.landCreate(plan.parent.id, composed, actor);
    const bornWith = plan.plan.bornWith ?? [];
    this.created(lane, m, actor, `created in ${lane.name} · ${titleOf(m)}${bornWith.length ? ` · born with ${bornWith.map(p => `${p.key}=${p.value}`).join(" ")}` : ""}`, `created in ${lane.name} under ${plan.parent.id.slice(0, 8)}`);
    return { id: m.id, lane: lane.name, parent: plan.parent.id, text: m.text, bornWith: bornWith.map(p => `${p.key}=${p.value}`), recordedAs: recordedAnswer(actor, "new") };
  }

  /**
   * A roadmap item in a roadmap lane, through the workboard's allocator (`roadmap.items.create`), never
   * a plain create: it issues the work-id and puts the item under its project's one active work queue.
   * Its fields are the service's plan (typed tokens, else the lane's plain clauses, else its create::
   * default), already checked against the lane's whole query. Not retried: a lost answer is looked for
   * among the project's newest items.
   */
  private async createItem(lane: Lane, actor: Actor, plan: CardPlan, fileNew = false, twinAsked = false) {
    const board = this.b.host.ctx.board;
    let input = plan.plan.item;
    if (!input) throw new ActionRefused(`the outline planned no roadmap item for ${lane.name}`);
    // Open work it looks like (PIE-1258): the person is never blocked. The composer's own card was asked on its title
    // (watchTwin, twinAtSave: ctrl+s once it's shown files it new, [attach here] adds it there); a person's card.create
    // of other words is asked here, the same twinOf. An agent's create is the service's to refuse, with the twins named.
    if (isPerson(actor) && !fileNew && !twinAsked) {
      const twin = (await this.twinOf(input.title, input.body))?.twin;
      if (twin) throw new ActionRefused(`${twin.said} · card.create … new=true files it anyway, card.attach twin=${twin.workId} text=… adds it there`);
    }
    if (fileNew) input = { ...input, new: true };
    const since = Date.now();
    let made: { workId: string; workQueueId: string; block: Msg };
    try { made = await board.createRoadmapItem(input, actor); }
    catch (e) {
      if (e instanceof Refused) throw new ActionRefused(e.kind === "conflict" && !isPerson(actor) ? `${e.message}\nIn the door: card.create … new=true files it anyway; card.attach twin=<Work ID> text=… adds it there.` : e.message, e.kind);
      const found = await this.findItem(input.project, input.title, since).catch(() => null);
      if (!found) throw new ActionRefused(`the outline didn't answer (${e instanceof Error ? e.message : String(e)}) and no such item is there yet; the outcome is unknown, so look before creating it again`);
      made = { workId: prop(found, "work-id") ?? "", workQueueId: found.parentId ?? "", block: found };
    }
    const m = made.block;
    const fields = [`priority=${input.priority}`, `arc=${input.arc}`, ...input.tracks.map(t => `track=${t}`), `project=${input.project}`];
    this.created(lane, m, actor, `created ${made.workId} in ${lane.name} · ${input.title} · ${fields.join(" ")}`, `created ${made.workId} in ${lane.name} under its work queue ${made.workQueueId.slice(0, 8)}`);
    // What the allocator gave it, read off the block it made (its stage rule is the service's, not ours).
    const props = m.properties;
    const bornWith = ["type", "priority", "work-stage", "work-batch", "project", "arc", "track"].flatMap(k => props.filter(p => p.key === k).map(p => `${k}=${p.value}`));
    return { id: m.id, workId: made.workId, lane: lane.name, parent: made.workQueueId, text: m.text, bornWith, recordedAs: recordedAnswer(actor, "new") };
  }

  /**
   * `card.attach`: an ask added under open work instead of a ticket of its own (the service's roadmap.items.attach).
   * With text, that text; without, the composer's draft goes through its own submit (so it ends as created does).
   */
  async attachCard(twin: string | undefined, text: string | undefined, actor: Actor): Promise<{ attached: string; recordedAs: RecordedAs } | { submitted: boolean }> {
    const C0 = this.composer?.kind === "card" ? this.composer : null;
    if (text === undefined) {
      if (!C0) throw new ActionRefused("no new card is being written; card.attach twin=PIE-n text=… adds an ask under that item");
      const to = twin ?? C0.twin?.workId;
      if (!to) throw new ActionRefused("the new card hasn't been offered open work yet: ctrl+s asks, or name it with twin=PIE-n");
      C0.attachTo = to;
      await this.submitComposer();
      return { submitted: !this.composer };
    }
    if (!twin) throw new ActionRefused("card.attach needs twin=<Work ID>: the open item to add it to");
    const lines = text.replace(/\s+$/, "").split("\n");
    const title = lines[0]!.replace(/\[[^\]]+::[^\]]*\]/g, "").trim();
    if (!title) throw new ActionRefused("type the ask's first line first");
    const body = lines.slice(1).join("\n").trim();
    let r: { attached: string; block: Msg };
    try { r = await this.b.host.ctx.board.attachToItem({ item: twin, title, ...(body ? { body } : {}) }, actor); }
    catch (e) { throw new ActionRefused(e instanceof Error ? e.message : String(e)); }
    this.b.host.ctx.flash(`added under ${r.attached} · ${title}${actor.kind === "agent" ? ` · by ${agentLabel(actor)}` : ""}`);
    this.b.host.redraw();
    return { attached: r.attached, recordedAs: recordedAnswer(actor, "new") };
  }

  /** After an allocator create whose answer was lost: the project's item with that title, made since. */
  private async findItem(project: string, title: string, since: number): Promise<Msg | null> {
    const items = await this.b.host.ctx.board.query(`type=roadmap-item project=${project}`, 50, "created", "desc");
    return items.find(m => m.createdAt >= since - 1000 && m.text.split("\n")[0]!.includes(`— ${title}`)) ?? null;
  }

  /**
   * After a create landed: who did it, and the lane asked for it. The person's create selects the new
   * card (and opens a collapsed lane to show it); an agent's never moves the person's selection, focus
   * or saved layout.
   */
  private created(lane: Lane, m: Msg, actor: Actor, flash: string, result: string) {
    this.b.lastWrite = { what: "create", id: m.id, result, ...(byOf(actor)) };
    asActor(this.b.host.ctx, actor).flash(flash);
    if (actor.kind !== "agent") {
      lane.want = m.id; lane.wantVerb = "created";
      this.b.lane = this.b.lanes.indexOf(lane); this.b.toLanes();
      this.b.unfold(lane);
    } else void lane.refreshNow(this.b.host);   // an agent's lane lists its card at once, off the screen too
    // The create's change record asks the lanes that could hold it.
    this.b.host.redraw();
  }

  /** A note under `parentId` (a card's child), as it was typed. */
  async createNote(parentId: string, text: string, actor: Actor): Promise<{ id: string; parent: string; text: string; recordedAs: RecordedAs }> {
    const body = text.replace(/\s+$/, "");
    if (!body.trim()) throw new ActionRefused("type the note first");
    const m = await this.landCreate(parentId, body, actor);
    const parent = await this.b.host.ctx.board.get(parentId).catch(() => null);
    if (parent) for (const r of this.b.readers()) r.refresh(parent);
    asActor(this.b.host.ctx, actor).flash(`added a note under ${parent ? titleOf(parent) : parentId} · ${titleOf(m)}`);
    this.b.lastWrite = { what: "note", id: m.id, result: `created under ${parentId}`, ...(byOf(actor)) };
    for (const r of this.b.readers()) if (r.msg?.id === parentId) r.surface.noteAgent(actor, "added a note under this card");
    this.b.host.redraw();
    return { id: m.id, parent: parentId, text: m.text, recordedAs: recordedAnswer(actor, "new") };
  }

  /** One `create`, never retried: a refusal is the service's reason; a lost answer is looked for. */
  private async landCreate(parentId: string, text: string, actor: Actor): Promise<Msg> {
    const since = Date.now();
    try {
      return await this.b.host.ctx.board.createBlock(parentId, text, actor);
    } catch (e) {
      if (e instanceof Refused) throw new ActionRefused(e.message);
      const found = await this.b.host.ctx.board.findCreated(parentId, text, since).catch(() => null);
      if (found) return found;
      throw new ActionRefused(`the outline didn't answer (${e instanceof Error ? e.message : String(e)}) and no such block is there yet; the outcome is unknown, so look before creating it again`);
    }
  }

  drawComposer(canvas: Canvas, W: number, H: number, look: StyleValues) {
    const C0 = this.composer!, d = C0.session.draft;
    const r: Rect = { col: Math.round(W * 0.18), row: Math.round(H * 0.1), cols: Math.round(W * 0.64), rows: Math.max(10, Math.round(H * 0.6)) };
    canvas.clear(r, bg(C.black));
    const title = C0.kind === "card" ? `new card · ${C0.lane.name}` : `new note under · ${drawEllipsized(titleOf(C0.parent), 40)}`;
    canvas.box(r, fg(C.yellow), fg(C.yellow) + title, "");
    const w = r.cols - 2;
    const line = (s: string, color: number) => fg(color) + pad(s, w) + RESET;
    const status = C0.kind === "card" && C0.planning ? [
      line(`asking the outline what a card in ${C0.lane.name} is born with…`, C.dark),
      line(d.note || "the first line is the title; [key::value] tokens are properties", C.dark),
    ] : C0.kind === "card" ? [
      line(`born with ${C0.born.map(p => `${p.key}=${p.value}`).join(" ") || "nothing (the lane sets no values)"}${C0.defaults.length ? ` · ${C0.defaults.map(p => `${p.key}=${p.value}`).join(" ")} unless the text says otherwise` : ""}`, C.lgreen),
      ...(C0.needs.length ? [line(`the text must also meet ${C0.needs.join(" and ")} · e.g. type [${hintToken(C0.needs[0]!)}]`, C.yellow)] : []),
      C0.parent
        ? line(`under ${C0.parent.title} · ${C0.parent.why}`, C.cyan)
        : line(`roadmap item · type ${roadmapHint(C0) || "its title"} · the allocator issues its work-id and files it in its project's work queue`, C.cyan),
      line(d.note || "the first line is the title; [key::value] tokens are properties", d.note.startsWith("not created") ? C.lred : C.dark),
    ] : [
      line(`a child note of ${drawEllipsized(titleOf(C0.parent), 60)}`, C.cyan),
      line(d.note || "the first line is the title", d.note.startsWith("not created") ? C.lred : C.dark),
    ];
    const lines = renderEditor(d, { look, title: C0.kind === "card" ? `new card in ${C0.lane.name}` : "new note", status, ...(C0.kind === "card" && C0.twin ? { twin: C0.twin.said } : {}), by: writtenBy(d, "save"), preview: (t, pw, links) => draftPreviewDoc(t, pw, { board: this.b.host.ctx.board, redraw: () => this.b.host.redraw() }, links), pick: true }, w, r.rows - 2);
    this.composerAt = r;
    lines.forEach((l, i) => canvas.text(r.col + 1, r.row + 1 + i, l, w));
    const completion = completerOf(d);
    if (completion) drawCompletionFloat(canvas, completion, { col: 0, row: 0, cols: canvas.cols, rows: canvas.rows }, { ...r, col: r.col + 1, row: r.row + 1 }, look);
  }
}
