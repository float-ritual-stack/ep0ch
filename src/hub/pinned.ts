// A page pinned in a reader: the note a `[[page]]` address names (`claude-now`, the agents' running status for the
// day), live. The reader never follows the desk's current note; a link followed in it opens in a reader beside (its
// kind's open rule, `beside`), so the page stays where it is. A page that doesn't exist yet is waited for: the
// reader asks again when the outline changes.
//
// A screen spec on the desk (PIE-515: `pinnedSpec`): one tile of its own kind (`pinned`, `pinnedKind`), a reader that
// knows which page it's pinned to; the layout, the sessions, the mouse, `act` and `peek` are the desk's.
import type { Msg } from "../board";
import { USER, type OutlineEvent } from "../socket";
import { C, fg, pad, RESET } from "../style";
import type { OpenHow, SurfaceHost } from "../surface/note";
import { ReaderPane, type DeskApi, type PaneView } from "../desk/panes";
import type { ScreenSpec } from "../desk/screen-spec";
import { tileKind, type TileKind, type TileKindName } from "../desk/tile-kinds";
import { nowPage } from "./now";
export { nowPage };

/** A reader pinned to the page `address` names, called `label` (`Claude · now`). */
export class PinnedReader extends ReaderPane {
  override readonly kind: TileKindName = "pinned";
  /** The page's note once resolved; null while asking, or when there is no such page. */
  page: Msg | null = null;
  asked = false;
  problem = "";
  private reload: Timer | null = null;
  constructor(readonly address: string, readonly label: string) { super(false); }
  override title() { return this.heading(); }
  /** The desk's current note changed: the pinned page stays. */
  override select() {}
  override host(desk: DeskApi): SurfaceHost {
    return { ...super.host(desk), navigate: (m: Msg, how?: OpenHow) => desk.setCurrent(m, { reveal: true, from: this, ...how }) };
  }
  override render(w: number, h: number, focused = false, desk?: DeskApi): PaneView {
    const empty = this.emptyLines();
    return empty ? { lines: empty.map(l => pad(l, w)) } : super.render(w, h, focused, desk);
  }
  spec() { return { page: this.address, label: this.label }; }

  async load(desk: DeskApi) {
    try {
      const r = await desk.ctx.board.resolvePage(this.address);
      this.page = r.status === "resolved" && r.block ? r.block : null;
      this.problem = "";
      if (this.page && this.msg?.id !== this.page.id) this.show(this.page, desk);
    } catch (e) {
      this.problem = `couldn't ask the outline for [[${this.address}]]: ${e instanceof Error ? e.message : String(e)}`;
    }
    this.asked = true;
    desk.redraw();
  }

  override onEvent(desk: DeskApi, e?: OutlineEvent) {
    super.onEvent(desk);
    // The desk refreshes the page when it changes; until it exists (or if it's renamed away), ask again.
    if (!e || (this.page && !(e.blockId === this.page.id && e.change?.kind !== "annotate") && e.action !== "reset")) return;
    if (this.reload) clearTimeout(this.reload);
    this.reload = setTimeout(() => { this.reload = null; void this.load(desk); }, 400);
  }
  override dispose() { if (this.reload) clearTimeout(this.reload); super.dispose?.(); }

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
}

/** A pinned page as a tile kind: a reader (no `^W o` key) whose opens go beside it. */
export function pinnedKind(): TileKind {
  const reader = tileKind("reader")!;
  return {
    ...reader, kind: "pinned", about: "a reader pinned to a [[page]] (page=<name>, label=<words>), waiting for it to exist", noun: "a pinned page", keys: undefined,
    make: s => { const now = nowPage(); return new PinnedReader(s.page ?? now.address, s.label ?? now.label); },
    save: p => (p as PinnedReader).spec(),
    // A note opened from it goes to a reader beside; the page stays where it is.
    policy: { opens: "beside" },
    start: (p, env) => void (p as PinnedReader).load(env.desk),
    // An agent's open (ScreenSpec.lands) opens beside it too.
    take: (p, m, desk, by) => { desk.setCurrent(m, { reveal: true, from: p, by: by ?? USER }); return null; },
    peek: p => { const r = p as PinnedReader; return { address: r.address, page: r.page ? { id: r.page.id } : null, problem: r.problem || undefined }; },
  };
}

/** A page pinned on a screen of its own: `address` its name (as in `[[claude-now]]`), `label` what the screen is called. */
export function pinnedSpec(args: { address?: unknown; label?: unknown } = {}): ScreenSpec {
  const now = nowPage();
  const address = typeof args.address === "string" && args.address ? args.address : now.address;
  const label = typeof args.label === "string" && args.label ? args.label : now.label;
  return { name: "pinned", title: label, lands: "pinned", layout: { focus: "pinned", root: { t: "leaf", kind: "pinned", name: "pinned", page: address, label } } };
}
