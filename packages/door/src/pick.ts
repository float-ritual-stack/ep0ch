// Insert from a picker: the draft hands the person's terminal to a picker program (television by default: `tv <channel>`)
// the way ctrl+e hands it to $EDITOR and `!` to the shell (Ctx.suspend), and what the picker prints, one choice per line,
// goes in at the draft's cursor, space-separated. The door knows nothing of any picker's channels: the program and the
// channel are names the person configures.
//
//   EP0CH_PICKER        the picker's command line (default `tv`); run by sh, so it may hold flags (`fzf -m`)
//   EP0CH_PICK_CHANNEL  the argument it's given when the action names none (default `ep0ch`, the outline channel of
//                       ext/television); empty for none
//
// The picker's stdout goes to a file in the door's state (pick/, private), so the picker draws on the terminal
// (television draws on stderr when its stdout isn't one) and the door reads its answer after. Its environment is the
// drop shell's (EP0CH_CONTROL names this door) plus the door's outline (EP0CH_SOCKET, EP0CH_WS), so a channel that asks
// `ep0ch find` reads the outline this draft is in.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keepCopy, type Draft } from "./edit";
import { controlPath } from "./control";
import { shellCwd, shellEnv } from "./drop";
import { USER, type Actor } from "./socket";
import { stateSub } from "./state";
import { ownTerminal, type Handover } from "./term";
import type { Suspender } from "./surface/editor";

type Env = Record<string, string | undefined>;

/** The picker's command line: EP0CH_PICKER, else television's `tv`. */
export const pickerOf = (env: Env = process.env) => env.EP0CH_PICKER?.trim() || "tv";
/** The argument given when the action names none: EP0CH_PICK_CHANNEL (empty: none), else `ep0ch`. */
export const channelOf = (env: Env = process.env) => (env.EP0CH_PICK_CHANNEL !== undefined ? env.EP0CH_PICK_CHANNEL.trim() : "ep0ch");

/** Where the picker runs: its command (sh, its stdout to `out`), folder and environment. */
export function pickerRun(channel: string, out: string, outline: { socket: string; name?: string }, env: Env = process.env, control = controlPath): { argv: string[]; cwd: string; env: Record<string, string> } {
  const e = shellEnv(env, control);
  // The draft's outline, named outright: a channel's `ep0ch` reads it whatever folder or machine the door started from.
  e.EP0CH_SOCKET = outline.socket;
  if (outline.name) e.EP0CH_WS = outline.name; else delete e.EP0CH_WS;
  delete e.EP0CH_MACHINE;
  e.EP0CH_PICK_OUT = out;
  // sh runs the picker line (it may hold flags and shell words) with the channel as its argument, when there is one.
  return { argv: ["sh", "-c", `${pickerOf(env)} \${1:+"$1"} > "$EP0CH_PICK_OUT"`, "sh", channel], cwd: shellCwd(), env: e };
}

/** What a picker printed, as the text that goes in: one choice per line, joined by spaces; blank lines dropped. */
export const pickedText = (printed: string) => printed.split(/\r?\n/).map(l => l.trim()).filter(Boolean).join(" ");

/** The text as it goes in at the cursor: a space before it when it would run into a word. */
export function atCursor(d: Draft, text: string): string {
  const before = d.lines[d.row]?.slice(0, d.col) ?? "";
  return before && !/\s$/.test(before) ? ` ${text}` : text;
}

export type Picked = { inserted: string } | { nothing: string } | { kept: string; at: string; why: string };

/** How a draft hands the terminal to the picker (a test gives its own). */
export const pickRunner: { run: (terminal: Handover, run: ReturnType<typeof pickerRun>) => Promise<number | null> } = {
  run: (terminal, r) => terminal.run(r.argv, { cwd: r.cwd, env: r.env }),
};

/**
 * Run the picker in the person's terminal and insert what it printed at the draft's cursor, as `by` typed it. `held`:
 * whether the draft is still open when the picker returns; a choice made for a draft that closed meanwhile isn't lost:
 * it's copied to disk (`drafts/`, as ctrl+e's text is) and said (`kept`, `at`). Resolves once the picker is done.
 *
 * It takes the whole terminal even on a desk, where ctrl+e's editor opens in a tile beside the note: the picker is a
 * moment's choice whose answer the draft waits on, not a second place to work.
 */
export async function pickInto(ctx: Suspender, d: Draft, outline: { socket: string; name?: string }, o: { channel?: string; held?: () => boolean; by?: Actor } = {}): Promise<Picked> {
  const dir = mkdtempSync(join(stateSub("pick") ?? tmpdir(), `${process.pid}-`));
  const out = join(dir, "picked.txt");
  const channel = o.channel ?? channelOf();
  const picker = `${pickerOf()}${channel ? ` ${channel}` : ""}`;
  let code: number | null = null;
  try {
    await ctx.suspend(async terminal => { code = await pickRunner.run(terminal ?? ownTerminal, pickerRun(channel, out, outline)); }, "picker");
    let printed = "";
    try { printed = readFileSync(out, "utf8"); } catch { /* nothing chosen */ }
    const text = pickedText(printed);
    // tv and fzf exit 0 or 130 when nothing was chosen (esc, ctrl+c); tv exits 1 on a channel it doesn't have too (its
    // error went with its screen); 127 is sh's "not found".
    if (!text) return { nothing: code === 127 ? `${picker} exited 127: not found (EP0CH_PICKER names the picker); nothing inserted`
      : code === 1 ? `nothing chosen in ${picker}, or it has no ${channel ? `"${channel}"` : "such"} channel (tv's come from ext/television: ep0ch install --apply)`
      : code === 0 || code === 130 ? `nothing chosen in ${picker}` : `${picker} exited ${code ?? "without a code"}; nothing inserted` };
    if (o.held && !o.held()) return { kept: text, at: keepCopy(text + "\n", "picked"), why: `the draft closed while ${picker} was open` };
    const put = atCursor(d, text);
    d.pasteText(put, o.by ?? USER);
    d.note = `inserted from ${picker}`;
    return { inserted: put };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
