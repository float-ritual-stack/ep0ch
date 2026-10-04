// The daily brief (PIE-435): the newest note with `type::daily-brief`, in the shared reader at full width.
// An agent writes one each morning (skills/daily-brief/SKILL.md); its figures and embeds are live. `,` and
// `.` step to the previous and next day's brief; a followed link opens in a reader beside, so the brief
// stays where it is.
//
// A screen spec on the desk (PIE-515: `briefSpec`): one tile of its own kind (`brief`, BRIEF_KIND), a reader that
// knows which notes are briefs and which one it shows; the layout, the reader's sessions, the mouse, `act` and `peek`
// are the desk's. `,` and `.` are the spec's keys for the kind's actions (BRIEF_ACTIONS); a note opened from it goes
// to a reader beside (the kind's open rule, `beside`), unless it's another brief, which it steps to.
import { subject, type Msg } from "../board";
import { USER, type OutlineEvent, type SocketBoard } from "../socket";
import { C, fg, pad, RESET } from "../style";
import { ActionRefused, actionSet, def } from "../surface/actions";
import type { HeaderInfo, OpenHow, SurfaceHost } from "../surface/note";
import { bbsDate } from "../text";
import { newNoteOffer } from "../new-note";
import { ch, type Key } from "../term";
import { ReaderPane, type DeskApi, type PaneView } from "../desk/panes";
import type { ScreenSpec } from "../desk/screen-spec";
import { tileKind, type KindHost, type TileKind, type TileKindName } from "../desk/tile-kinds";

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

/**
 * The brief's reader: a note surface that shows only the brief it's on, and knows the briefs (every one, oldest
 * first, read again as the outline changes). It never follows the desk's current note; a link followed in it opens
 * beside (its kind's open rule), unless it's another brief, which it steps to.
 */
export class BriefReader extends ReaderPane {
  override readonly kind: TileKindName = "brief";
  /** Every brief, oldest first; null until read. */
  briefs: Msg[] | null = null;
  /** The brief shown, by its place in `briefs`. */
  private at = -1;
  private problem = "";
  private reload: Timer | null = null;
  constructor() { super(false); }
  override title() { return this.heading(); }
  override hint() { return `, . day · ${super.hint()}`; }
  /** `,` and `.` step a day (brief.step), wherever the brief is (its own screen, a tile on the desk), unless the person types. */
  override key(k: Key, desk: DeskApi): boolean {
    const c = ch(k);
    if ((c === "," || c === ".") && !this.holdsKeys && !desk.holdsKeys?.()) { void desk.press?.(this, BRIEF_ACTIONS, "brief.step", { by: c === "," ? -1 : 1 }); return true; }
    return super.key(k, desk);
  }
  /** The desk's current note changed: the brief stays. */
  override select() {}
  /**
   * The surface's host, with the brief's own header (the surface's `header` hook) while it shows a brief: the day and
   * "n of m briefs" first, then the title and who wrote it. A link to another brief steps to it, as `,` `.` do.
   */
  override host(desk: DeskApi): SurfaceHost {
    const shown = this.shown;
    return {
      ...super.host(desk),
      navigate: (m: Msg, how?: OpenHow) => {
        if (!how?.fresh && this.dayOf(m) >= 0) { void desk.perform?.("brief.show", { id: m.id }, how?.by ?? USER, this); return; }
        desk.setCurrent(m, { reveal: true, from: this, ...how });
      },
      ...(shown && this.msg?.id === shown.id ? { header: (m: Msg, w: number, info: HeaderInfo) => briefHeader(m, w, info, shown) } : {}),
    };
  }
  override render(w: number, h: number, focused = false, desk?: DeskApi): PaneView {
    const empty = this.emptyLines();
    if (!empty) return super.render(w, h, focused, desk);
    // No brief yet: a note to write meanwhile, offered.
    if (!this.briefs?.length && this.briefs && !this.problem) { const { line, spot } = newNoteOffer(empty.length + 1); return { lines: [...empty, "", line].map(l => pad(l, w)), spots: [spot] }; }
    return { lines: empty.map(l => pad(l, w)) };
  }

  /** Read the list again; the shown brief stays shown (a new one only changes the count), or the newest when first read. */
  async load(desk: DeskApi, first = false) {
    try {
      const list = await findBriefs(desk.ctx.board);
      const shown = this.briefs?.[this.at]?.id;
      this.briefs = list;
      this.problem = "";
      const keep = shown ? list.findIndex(m => m.id === shown) : -1;
      if (first || keep < 0) this.showAt(list.length - 1, desk);
      else this.at = keep;
    } catch (e) {
      this.problem = `couldn't ask the outline for briefs: ${e instanceof Error ? e.message : String(e)}`;
    }
    desk.redraw();
  }

  /** A brief written, edited, trashed or restored anywhere: the list is asked again (once per burst). */
  override onEvent(desk: DeskApi, e?: OutlineEvent) {
    super.onEvent(desk);
    // Comments and reorders can't make or unmake a brief, so they aren't asked about.
    if (!e || (e.change ? e.change.kind === "annotate" || e.change.kind === "reorder" : e.action !== "reset" && e.action !== "reconnected")) return;
    if (this.reload) clearTimeout(this.reload);
    this.reload = setTimeout(() => { this.reload = null; void this.load(desk); }, 300);
  }
  override dispose() { if (this.reload) clearTimeout(this.reload); super.dispose?.(); }

  /** Show the brief at `i` (oldest is 0). False when the reader holds an edit or a comment on another note. */
  private showAt(i: number, desk: DeskApi): boolean {
    const list = this.briefs ?? [];
    const m = list[i];
    if (!m) { this.at = -1; this.show(null, desk); return true; }
    if (this.msg?.id !== m.id && !this.show(m, desk)) return false;
    this.at = i;
    return true;
  }

  /** Where `m` is among the briefs, or -1. */
  dayOf(m: Msg): number { return (this.briefs ?? []).findIndex(b => b.id === m.id); }

  /** The brief shown now, if the reader shows one. */
  get shown(): Stepped | null {
    const m = this.briefs?.[this.at];
    return m && this.msg?.id === m.id ? { date: briefDate(m), n: this.at + 1, of: this.briefs!.length, id: m.id } : null;
  }

  /** The reader's title; the day and the count are in the brief's header (`briefHeader`). */
  heading(): string {
    if (!this.briefs) return "daily brief · asking the outline…";
    if (!this.briefs.length) return "daily brief · none yet";
    const s = this.shown;
    if (!s) return `daily brief · not a brief: ${this.msg ? subject(this.msg).slice(0, 40) : "nothing"} · , . back to the briefs`;
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
   * The previous (-1) or next (1) day's brief. From a note that isn't a brief (an agent's `open` put it here), either
   * key comes back to the brief last shown.
   */
  step(by: number, desk: DeskApi): Stepped {
    const list = this.briefs;
    if (!list) throw new ActionRefused("the briefs are still being read");
    if (!list.length) throw new ActionRefused("there are no briefs yet");
    const back = !this.shown && this.at >= 0;
    const to = back ? this.at : this.at + Math.sign(by);
    if (to < 0) throw new ActionRefused(`this is the oldest brief (${briefDate(list[0]!)})`);
    if (to >= list.length) throw new ActionRefused(`this is the newest brief (${briefDate(list.at(-1)!)})`);
    return this.go(to, desk);
  }

  /** Show the brief at `i` (BRIEF_ACTIONS say an agent's on screen, once the actor rule let it). */
  go(i: number, desk: DeskApi): Stepped {
    if (!this.showAt(i, desk)) throw new ActionRefused("the brief's reader holds an edit or a comment on another note; save or close it first");
    desk.redraw();
    return this.shown!;
  }

  /** The brief for a day (YYYY-MM-DD): the last one written that day. */
  dated(day: string, desk: DeskApi): Stepped {
    const i = (this.briefs ?? []).findLastIndex(m => briefDate(m) === day);
    if (i < 0) throw new ActionRefused(`no brief for ${day}${this.briefs?.length ? `; the briefs run ${briefDate(this.briefs[0]!)} to ${briefDate(this.briefs.at(-1)!)}` : ""}`);
    return this.go(i, desk);
  }

  newest(desk: DeskApi): Stepped {
    if (!this.briefs?.length) throw new ActionRefused("there are no briefs yet");
    return this.go(this.briefs.length - 1, desk);
  }

  describeBrief() { return { brief: this.shown, briefs: this.briefs?.length ?? null, problem: this.problem || undefined }; }
}

/** Which brief is shown. The keys and `act` call the same code. */
export const BRIEF_ACTIONS = actionSet<KindHost>()("brief", {
  "brief.step": def({
    summary: "show the previous (by=-1) or next (by=1) day's brief; refused to an agent while the person is typing here", keys: ", .",
    touches: "screen", replay: "safe", says: r => `showed the brief for ${r.date}`,
    args: { by: { type: "number", about: "-1 for the day before, 1 for the day after" } },
    run({ by }, { pane, desk }) { if (by !== 1 && by !== -1) throw new ActionRefused("brief.step: by is -1 or 1"); return (pane as BriefReader).step(by, desk); },
  }),
  "brief.newest": def({
    summary: "show the newest brief",
    touches: "screen", replay: "safe", says: r => `showed the brief for ${r.date}`,
    args: {},
    run(_, { pane, desk }) { return (pane as BriefReader).newest(desk); },
  }),
  "brief.date": def({
    summary: "show the brief for a day (date=YYYY-MM-DD)",
    touches: "screen", replay: "safe", says: r => `showed the brief for ${r.date}`,
    args: { date: { type: "string", about: "the day, YYYY-MM-DD" } },
    run({ date }, { pane, desk }) { return (pane as BriefReader).dated(date.trim(), desk); },
  }),
  "brief.show": def({
    summary: "show a brief by its block id (a link to another day's brief, followed in it, or an agent's `open` of one, steps there)",
    keys: "⏎ or a click on a link to another brief, an \"Earlier briefs\" row",
    touches: "screen", replay: "safe", says: r => `showed the brief for ${r.date}`,
    args: { id: { type: "string", about: "the brief's block id" } },
    run({ id }, { pane, desk }) {
      const b = pane as BriefReader, i = (b.briefs ?? []).findIndex(m => m.id === id || (id.length >= 8 && m.id.startsWith(id)));
      if (i < 0) throw new ActionRefused(`${id} isn't a daily brief`);
      return b.go(i, desk);
    },
  }),
});

/** The brief as a tile kind: a reader of its own (no `^W o` key), its actions, its open rule. */
export function briefKind(): TileKind {
  const reader = tileKind("reader")!;
  return {
    ...reader, kind: "brief", about: "the daily brief: the newest type::daily-brief note, , . stepping between days", noun: "the brief", keys: [{ key: "f", label: "brief" }],
    make: () => new BriefReader(), actions: BRIEF_ACTIONS, inherits: reader.actions ? [reader.actions] : undefined,
    // A note opened from it goes to a reader beside; the brief stays where it is.
    policy: { opens: "beside" },
    start: (p, env) => void (p as BriefReader).load(env.desk, true),
    // An agent's open (`ep0ch open <id>`, ScreenSpec.lands): a brief is stepped to (the same actor rule as
    // brief.step, its refusal answered); any other note opens beside it.
    take: (p, m, desk, by) => {
      const b = p as BriefReader, actor = by ?? USER, day = b.dayOf(m);
      if (day < 0) { desk.setCurrent(m, { reveal: true, from: b, by: actor }); return null; }
      const no = desk.ruleFor?.("screen", actor);
      if (no) return no;
      try { b.go(day, desk); return null; } catch (e) { return e instanceof Error ? e.message : String(e); }
    },
    peek: p => (p as BriefReader).describeBrief(),
  };
}

/** The daily brief: its reader at full width; `,` and `.` step between days. */
export function briefSpec(): ScreenSpec {
  return {
    name: "brief", title: "daily brief", lands: "brief",
    // From anywhere on the screen (a reader beside it too); a brief tile on the desk steps with its own , and . keys.
    keys: [{ key: ",", action: "brief.step", args: { by: -1 } }, { key: ".", action: "brief.step", args: { by: 1 } }],
    layout: { focus: "brief", root: { t: "leaf", kind: "brief", name: "brief" } },
  };
}
