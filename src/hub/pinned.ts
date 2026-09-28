// A page pinned in the shared reader: the note a `[[page]]` address names (`claude-now`, the agents'
// running status for the day), live. The reader never follows the desk's current note; a link followed
// in it opens in a reader beside, so the page stays where it is. A page that doesn't exist yet is waited
// for: the screen asks again when the outline changes.
//
// Built on the desk (a preset, as the brief is). This file only adds which note is pinned.
import type { Ctx } from "../app";
import type { Msg } from "../board";
import { AGENT_ACTOR_ID, USER, type OutlineEvent } from "../socket";
import { C, fg, pad, RESET } from "../style";
import type { OpenHow, SurfaceHost } from "../surface/note";
import { Desk } from "../desk/desk";
import { ReaderPane, type DeskApi, type Pane, type PaneView } from "../desk/panes";

export class PinnedReader extends ReaderPane {
  screen: PinnedPage | null = null;
  constructor() { super(false); }
  override title() { return this.screen?.heading() ?? "pinned"; }
  /** The desk's current note changed: the pinned page stays. */
  override select() {}
  override host(desk: DeskApi): SurfaceHost {
    return { ...super.host(desk), navigate: (m: Msg, how?: OpenHow) => desk.setCurrent(m, { reveal: true, from: this, ...how }) };
  }
  override render(w: number, h: number, focused = false, desk?: DeskApi): PaneView {
    const empty = this.screen?.emptyLines();
    return empty ? { lines: empty.map(l => pad(l, w)) } : super.render(w, h, focused, desk);
  }
}

export class PinnedPage extends Desk {
  readonly reader: PinnedReader;
  /** The page's note once resolved; null while asking, or when there is no such page. */
  page: Msg | null = null;
  asked = false;
  private problem = "";
  private reload: Timer | null = null;

  /** `address`: the page's name, as in `[[claude-now]]`. `label`: what the screen is called. */
  constructor(readonly address: string, readonly label: string) {
    const reader = new PinnedReader();
    super({ title: label, panes: [reader] });
    this.reader = reader;
    reader.screen = this;
  }

  override enter(ctx: Ctx) {
    super.enter(ctx);
    void this.load();
  }

  async load() {
    try {
      const r = await this.ctx.board.resolvePage(this.address);
      this.page = r.status === "resolved" && r.block ? r.block : null;
      this.problem = "";
      if (this.page && this.reader.msg?.id !== this.page.id) this.reader.show(this.page, this);
    } catch (e) {
      this.problem = `couldn't ask the outline for [[${this.address}]]: ${e instanceof Error ? e.message : String(e)}`;
    }
    this.asked = true;
    this.redraw();
  }

  heading(): string {
    if (!this.asked) return `${this.label} · asking the outline…`;
    if (!this.page) return `${this.label} · no page yet`;
    return `${this.label} · pinned [[${this.address}]]`;
  }

  emptyLines(): string[] | null {
    if (this.problem) return [fg(C.lred) + this.problem + RESET];
    if (!this.asked) return [fg(C.dark) + "asking the outline…" + RESET];
    if (this.page) return null;
    return [
      fg(C.white) + `No [[${this.address}]] page on this outline yet.` + RESET, "",
      fg(C.grey) + `It shows here once a note has [page::${this.address}]; this screen waits for it.` + RESET,
    ];
  }

  /** A note opened from the pinned page goes to a reader beside it (the one there, or a new one). */
  override setCurrent(m: Msg | null, opts: { reveal?: boolean; from?: Pane } & OpenHow = {}) {
    if (m && !opts.fresh && (opts.from === this.reader || !opts.from)) this.readerBeside(this.reader, opts.agent ? { kind: "agent", id: AGENT_ACTOR_ID } : USER);
    super.setCurrent(m, opts);
  }

  override onEvent(e: OutlineEvent) {
    super.onEvent(e);
    // The desk refreshes the page when it changes; until it exists (or if it's renamed away), ask again.
    if (this.page && !(e.blockId === this.page.id && e.change?.kind !== "annotate") && e.action !== "reset") return;
    if (this.reload) clearTimeout(this.reload);
    this.reload = setTimeout(() => { this.reload = null; void this.load(); }, 400);
  }

  override describe() {
    return { ...super.describe(), kind: "pinned", address: this.address, page: this.page ? { id: this.page.id } : null, problem: this.problem || undefined };
  }
}

/** Claude · now: the agents' running status page on a float-hub outline. */
export const claudeNow = () => new PinnedPage("claude-now", "Claude · now");
