import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { basename } from "node:path";
import { freeOutlineName } from "@ep0ch/outline-core/outline-location";
import { isOutlineName, slugifyOutlineName } from "./paths";
import type { HostedOutlineSummary } from "./types";
import { sanitizeDynamicText, type TerminalKey } from "./terminal";
import { parseTreePrimaryClick, parseTreeWheelEvent } from "./tree-mouse";

/**
 * The Choose outline popup (PIE-530): a folder that names no outline (no EP0CH_WS, no `.ep0ch`) picks one of the
 * host's outlines, starts a new one (its name offered from the folder's), or imports an older database. Each
 * writes `.ep0ch` into the guessed folder, so the folder names its outline from then on; a folder too broad to name
 * one after (`~`, `/tmp`) opens the choice this time only.
 */

/** What the launcher tells the chooser popup about the open it interrupted. */
export interface OutlineChooserContext {
  mode: string;
  workspaceRoot: string;
  rootSource: string;
  /** The name init offers, and the folder its `.ep0ch` goes in; absent for a folder too broad to name one after. */
  guess?: { name: string; folder: string };
  paneId?: string;
  clientId?: string;
  /** The switcher: the folder may already name an outline, and a choice replaces its `.ep0ch`. */
  switch?: boolean;
  /** The switcher in a folder that names one: the folder whose `.ep0ch` the choice replaces. */
  dotFolder?: string;
}

export function parseOutlineChooserContext(value: string | undefined): OutlineChooserContext {
  if (!value) throw new Error("OUTLINER_CHOOSER_CONTEXT is required");
  const parsed = JSON.parse(value) as Partial<OutlineChooserContext>;
  if (typeof parsed.mode !== "string" || typeof parsed.workspaceRoot !== "string" || typeof parsed.rootSource !== "string") {
    throw new Error("OUTLINER_CHOOSER_CONTEXT must name mode, workspaceRoot and rootSource");
  }
  const guess = parsed.guess && typeof parsed.guess.name === "string" && typeof parsed.guess.folder === "string" ? parsed.guess : undefined;
  return {
    mode: parsed.mode,
    workspaceRoot: parsed.workspaceRoot,
    rootSource: parsed.rootSource,
    ...(guess ? { guess: { name: guess.name, folder: guess.folder } } : {}),
    ...(typeof parsed.paneId === "string" ? { paneId: parsed.paneId } : {}),
    ...(typeof parsed.clientId === "string" ? { clientId: parsed.clientId } : {}),
    ...(parsed.switch === true ? { switch: true } : {}),
    ...(typeof parsed.dotFolder === "string" ? { dotFolder: parsed.dotFolder } : {}),
  };
}

export type OutlineChooserRow =
  | { kind: "hosted"; outline: HostedOutlineSummary }
  | { kind: "new" }
  | { kind: "import" };

/** A line being typed: the new outline's name, or the path of the database to import. */
export interface ChooserInput { row: "new" | "import"; text: string }

export class OutlineChooser {
  rows: OutlineChooserRow[] = [{ kind: "new" }, { kind: "import" }];
  index = 0;
  loading = true;
  busy = false;
  status = "";
  input: ChooserInput | undefined;
  /** The names the host has. */
  names = new Set<string>();

  constructor(readonly context: OutlineChooserContext) {}

  get selected(): OutlineChooserRow | undefined { return this.rows[this.index]; }

  setHostedOutlines(outlines: readonly HostedOutlineSummary[]): void {
    this.names = new Set(outlines.map(outline => outline.name));
    this.rows = [...outlines.map(outline => ({ kind: "hosted", outline }) as const), { kind: "new" }, { kind: "import" }];
    this.index = Math.min(this.index, this.rows.length - 1);
    this.loading = false;
  }

  move(delta: number): void {
    if (this.input) return;
    this.index = Math.max(0, Math.min(this.rows.length - 1, this.index + delta));
    this.status = "";
  }

  select(index: number): void {
    if (index < 0 || index >= this.rows.length || this.input) return;
    this.index = index;
    this.status = "";
  }
}

export type ChooserIntent = "choose" | "close" | "changed" | null;

export function chooserKey(chooser: OutlineChooser, key: TerminalKey): ChooserIntent {
  // Once a choice is being saved, closing would record it without opening anything.
  if (chooser.busy) return null;
  if (chooser.input) {
    if (key.name === "escape") { chooser.input = undefined; chooser.status = ""; return "changed"; }
    if (key.ctrl && key.name === "c") return "close";
    if (key.name === "return") return "choose";
    if (key.name === "backspace") { chooser.input.text = [...chooser.input.text].slice(0, -1).join(""); return "changed"; }
    if (!key.ctrl && !key.meta && key.sequence && /^[^\x00-\x1f\x7f]+$/.test(key.sequence)) { chooser.input.text += key.sequence; return "changed"; }
    return null;
  }
  if (key.name === "escape" || (key.ctrl && key.name === "c")) return "close";
  if (key.name === "return") return "choose";
  if (key.name === "up" || key.name === "k") { chooser.move(-1); return "changed"; }
  if (key.name === "down" || key.name === "j") { chooser.move(1); return "changed"; }
  return null;
}

// Frame rows: blank, top border, two context lines, a heading, the list, status, help, bottom border.
const LIST_TOP = 5;
function chooserLayout(width: number, height: number, index: number) {
  const inner = Math.max(1, width - 4);
  const listHeight = Math.max(2, height - LIST_TOP - 3);
  const slots = Math.max(1, Math.floor(listHeight / 2));
  const start = Math.max(0, index - slots + 1);
  return { inner, listHeight, slots, start };
}

/** Wheel moves the selection; a click on a row chooses it, as Enter does on the selected row. */
export function chooserMouse(chooser: OutlineChooser, sequence: string, width: number, height: number): ChooserIntent {
  if (chooser.busy || width < 20 || height < 10) return null;
  const layout = chooserLayout(width, height, chooser.index);
  const wheel = parseTreeWheelEvent(sequence);
  if (wheel) { chooser.move(wheel.direction === "up" ? -1 : 1); return "changed"; }
  const click = parseTreePrimaryClick(sequence);
  if (!click || click.row < LIST_TOP || click.row >= LIST_TOP + layout.slots * 2 || click.column < 2 || click.column >= layout.inner + 2) return null;
  const index = layout.start + Math.floor((click.row - LIST_TOP) / 2);
  if (!chooser.rows[index]) return null;
  // A click on the row being typed in submits it; a click elsewhere leaves the typing first.
  if (chooser.input) {
    if (chooser.rows[index]?.kind === chooser.input.row) return "choose";
    chooser.input = undefined;
    chooser.select(index);
    return "changed";
  }
  chooser.select(index);
  return "choose";
}


/** The name a new outline is offered: the folder's guess, free on this host. */
export function newOutlineName(context: OutlineChooserContext, taken: ReadonlySet<string>): string {
  return freeOutlineName(context.guess?.name ?? "outline", taken);
}

function describeHosted(outline: HostedOutlineSummary): { title: string; detail: string } {
  return {
    title: `${sanitizeDynamicText(outline.name)}  ${outline.open ? "\x1b[32mopen\x1b[0m" : "\x1b[2mclosed\x1b[0m"}`,
    detail: sanitizeDynamicText(outline.database),
  };
}

export function renderChooserFrame(chooser: OutlineChooser, width: number, height: number): string[] {
  if (width < 20 || height < 10) {
    return Array.from({ length: Math.max(1, height) }, (_, i) => i === 0 ? truncateToWidth("Choose outline · enlarge terminal", Math.max(1, width)) : "");
  }
  const { inner, listHeight, slots, start } = chooserLayout(width, height, chooser.index);
  const fit = (line: string) => {
    const text = truncateToWidth(line, inner);
    return text + " ".repeat(Math.max(0, inner - visibleWidth(text)));
  };
  const bordered = (line: string) => ` │${fit(line)}│ `;
  const root = sanitizeDynamicText(chooser.context.workspaceRoot);
  const dotFolder = chooser.context.dotFolder ?? chooser.context.guess?.folder;
  const where = dotFolder ? `writes ${sanitizeDynamicText(dotFolder)}/.ep0ch` : "this time only (the folder is too broad to name)";
  const list: string[] = [];
  for (const [offset, row] of chooser.rows.slice(start, start + slots).entries()) {
    const active = start + offset === chooser.index;
    const typing = chooser.input && chooser.input.row === row.kind ? chooser.input : undefined;
    let text: { title: string; detail: string };
    if (row.kind === "new") {
      text = typing
        ? { title: `+ New outline: ${sanitizeDynamicText(typing.text)}▏`, detail: `Enter creates it and ${where} · Esc back` }
        : { title: "+ New outline", detail: `Named "${newOutlineName(chooser.context, chooser.names)}" (you can change it); ${where}` };
    } else if (row.kind === "import") {
      text = typing
        ? { title: `↓ Import from: ${sanitizeDynamicText(typing.text)}▏`, detail: `An older .sqlite's full path; Enter makes a new outline from it and ${where}` }
        : { title: "↓ Import a database", detail: "A new outline holding an older file's notes, properties, pages and work ids; the file is only read" };
    } else {
      const hosted = describeHosted(row.outline);
      text = { title: hosted.title, detail: `${hosted.detail} · picking it ${where}` };
    }
    const title = fit(`${active ? "›" : " "} ${text.title}`);
    list.push(active ? `\x1b[48;5;238m\x1b[1m${title}\x1b[0m` : title);
    list.push(`  \x1b[2m${text.detail}\x1b[0m`);
  }
  const count = chooser.rows.length - 2;
  const heading = chooser.loading
    ? "Looking for outlines…"
    : count ? `Pick one of ${count} outline${count === 1 ? "" : "s"}, start a new one, or import one:` : "No outlines yet. Start a new one, or import one:";
  const output = ["", ` ┌${"─".repeat(inner)}┐ `,
    bordered(chooser.context.switch ? `\x1b[1;36mChoose the outline for\x1b[0m ${root}` : `\x1b[1;36mNo outline is named for\x1b[0m ${root}`),
    bordered(`\x1b[2mResolved from ${sanitizeDynamicText(chooser.context.rootSource)}. Nothing has been created.\x1b[0m`),
    bordered(heading)];
  for (let row = 0; row < listHeight; row++) output.push(bordered(list[row] ?? ""));
  output.push(bordered(chooser.status ? `\x1b[33m${sanitizeDynamicText(chooser.status)}\x1b[0m` : ""));
  output.push(bordered(chooser.input
    ? "\x1b[2mtype · Backspace erase · Enter or click do it · Esc back\x1b[0m"
    : "\x1b[2m↑/↓ j/k move · Enter or click choose · wheel scroll · Esc close\x1b[0m"),
    ` └${"─".repeat(inner)}┘ `);
  return output.slice(0, height);
}

/**
 * What choosing a row does: open an outline (`pick`), create it first (`create`), make it from a database
 * (`import`), start typing a name or a path (`input`), or refuse. `dotFolder` is where `.ep0ch` is written, when
 * the folder may be named.
 */
export type ChooserPlan =
  | { kind: "pick"; name: string; dotFolder?: string }
  | { kind: "create"; name: string; dotFolder?: string }
  | { kind: "import"; path: string; name: string; dotFolder?: string }
  | { kind: "input"; input: ChooserInput }
  | { kind: "refuse"; message: string };

export function planChoice(chooser: OutlineChooser, row: OutlineChooserRow): ChooserPlan {
  const folder = chooser.context.dotFolder ?? chooser.context.guess?.folder;
  const dot = folder ? { dotFolder: folder } : {};
  if (row.kind === "hosted") return { kind: "pick", name: row.outline.name, ...dot };
  const input = chooser.input?.row === row.kind ? chooser.input : undefined;
  if (!input) return { kind: "input", input: { row: row.kind, text: row.kind === "new" ? newOutlineName(chooser.context, chooser.names) : "" } };
  const text = input.text.trim();
  if (row.kind === "new") {
    if (!isOutlineName(text)) return { kind: "refuse", message: `"${text}" isn't an outline name: lowercase letters, digits and hyphens, up to 32` };
    if (chooser.names.has(text)) return { kind: "refuse", message: `There is already an outline named "${text}"; pick it from the list instead` };
    return { kind: "create", name: text, ...dot };
  }
  if (!text.startsWith("/")) return { kind: "refuse", message: "Type the database's full path (it starts with /)" };
  const base = chooser.context.guess?.name ?? slugifyOutlineName(basename(text).replace(/\.sqlite$/, ""));
  return { kind: "import", path: text, name: freeOutlineName(base, chooser.names), ...dot };
}
