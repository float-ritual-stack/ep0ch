// The agent panel (PIE-737): every agent session the door holds (src/desk/agent-sessions.ts), with its program, folder,
// persona, what it's doing and where it's shown, as Herdr's sidebar lists its agents. A tile kind (`agents`), so it's a
// tile like any other; `agents.open` (alt+g, on every screen) opens it as a tab in your drawer, where it travels with you.
//
// Its rows are sessions; what a row does is the door's own actions on that session (the App's, so `act` reaches them
// with no panel open): ⏎ or a click jumps to it (`agents.go`), a pulls it into your drawer (`agents.drawer`), d docks it
// on the screen shown (`agents.dock`), n starts a new one (`agents.new`: pick the program, then the folder). j k pick
// (`agents.pick`, the kind's own). Moving one moves the same process: the conversation is kept.
import { C, fg, pad, RESET, selected } from "../style";
import { ch, isDown, isUp, type Key } from "../term";
import { ActionRefused, actionSet, def } from "../surface/actions";
import { RowView } from "../scroll";
import type { DeskApi, Pane, PaneView } from "./panes";
import type { KindHost, TileKind } from "./tile-kinds";
import { sessionFacts, shownWords, tildeOf, type AgentSession } from "./agent-sessions";
import { onStatusChange, statusMark } from "./program-status";

export const AGENTS_KIND_NAME = "agents";

/** The panel's row keys, in the order its hint says them. */
export const AGENTS_HINT = "j k pick · ⏎ or click jumps · a into your drawer · d dock here · n new";

export class AgentsPane implements Pane {
  readonly kind = AGENTS_KIND_NAME;
  /** The row picked (0 is the first). */
  at = 0;
  private view = new RowView();
  private desk: DeskApi | null = null;
  private off: (() => void) | null = null;
  private tick: Timer | null = null;

  rows(): AgentSession[] { return this.desk?.ctx.hostLayer?.sessions?.() ?? []; }
  title() { const n = this.rows().length; return n ? `agents · ${n}` : "agents · none"; }
  hint() { return AGENTS_HINT; }
  init(desk: DeskApi) {
    this.desk = desk;
    this.off?.();
    this.off = onStatusChange(() => desk.redraw(), desk.ctx.hostLayer ?? desk.ctx);
    // What each session is doing changes without a report (its output, a program started in a shell): drawn again calmly.
    if (!this.tick) { this.tick = setInterval(() => desk.redraw(), 2000); this.tick.unref?.(); }
  }
  dispose() { this.off?.(); this.off = null; if (this.tick) clearInterval(this.tick); this.tick = null; }

  /** The session picked now, or null. */
  picked(): AgentSession | null { const r = this.rows(); return r[Math.min(Math.max(0, this.at), r.length - 1)] ?? null; }

  render(w: number, h: number, focused: boolean): PaneView {
    const rows = this.rows();
    if (!rows.length) {
      return { lines: [fg(C.white) + "No agent sessions." + RESET, "", ...["n starts one here (the program, then the folder).", "`ep0ch agent` in any folder starts or attaches that folder's.", "A claude, codex or pi run in a terminal tile (^W o s) shows here by itself."].map(l => fg(C.grey) + pad(l, w) + RESET)] };
    }
    this.at = Math.min(Math.max(0, this.at), rows.length - 1);
    this.view.place(this.at, rows.length, h);
    const glyph = (s: AgentSession) => {
      const r = s.pane.status.urgent();
      return r ? statusMark(r) : s.state === "working" ? statusMark({ state: "working" }) : { glyph: "·", sgr: fg(C.dark) };
    };
    return {
      lines: rows.slice(this.view.top, this.view.top + h).map((s, i) => {
        const n = this.view.top + i, g = glyph(s);
        // What it is and what it's doing first, its folder last: a narrow panel cuts the folder, never the state.
        const who = s.persona ? ` · ${s.persona}` : "";
        const text = ` ${g.glyph} ${s.program}${who} · ${s.word} · ${shownWords(s.shown)} · ${tildeOf(s.folder)}`;
        if (n === this.at) return selected(focused) + pad(text, w) + RESET;
        return pad(` ${g.sgr}${g.glyph} ${fg(C.lcyan)}${s.program}${s.persona ? `${fg(C.dark)} · ${fg(C.lmagenta)}${s.persona}` : ""}${fg(C.dark)} · ${g.sgr}${s.word}${fg(C.dark)} · ${fg(C.grey)}${shownWords(s.shown)}${fg(C.dark)} · ${fg(C.white)}${tildeOf(s.folder)}`, w) + RESET;
      }),
    };
  }

  /** Run the door's action on the picked session, as the person (a refusal said on screen). */
  private onRow(action: string, extra: Record<string, unknown> = {}) {
    const s = this.picked();
    if (!s && action !== "agents.new") return;
    void this.desk?.ctx.press?.(action, { ...(s && action !== "agents.new" ? { session: s.id } : {}), ...extra });
  }
  private pick(desk: DeskApi, n: number) { void desk.press?.(this, AGENTS_ACTIONS, "agents.pick", { n }); }

  key(k: Key, desk: DeskApi): boolean {
    const n = this.rows().length;
    if (isUp(k)) { if (this.at > 0) this.pick(desk, this.at); return true; }
    if (isDown(k)) { if (this.at + 1 < n) this.pick(desk, this.at + 2); return true; }
    if (k.kind === "enter" && n) { this.onRow("agents.go"); return true; }
    if (ch(k) === "a" && n) { this.onRow("agents.drawer"); return true; }
    if (ch(k) === "d" && n) { this.onRow("agents.dock"); return true; }
    if (ch(k) === "n") { this.onRow("agents.new"); return true; }
    return false;
  }

  click(_x: number, y: number, desk: DeskApi) {
    const n = this.view.top + y;
    if (n >= this.rows().length) return;
    if (n !== this.at) this.pick(desk, n + 1);
    this.at = n;
    this.onRow("agents.go");
  }

  wheel(dir: 1 | -1, desk: DeskApi) {
    const to = this.at + dir;
    if (to >= 0 && to < this.rows().length) this.pick(desk, to + 1);
  }

  describe() { return this.rows().map((s, i) => sessionFacts(s, i + 1)); }
}

/** The panel's own action: which row is picked. What a row does is the door's (agents.go, agents.drawer, agents.dock, agents.new). */
export const AGENTS_ACTIONS = actionSet<KindHost>()("agents", {
  "agents.pick": def({
    summary: "pick a row of the agent panel (n from 1; agents.list names them)",
    keys: "j k ↑ ↓, the wheel, a click",
    touches: "tile", while: "typing", replay: "safe", way: "an agent doesn't move the person's row (agents.list reads the rows)",
    args: { n: { type: "number", about: "its place in the list, from 1" } },
    run({ n }, { pane, desk }) {
      const p = pane as AgentsPane, rows = p.rows();
      if (!rows.length) throw new ActionRefused("no agent sessions run · n starts one, or `ep0ch agent` from a folder");
      if (!(n >= 1 && n <= rows.length)) throw new ActionRefused(`pick 1 to ${rows.length}`);
      p.at = n - 1;
      desk.redraw();
      return { n, session: rows[n - 1]!.id };
    },
  }),
});

/** The panel as a tile kind: its rows, its action, and what `peek` says. */
export const AGENTS_KIND: TileKind = {
  kind: AGENTS_KIND_NAME, about: "every agent session the door holds: program, folder, persona, what it's doing and where it's shown (PIE-737)", noun: "the agent panel",
  make: () => new AgentsPane(), actions: AGENTS_ACTIONS,
  peek: p => ({ agents: (p as AgentsPane).describe() }),
  describe: p => ({ rows: (p as AgentsPane).describe() }),
};
