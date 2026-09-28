// The daily brief (PIE-435): the newest note with `type::daily-brief`, in the shared reader at full width.
// An agent writes one each morning (skills/daily-brief/SKILL.md); its figures and embeds are live. `,` and
// `.` step to the previous and next day's brief; a followed link opens in a reader beside, so the brief
// stays where it is.
//
// Built on the desk (a preset, as the showcase's stages are): the layout tree, the reader's sessions, the
// mouse, `act` and `peek` are the desk's. This file only adds which note is the brief and the day keys.
import type { Ctx } from "../app";
import { subject, type Msg } from "../board";
import { AGENT_ACTOR_ID, USER, type Actor, type OutlineEvent, type SocketBoard } from "../socket";
import { C, fg, pad, RESET } from "../style";
import type { Key } from "../term";
import { ActionRefused, ActionSet, agentLabel, type ActRequest } from "../surface/actions";
import type { HeaderInfo, OpenHow, SurfaceHost } from "../surface/note";
import { bbsDate } from "../text";
import { Desk } from "../desk/desk";
import { ReaderPane, type DeskApi, type Pane, type PaneView } from "../desk/panes";

export const BRIEF_TYPE = "daily-brief";
/** How many briefs the door asks for: years of mornings. */
const BRIEF_LIMIT = 1000;

/** A brief's day: its `brief-date` (YYYY-MM-DD), or the local day it was created when it has none. */
export function briefDate(m: Msg): string {
  const d = /^\d{4}-\d{2}-\d{2}/.exec(m.props["brief-date"]?.trim() ?? "")?.[0];
  if (d) return d;
  const c = new Date(m.createdAt);
  return `${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, "0")}-${String(c.getDate()).padStart(2, "0")}`;
}

/** Oldest first: by day, then by when it was last updated (a day's second brief, a redraft). */
export function orderBriefs(list: readonly Msg[]): Msg[] {
  return [...list].sort((a, b) => briefDate(a).localeCompare(briefDate(b)) || a.updatedAt - b.updatedAt);
}

/**
 * Every `type::daily-brief` note, oldest first, as list rows (the reader reads the one it shows). The
 * service sorts by created or updated only, so the day order (`brief-date`) is the door's.
 */
export async function findBriefs(board: SocketBoard): Promise<Msg[]> {
  return orderBriefs(await board.query(`type=${BRIEF_TYPE}`, BRIEF_LIMIT, "updated", "desc", true));
}

const weekday = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short" });

/**
 * The brief's reader: a note surface that shows only what the brief screen puts in it. It never follows
 * the desk's current note, and a link followed in it opens beside (the desk's current note), never here.
 */
export class BriefReader extends ReaderPane {
  /** The screen it belongs to, for its title and its empty state (set once the screen is built). */
  screen: Brief | null = null;
  constructor() { super(false); }
  override title() { return this.screen?.heading() ?? "daily brief"; }
  override hint() { return `, . day · ${super.hint()}`; }
  /** The desk's current note changed: the brief stays. */
  override select() {}
  /**
   * The surface's host, with the brief's own header (the surface's `header` hook) while it shows a brief:
   * the day and "n of m briefs" first, then the title and who wrote it.
   */
  override host(desk: DeskApi): SurfaceHost {
    const shown = this.screen?.shown;
    return {
      ...super.host(desk),
      navigate: (m: Msg, how?: OpenHow) => desk.setCurrent(m, { reveal: true, from: this, ...how }),
      ...(shown && this.msg?.id === shown.id ? { header: (m: Msg, w: number, info: HeaderInfo) => briefHeader(m, w, info, shown) } : {}),
    };
  }
  override render(w: number, h: number, focused = false, desk?: DeskApi): PaneView {
    const empty = this.screen?.emptyLines();
    return empty ? { lines: empty.map(l => pad(l, w)) } : super.render(w, h, focused, desk);
  }
}

type Stepped = { date: string; n: number; of: number; id: string };

/**
 * The brief's header rows (SurfaceHost.header): the day and where it is among the briefs, lead, so a
 * narrow pane cuts the rest; then the title, and who wrote it when, with its comments.
 */
export function briefHeader(m: Msg, w: number, info: HeaderInfo, s: Stepped): string[] {
  const said = info.comments?.total ? ` · ■ ${info.comments.open ? `${info.comments.open} open comment${info.comments.open === 1 ? "" : "s"}` : `${info.comments.total} resolved`} (m)` : "";
  return [
    pad(`${fg(C.yellow)}${weekday(s.date)} ${s.date}${fg(C.lcyan)} · ${s.n} of ${s.of} brief${s.of === 1 ? "" : "s"}${fg(C.dark)} · , earlier · . later`, w) + RESET,
    fg(C.white) + pad(subject(m), w) + RESET,
    pad(`${fg(C.brown)}${m.author ?? "?"} · ${bbsDate(m.updatedAt)}${fg(C.dark)}${info.properties ? ` · i ${info.properties} propert${info.properties === 1 ? "y" : "ies"}` : ""}${said}`, w) + RESET,
  ];
}

export class Brief extends Desk {
  readonly reader: BriefReader;
  /** Every brief, oldest first; null until read. */
  briefs: Msg[] | null = null;
  /** The brief shown, by its place in `briefs`. */
  private at = -1;
  private problem = "";
  private reload: Timer | null = null;

  constructor() {
    const reader = new BriefReader();
    super({ title: "daily brief", panes: [reader] });
    this.reader = reader;
    reader.screen = this;
  }

  override enter(ctx: Ctx) {
    super.enter(ctx);
    void this.load(true);
  }

  /** Read the list again; the shown brief stays shown (a new one only changes the count), or the newest when first read. */
  async load(first = false) {
    try {
      const list = await findBriefs(this.ctx.board);
      const shown = this.briefs?.[this.at]?.id;
      this.briefs = list;
      this.problem = "";
      const keep = shown ? list.findIndex(m => m.id === shown) : -1;
      if (first || keep < 0) this.showAt(list.length - 1);
      else this.at = keep;
    } catch (e) {
      this.problem = `couldn't ask the outline for briefs: ${e instanceof Error ? e.message : String(e)}`;
    }
    this.redraw();
  }

  /** Show the brief at `i` (oldest is 0). False when the reader holds an edit or a comment on another note. */
  private showAt(i: number): boolean {
    const list = this.briefs ?? [];
    const m = list[i];
    if (!m) { this.at = -1; this.reader.show(null, this); return true; }
    if (this.reader.msg?.id !== m.id && !this.reader.show(m, this)) return false;
    this.at = i;
    return true;
  }

  /** The brief shown now, if the reader shows one. */
  get shown(): Stepped | null {
    const m = this.briefs?.[this.at];
    return m && this.reader.msg?.id === m.id ? { date: briefDate(m), n: this.at + 1, of: this.briefs!.length, id: m.id } : null;
  }

  /** The reader pane's title; the day and the count are in the brief's header (`briefHeader`). */
  heading(): string {
    if (!this.briefs) return "daily brief · asking the outline…";
    if (!this.briefs.length) return "daily brief · none yet";
    const s = this.shown;
    if (!s) return `daily brief · not a brief: ${this.reader.msg ? subject(this.reader.msg).slice(0, 40) : "nothing"} · , . back to the briefs`;
    return `daily brief · ${s.date}`;
  }

  /** What the reader shows while there is no brief to read, or null. */
  emptyLines(): string[] | null {
    if (this.problem) return [fg(C.lred) + this.problem + RESET];
    if (!this.briefs) return [fg(C.dark) + "asking the outline for briefs…" + RESET];
    if (this.briefs.length) return null;
    return [
      fg(C.white) + "No daily brief yet." + RESET, "",
      fg(C.grey) + `A brief is a note with [type::${BRIEF_TYPE}] and [brief-date::YYYY-MM-DD]. Ask an agent to draft this morning's:` + RESET,
      fg(C.grey) + "the daily-brief skill says how (ep0ch --skill daily-brief prints its path)." + RESET,
    ];
  }

  /**
   * The previous (-1) or next (1) day's brief. From a note that isn't a brief (an agent's `open` put it
   * here), either key comes back to the brief last shown.
   */
  step(by: number, actor: Actor = USER): Stepped {
    const list = this.briefs;
    if (!list) throw new ActionRefused("the briefs are still being read");
    if (!list.length) throw new ActionRefused("there are no briefs yet");
    const back = !this.shown && this.at >= 0;
    const to = back ? this.at : this.at + Math.sign(by);
    if (to < 0) throw new ActionRefused(`this is the oldest brief (${briefDate(list[0]!)})`);
    if (to >= list.length) throw new ActionRefused(`this is the newest brief (${briefDate(list.at(-1)!)})`);
    return this.go(to, actor);
  }

  /** Show the brief at `i`, as `actor`; an agent's is said on screen. */
  go(i: number, actor: Actor): Stepped {
    // An agent never moves the page out from under an edit or a comment the person is in.
    if (actor.kind === "agent" && this.personTyping()) throw new ActionRefused("the person is typing here; the brief stays");
    if (!this.showAt(i)) throw new ActionRefused("the brief's reader holds an edit or a comment on another note; save or close it first");
    const s = this.shown!;
    if (actor.kind === "agent") this.ctx.flash(`${agentLabel(actor)} showed the brief for ${s.date}`);
    this.redraw();
    return s;
  }

  /** The brief for a day (YYYY-MM-DD): the last one written that day. */
  dated(day: string, actor: Actor): Stepped {
    const i = (this.briefs ?? []).findLastIndex(m => briefDate(m) === day);
    if (i < 0) throw new ActionRefused(`no brief for ${day}${this.briefs?.length ? `; the briefs run ${briefDate(this.briefs[0]!)} to ${briefDate(this.briefs.at(-1)!)}` : ""}`);
    return this.go(i, actor);
  }

  newest(actor: Actor): Stepped {
    if (!this.briefs?.length) throw new ActionRefused("there are no briefs yet");
    return this.go(this.briefs.length - 1, actor);
  }

  /**
   * A note opened from the brief (a link, a figure row, `u`) that isn't a brief goes to a reader beside it: the one already
   * there, or a new one (the person's keys stay on the brief). alt+⏎ still opens a new reader each time.
   */
  override setCurrent(m: Msg | null, opts: { reveal?: boolean; from?: Pane } & OpenHow = {}) {
    // Another brief (an "Earlier briefs" row, a link to yesterday's): the brief steps to it, as `,` `.` do.
    const day = m && !opts.fresh && opts.from === this.reader ? (this.briefs ?? []).findIndex(b => b.id === m.id) : -1;
    if (day >= 0) {
      try { this.go(day, opts.agent ? { kind: "agent", id: AGENT_ACTOR_ID } : USER); } catch (e) { this.ctx.flash(e instanceof Error ? e.message : String(e)); }
      return;
    }
    if (m && !opts.fresh && (opts.from === this.reader || !opts.from)) this.readerBeside(this.reader, opts.agent ? { kind: "agent", id: AGENT_ACTOR_ID } : USER);
    super.setCurrent(m, opts);
  }

  /** `ep0ch open <id>`: a brief is stepped to; any other note opens beside it. */
  override openBlock(m: Msg) {
    const i = (this.briefs ?? []).findIndex(b => b.id === m.id);
    if (i >= 0) { this.go(i, USER); return; }
    this.setCurrent(m, { reveal: true });
  }

  override key(k: Key, ctx: Ctx) {
    const c = k.kind === "char" && !k.ctrl ? k.ch : "";
    if ((c === "," || c === ".") && !this.personTyping()) {
      try { this.step(c === "," ? -1 : 1); } catch (e) { ctx.flash(e instanceof Error ? e.message : String(e)); }
      return this.redraw();
    }
    super.key(k, ctx);
  }

  override onEvent(e: OutlineEvent) {
    super.onEvent(e);
    // A brief written, edited, trashed or restored anywhere: the list is asked again (once per burst).
    // Comments and reorders can't make or unmake a brief, so they aren't asked about.
    if (e.change ? e.change.kind === "annotate" || e.change.kind === "reorder" : e.action !== "reset" && e.action !== "reconnected") return;
    if (this.reload) clearTimeout(this.reload);
    this.reload = setTimeout(() => { this.reload = null; void this.load(); }, 300);
  }

  override describe() {
    return { ...super.describe(), kind: "brief", brief: this.shown, briefs: this.briefs?.length ?? null, problem: this.problem || undefined };
  }

  override actions() {
    const d = super.actions();
    return { ...d, actions: [...BRIEF_ACTIONS.list(), ...d.actions] };
  }

  override async act(req: ActRequest, actor: Actor): Promise<unknown> {
    if (BRIEF_ACTIONS.has(req.action)) return BRIEF_ACTIONS.runUntyped(req.action, { ...(req.args ?? {}) }, this, actor);
    return super.act(req, actor);
  }
}

/** Which brief is shown. The keys and `act` call the same code. */
export const BRIEF_ACTIONS = new ActionSet<{ "brief.step": { by: number }; "brief.newest": Record<string, never>; "brief.date": { date: string } }, Brief>("brief", {
  "brief.step": {
    summary: "show the previous (by=-1) or next (by=1) day's brief; refused to an agent while the person is typing here", keys: ", .",
    args: { by: { type: "number", about: "-1 for the day before, 1 for the day after" } },
    run({ by }, b, actor) { if (by !== 1 && by !== -1) throw new ActionRefused("brief.step: by is -1 or 1"); return b.step(by, actor); },
  },
  "brief.newest": {
    summary: "show the newest brief",
    args: {},
    run(_, b, actor) { return b.newest(actor); },
  },
  "brief.date": {
    summary: "show the brief for a day (date=YYYY-MM-DD)",
    args: { date: { type: "string", about: "the day, YYYY-MM-DD" } },
    run({ date }, b, actor) { return b.dated(date.trim(), actor); },
  },
});
