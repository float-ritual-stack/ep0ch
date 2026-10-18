// Who can reach what (PIE-1034): a tile kind (`access-matrix`) that shows which MCP caller can reach which outline and
// how far, with each caller's recent use beside it, and lets the person change a cell in place.
//
// It owns no data. The matrix is src/mcp-access-matrix.ts's: the outline hosts' grants (`ep0ch mcp access`), the named
// paths' caps (`EP0CH_MCP_PATH_ACCESS`, mcp.env) and the usage records (`ep0ch mcp usage`), combined by the one rule the
// gateway uses (`levelFor`). A cell is a glyph and a word, never a colour alone.
//
// Open it from the power bar (`>` actions: `access.open`, or `%` once it is open), or `ep0ch mcp access --matrix` prints
// the same. Rows are callers (two lines each: the level, then calls in the last 7 days and the last call), columns are the
// outlines; h j k l or the arrows pick a cell, a click picks it too. n r p f (or a click on the chips under the table)
// plan a level: the plan says which command runs and whom it affects, ⏎ (or its chip) applies it, esc leaves it. Applying
// is the person's (ADR 0005): an agent reads the matrix (`mcp.access.matrix`, `peek`) and can ask what a change would
// do (`access.plan`), never make it.
import { C, dim, fg, pad, RESET, selected } from "../style";
import { ch, type Key } from "../term";
import { ago } from "../text";
import { ActionRefused, actionSet, def } from "../surface/actions";
import type { DeskApi, Pane, PaneView } from "./panes";
import type { KindHost, TileKind } from "./tile-kinds";
import { RowView } from "../scroll";
import { applyPlan, gatherMatrix, hostSource, levelText, matrixLines, planChange, type AccessMatrix, type GrantSource, type MatrixCell, type Plan } from "../mcp-access-matrix";
import { canonicalLocalMachineName } from "../notes-cli";
import type { McpAccessLevel } from "@ep0ch/outline-core/protocol";

export const ACCESS_MATRIX_KIND_NAME = "access-matrix";

/** The columns a cell takes (`♦ propose` and a gap). */
const CELL = 10;
/** The lines under the table: why, use, the levels to pick, what a change would do. */
const FOOT = 4;
const KEYS: Record<string, McpAccessLevel> = { n: "none", r: "read", p: "propose", f: "full" };
const LEVEL_SGR: Record<McpAccessLevel, string> = { none: fg(C.dark), read: fg(C.lcyan), propose: fg(C.yellow), full: fg(C.white) };

/** The host the door's outline lives on, as a source (its socket, its machine). */
export const sourceOf = (ctx: { board: { path: string }; machine?: string | undefined }): GrantSource =>
  hostSource(ctx.board.path, ctx.machine ?? canonicalLocalMachineName());

/** A cell as `peek` and the actions give it. */
export function cellFacts(c: MatrixCell): Record<string, unknown> {
  return { caller: c.caller, outline: c.outline, machine: c.machine, level: c.level, grant: c.grant, cap: c.cap, limitedBy: c.limitedBy, why: c.why, usage: c.usage };
}
const factsOf = (m: AccessMatrix) => ({
  callers: m.callers, outlines: m.outlines, cells: m.cells.flat().map(cellFacts), caps: m.caps, usage: m.usage,
});

const usageWords = (c: MatrixCell) => !c.usage ? "no usage records for this machine's outlines here"
  : c.usage.calls ? `${c.usage.calls} call${c.usage.calls === 1 ? "" : "s"} in ${7} days, the last ${ago(Date.parse(c.usage.lastCall!))} ago`
  : c.level === "none" ? "no calls in 7 days" : "unused in 7 days";

export class AccessMatrixPane implements Pane {
  readonly kind = ACCESS_MATRIX_KIND_NAME;
  /** `env`: where the caps are read and written (the process's; the showcase gives its own folder). */
  constructor(readonly env: Record<string, string | undefined> = process.env) {}
  matrix: AccessMatrix | null = null;
  /** The cell picked: caller row, outline column. */
  row = 0; col = 0;
  /** A change planned and waiting for ⏎: nothing is written until the person applies it. */
  staged: Plan | null = null;
  /** What the last change ran, or why the matrix could not be read. */
  said = "";
  private reading = false;
  private view = new RowView();
  private colTop = 0;
  private width = 0;
  private desk: DeskApi | null = null;
  /** Where the clickable chips are, as drawn: tile row, columns, action. */
  private hits: { y: number; x0: number; x1: number; action: string; args: Record<string, unknown> }[] = [];
  private bodyTop = 2;
  private bodyEnd = 2;

  title() { return this.matrix ? `who can reach what · ${this.matrix.callers.length} caller${this.matrix.callers.length === 1 ? "" : "s"}` : "who can reach what"; }
  hint() { return "h j k l pick · n r p f plan a level · ⏎ apply · esc cancel · R read again"; }
  init(desk: DeskApi) { this.desk = desk; void this.load(); }
  focused() { void this.load(); }

  /** Read the three sources again. */
  async load(): Promise<void> {
    const desk = this.desk;
    if (!desk || this.reading) return;
    this.reading = true;
    try {
      this.matrix = await gatherMatrix([sourceOf(desk.ctx)], this.env);
      this.said = "";
    } catch (e) { this.said = `could not read who can reach what: ${(e as Error).message}`; }
    finally { this.reading = false; desk.redraw(); }
  }

  cell(): MatrixCell | null { return this.matrix?.cells[this.row]?.[this.col] ?? null; }
  /** Pick a cell; false when it isn't in the matrix. */
  pick(row: number, col: number): boolean {
    const m = this.matrix;
    if (!m || row < 0 || col < 0 || row >= m.callers.length || col >= m.outlines.length) return false;
    this.row = row; this.col = col; this.staged = null; this.view.reveal();
    return true;
  }

  render(w: number, h: number, focused: boolean): PaneView {
    this.width = w; this.hits = [];
    const m = this.matrix;
    if (!m) return { lines: [fg(C.grey) + (this.said || "reading who can reach what…") + RESET] };
    const lines: string[] = [dim(pad(` calls: last ${m.usage.days} days · the lower of the outline's grant and the caller's cap`, w))];
    if (!m.callers.length) {
      return { lines: [...lines, "", fg(C.white) + " No caller has been seen yet." + RESET, fg(C.grey) + pad(" A caller shows here once it has a row in the usage records (ep0ch mcp usage --by actor) or a name in EP0CH_MCP_PATH_ACCESS (~/.config/ep0ch/mcp.env).", w) + RESET] };
    }
    this.row = Math.min(this.row, m.callers.length - 1);
    const name = Math.min(20, Math.max(8, ...m.callers.map(c => c.name.length + 7)));
    const fit = Math.max(1, Math.floor((w - name) / CELL));
    // The columns slide so the picked one is always in view.
    this.colTop = Math.min(Math.max(0, this.colTop), Math.max(0, m.outlines.length - fit));
    if (this.col < this.colTop) this.colTop = this.col;
    if (this.col >= this.colTop + fit) this.colTop = this.col - fit + 1;
    const cols = m.outlines.slice(this.colTop, this.colTop + fit);
    const outlineName = (i: number) => { const o = m.outlines[i]!; return m.outlines.some((x, j) => j !== i && x.outline === o.outline) ? `${o.outline}@${o.machine}` : o.outline; };
    lines.push(dim(pad(" ".repeat(name) + cols.map((_, k) => pad(outlineName(this.colTop + k), CELL - 1) + " ").join("") + (this.colTop + fit < m.outlines.length ? "›" : ""), w)));
    const body = Math.max(2, h - lines.length - FOOT);
    const callerLines = m.callers.flatMap((c, r) => {
      const cells = m.cells[r]!;
      const head = pad(` ${c.name}${c.via === "path" ? " »" : ""}`, name);
      const first = head + cells.slice(this.colTop, this.colTop + fit).map((x, k) => this.cellText(x, r === this.row && this.colTop + k === this.col, focused, true)).join("");
      const second = pad(`  ${c.lastCall ? `last ${ago(Date.parse(c.lastCall))}` : "no calls"}`, name) + cells.slice(this.colTop, this.colTop + fit).map((x, k) => this.cellText(x, r === this.row && this.colTop + k === this.col, focused, false)).join("");
      return [pad(first, w), dim(pad(second, w)).replaceAll(RESET + RESET, RESET)];
    });
    const top = this.view.place(this.row * 2, callerLines.length, body, [this.row * 2, this.row * 2 + 1]);
    lines.push(...callerLines.slice(top, top + body));
    this.bodyTop = 2; this.bodyEnd = 2 + body;
    while (lines.length < 2 + body) lines.push("");
    const cell = this.cell();
    lines.push(fg(C.grey) + pad(` ${cell?.why ?? ""}`, w) + RESET);
    lines.push(dim(pad(cell ? ` ${cell.caller} in ${cell.outline}: ${usageWords(cell)}` : "", w)));
    const y = lines.length;
    if (this.staged) {
      const s = this.staged;
      if (!s.steps.length) lines.push(fg(C.grey) + pad(` ${s.said}`, w) + RESET);
      else {
        const chips = [" [⏎ apply]", " [esc cancel]"];
        const run = ` will run: ${s.steps.map(x => x.command).join(" and ")}`;
        lines.push(fg(C.lcyan) + pad(run, Math.max(0, w - chips.join("").length)) + fg(C.white) + chips.join("") + RESET);
        let x = Math.max(0, w - chips.join("").length);
        for (const [i, c] of chips.entries()) { this.hits.push({ y, x0: x, x1: x + c.length, action: i === 0 ? "access.apply" : "access.cancel", args: {} }); x += c.length; }
      }
      lines.push(dim(pad(s.steps.length ? ` ${s.steps.map(x => x.affects).join("; ")}` : "", w)));
    } else {
      let x = 1, row = " set:";
      x = row.length;
      for (const [k, l] of Object.entries(KEYS)) {
        const chip = ` [${k} ${l}]`;
        this.hits.push({ y, x0: x, x1: x + chip.length, action: "access.plan", args: { level: l } });
        row += chip; x += chip.length;
      }
      lines.push(fg(C.grey) + pad(row, w) + RESET);
      lines.push(dim(pad(this.said ? ` ${this.said}` : " a change is planned first and says what it runs; ⏎ applies it", w)));
    }
    return { lines };
  }
  private cellText(c: MatrixCell, on: boolean, focused: boolean, levelLine: boolean): string {
    const text = levelLine ? levelText(c.level) : !c.usage ? "·" : c.usage.calls ? `${c.usage.calls}× ${ago(Date.parse(c.usage.lastCall!))}` : c.level === "none" ? "" : "unused";
    const shown = pad(` ${text}`, CELL);
    if (on) return selected(focused) + shown + RESET;
    return (levelLine ? LEVEL_SGR[c.level] : "") + shown + RESET;
  }

  private run(desk: DeskApi, action: string, args: Record<string, unknown> = {}) { void desk.press?.(this, ACCESS_MATRIX_ACTIONS, action, args); }

  key(k: Key, desk: DeskApi): boolean {
    const m = this.matrix, c = ch(k);
    if (c === "R") { void this.load(); return true; }
    if (!m) return false;
    const to = (dr: number, dc: number) => this.run(desk, "access.pick", { row: Math.min(m.callers.length - 1, Math.max(0, this.row + dr)) + 1, col: Math.min(m.outlines.length - 1, Math.max(0, this.col + dc)) + 1 });
    if (k.kind === "up" || c === "k") { to(-1, 0); return true; }
    if (k.kind === "down" || c === "j") { to(1, 0); return true; }
    if (k.kind === "left" || c === "h") { to(0, -1); return true; }
    if (k.kind === "right" || c === "l") { to(0, 1); return true; }
    if (KEYS[c]) { this.run(desk, "access.plan", { level: KEYS[c] }); return true; }
    if (k.kind === "enter" && this.staged) { this.run(desk, "access.apply"); return true; }
    if (k.kind === "esc" && this.staged) { this.run(desk, "access.cancel"); return true; }
    return false;
  }

  click(x: number, y: number, desk: DeskApi) {
    const hit = this.hits.find(h => h.y === y && x >= h.x0 && x < h.x1);
    if (hit) { this.run(desk, hit.action, hit.args); return; }
    const m = this.matrix;
    if (!m || y < this.bodyTop || y >= this.bodyEnd) return;
    const name = Math.min(20, Math.max(8, ...m.callers.map(c => c.name.length + 7)));
    const row = Math.floor((this.view.top + y - this.bodyTop) / 2), col = this.colTop + Math.floor((x - name) / CELL);
    if (x >= name && row < m.callers.length && col < m.outlines.length) this.run(desk, "access.pick", { row: row + 1, col: col + 1 });
  }

  wheel(dir: 1 | -1, desk: DeskApi) { this.run(desk, "access.pick", { row: Math.min((this.matrix?.callers.length ?? 1), Math.max(1, this.row + 1 + dir)), col: this.col + 1 }); }

  describe() {
    const m = this.matrix;
    return { ...(m ? factsOf(m) : { reading: true }), selected: this.cell() ? { caller: this.cell()!.caller, outline: this.cell()!.outline } : null, ...(this.staged ? { planned: this.staged } : {}), ...(this.said ? { said: this.said } : {}) };
  }
  /** The matrix as the CLI prints it, for a text peek. */
  text(): string[] { return this.matrix ? matrixLines(this.matrix) : []; }
}

/** The cell `a` names (caller and outline; machine when two outlines share a name), else the picked one; or why not. */
function cellOf(p: AccessMatrixPane, a: { caller?: string; outline?: string; machine?: string }): MatrixCell {
  const m = p.matrix;
  if (!m) throw new ActionRefused("the matrix is still being read · access.refresh reads it again");
  if (a.caller === undefined && a.outline === undefined) { const c = p.cell(); if (!c) throw new ActionRefused("no caller has been seen yet"); return c; }
  const ri = a.caller === undefined ? p.row : m.callers.findIndex(c => c.name.toLowerCase() === a.caller!.toLowerCase());
  if (ri < 0) throw new ActionRefused(`no caller ${a.caller} · callers: ${m.callers.map(c => c.name).join(", ") || "none seen"}`);
  const ci = a.outline === undefined ? p.col : m.outlines.findIndex(o => o.outline === a.outline && (!a.machine || o.machine === a.machine));
  if (ci < 0) throw new ActionRefused(`no outline ${a.outline} · outlines: ${m.outlines.map(o => `${o.outline}@${o.machine}`).join(", ")}`);
  return m.cells[ri]![ci]!;
}

const cellArgs = {
  caller: { type: "string", optional: true, about: "the caller's name (a persona or a client); left out: the picked row" },
  outline: { type: "string", optional: true, about: "the outline's name; left out: the picked column" },
  machine: { type: "string", optional: true, about: "its machine, when two outlines share a name" },
} as const;

export const ACCESS_MATRIX_ACTIONS = actionSet<KindHost>()("access-matrix", {
  "access.pick": def({
    summary: "pick a cell of the matrix (row and col from 1, or caller= and outline=)",
    keys: "h j k l, the arrows, a click on a cell",
    touches: "tile", while: "typing", replay: "safe", way: "an agent doesn't move the person's cell (peek lists every cell)",
    args: { row: { type: "number", optional: true, about: "the caller's row, from 1" }, col: { type: "number", optional: true, about: "the outline's column, from 1" }, ...cellArgs },
    run(a, { pane, desk }) {
      const p = pane as AccessMatrixPane, m = p.matrix;
      if (!m) throw new ActionRefused("the matrix is still being read");
      let row = a.row !== undefined ? a.row - 1 : p.row, col = a.col !== undefined ? a.col - 1 : p.col;
      if (a.caller !== undefined || a.outline !== undefined) {
        const c = cellOf(p, a);
        row = m.callers.findIndex(x => x.name === c.caller); col = m.outlines.findIndex(o => o.outline === c.outline && o.machine === c.machine);
      }
      if (!p.pick(row, col)) throw new ActionRefused(`pick row 1 to ${m.callers.length} and column 1 to ${m.outlines.length}`);
      desk.redraw();
      return cellFacts(p.cell()!);
    },
  }),
  "access.plan": def({
    summary: "what it would take for a caller to have a level in an outline: the commands that would run (the outline's grant, the path's cap, or both) and whom each affects. It writes nothing. The person's planning is kept on the tile for ⏎ to apply; an agent's is only returned",
    keys: "n r p f (none, read, propose, full), the chips under the table",
    touches: "tile", replay: "safe",
    args: { level: { type: "string", about: "none, read, propose or full" }, ...cellArgs },
    run(a, { pane, desk }, actor) {
      const p = pane as AccessMatrixPane, c = cellOf(p, a);
      const plan = planChange(p.matrix!, { caller: c.caller, outline: c.outline, machine: c.machine, level: a.level });
      if ("error" in plan) throw new ActionRefused(plan.error);
      if (actor.kind !== "agent") { p.pick(p.matrix!.callers.findIndex(x => x.name === c.caller), p.matrix!.outlines.findIndex(o => o.outline === c.outline && o.machine === c.machine)); p.staged = plan; desk.redraw(); }
      return { plan, applied: false };
    },
  }),
  "access.apply": def({
    summary: "make the change planned: write the outline's grant and/or the path's cap, and say the commands that ran. With caller, outline and level it plans and applies in one step; with none it applies what the tile has planned. The person's only: access is the person's to change (agents are gated by it, ADR 0005)",
    keys: "⏎ on a planned change, the [⏎ apply] chip",
    touches: "nothing", replay: "ask", says: (r: { ran: string[] }) => `ran ${r.ran.join(" and ")}`,
    person: "what agents may reach is the person's to set: an agent reads the matrix and asks access.plan what a change would do, and the person applies it",
    args: { level: { type: "string", optional: true, about: "none, read, propose or full (left out: the change the tile has planned)" }, ...cellArgs },
    async run(a, { pane, desk }, actor) {
      // `person` is checked by the dispatcher, but not while yolo lifts the agent gate: access is never lifted with it.
      if (actor.kind === "agent") throw new ActionRefused("what agents may reach is the person's to set: an agent reads the matrix and asks access.plan what a change would do");
      const p = pane as AccessMatrixPane;
      let plan = p.staged;
      if (a.level !== undefined || !plan) {
        if (a.level === undefined) throw new ActionRefused("nothing is planned · n r p f plan a level for the picked cell, or pass caller, outline and level");
        const c = cellOf(p, a), made = planChange(p.matrix!, { caller: c.caller, outline: c.outline, machine: c.machine, level: a.level });
        if ("error" in made) throw new ActionRefused(made.error);
        plan = made;
      }
      if (!plan.steps.length) { p.staged = null; desk.redraw(); return { ran: [], plan, said: plan.said }; }
      let ran: string[];
      try { ran = await applyPlan(plan, [sourceOf(desk.ctx)], p.env); }
      catch (e) { throw new ActionRefused(`${(e as Error).message}${plan.steps.length ? ` · by hand: ${plan.steps.map(s => s.command).join(" and ")}` : ""}`); }
      p.staged = null;
      await p.load();
      p.said = `ran ${ran.join(" and ")}`; desk.redraw();
      return { ran, plan, said: p.said };
    },
  }),
  "access.cancel": def({
    summary: "drop the planned change without writing anything",
    keys: "esc",
    touches: "tile", replay: "safe", way: "an agent has no planned change on the person's tile",
    args: {},
    run(_, { pane, desk }) { const p = pane as AccessMatrixPane, had = p.staged !== null; p.staged = null; desk.redraw(); return { cancelled: had }; },
  }),
  "access.refresh": def({
    summary: "read the grants, the caps and the usage records again",
    keys: "R",
    touches: "nothing", replay: "safe",
    args: {},
    async run(_, { pane }) { const p = pane as AccessMatrixPane; await p.load(); return p.describe(); },
  }),
});

/** The matrix as a tile kind: its rows, its actions, and what `peek` says. */
export const ACCESS_MATRIX_KIND: TileKind = {
  kind: ACCESS_MATRIX_KIND_NAME, about: "which MCP caller can reach which outline and how far (grants, named-path caps, recent use); the person changes a cell in place", noun: "the who-can-reach-what matrix",
  make: () => new AccessMatrixPane(), actions: ACCESS_MATRIX_ACTIONS,
  peek: p => ({ accessMatrix: (p as AccessMatrixPane).describe() }),
  describe: p => (p as AccessMatrixPane).describe(),
};
