// The gateway's live route to another machine's outline (PIE-661). An outline mirrored here lives on a machine (the
// laptop) that often answers over ssh while its backups crawl, so the gateway asks that machine's own host first,
// through the one shared forward every client keeps (outline-core's `ensureForward`, `<outlines>/.remote/<ssh-name>.sock`),
// and falls back to the mirror (src/mcp-mirror.ts) only when it doesn't answer. Nothing here is a second reader or
// writer: the board it returns is the same SocketBoard, and a write to it is `applyWrite` like any live outline's.
//
// A try has a short budget (2 s). The result is remembered per machine: a machine that answered is tried at once next
// time, one that didn't is left alone for a backoff (45 s) so a sleeping laptop never makes every call slow. A try that
// outlasts its budget keeps going in the background and, if it ends well, marks the machine up for the next call.
// A host on another PROTOCOL is as good as away, with the command that fixes it.
import { PROTOCOL } from "@ep0ch/outline-core/protocol";
import { forwardTo } from "./machine";
import type { NotesBoard } from "./notes-cli";
import { SocketBoard } from "./socket";

export const LIVE_BUDGET_MS = 2000;
export const LIVE_BACKOFF_MS = 45_000;
const REQUEST_TIMEOUT_MS = 10_000;

/** How an outline of another machine is being served now, for `list_outlines` and the fallback's words. */
export interface LiveRoute {
  via: "live" | "mirror";
  /** When the machine was last tried (ISO); null before the first try. */
  checkedAt: string | null;
  /** Why the mirror, when it is. */
  why?: string;
  /** What to run, when that fixes it. */
  command?: string;
}

type Verdict = { up: true; at: number; board: NotesBoard; host: string } | { up: false; at: number; why: string; command?: string };
/** `host`: the machine's own name for itself, as its outline host reports it (os.hostname). */
export type LiveAnswer = { board: NotesBoard; host: string } | { away: { why: string; checkedAt: string; command?: string } };

export interface LiveOptions {
  /** The machine's forward, answering (started when it isn't): outline-core's rule. */
  forward?: (machine: string) => Promise<{ socket: string }>;
  now?: () => number;
  budgetMs?: number;
  backoffMs?: number;
  log?: (line: string) => void;
}

const ago = (ms: number) => ms < 1500 ? "just now" : `${Math.round(ms / 1000)}s ago`;
const firstLine = (e: unknown) => (e instanceof Error ? e.message : String(e)).split("\n")[0]!;

/**
 * Each mirrored outline has its own verdict (machine and outline together): one outline the machine's host can't open
 * never takes the others' live route with it, and an attempt only ever writes the verdict of its own outline.
 */
export class LiveMachines {
  private readonly verdicts = new Map<string, Verdict>();
  private readonly tries = new Map<string, Promise<Verdict>>();
  private readonly boards = new Map<string, SocketBoard>();
  private readonly forward: NonNullable<LiveOptions["forward"]>;
  private readonly now: () => number;
  private readonly budgetMs: number;
  private readonly backoffMs: number;
  private readonly log: (line: string) => void;
  private closed = false;

  constructor(o: LiveOptions = {}) {
    this.forward = o.forward ?? (m => forwardTo(m));
    this.now = o.now ?? Date.now;
    this.budgetMs = o.budgetMs ?? LIVE_BUDGET_MS;
    this.backoffMs = o.backoffMs ?? LIVE_BACKOFF_MS;
    this.log = o.log ?? (() => {});
  }

  /** How `outline` on `machine` is served now, without trying. */
  route(machine: string, outline: string): LiveRoute {
    const v = this.verdicts.get(`${machine}/${outline}`);
    if (!v) return { via: "mirror", checkedAt: null, why: `${machine} hasn't been tried yet` };
    const checkedAt = new Date(v.at).toISOString();
    return v.up ? { via: "live", checkedAt } : { via: "mirror", checkedAt, why: this.said(machine, v), ...(v.command ? { command: v.command } : {}) };
  }

  private said(machine: string, v: Extract<Verdict, { up: false }>) {
    return `${machine} didn't answer over ssh (tried ${ago(this.now() - v.at)}): ${v.why}`;
  }

  private away(machine: string, v: Extract<Verdict, { up: false }>): LiveAnswer {
    return { away: { why: this.said(machine, v), checkedAt: new Date(v.at).toISOString(), ...(v.command ? { command: v.command } : {}) } };
  }

  private fail(why: string, command?: string): Extract<Verdict, { up: false }> {
    return { up: false, at: this.now(), why, ...(command ? { command } : {}) };
  }

  /** The outline's board on `machine`'s own host, or why not (and the mirror serves). The whole try is within the budget. */
  async board(machine: string, outline: string): Promise<LiveAnswer> {
    const key = `${machine}/${outline}`;
    const known = this.verdicts.get(key);
    if (known && !known.up && this.now() - known.at < this.backoffMs) return this.away(machine, known);
    let attempt = this.tries.get(key);
    if (!attempt) {
      const started: Promise<Verdict> = this.reach(machine, outline).finally(() => { if (this.tries.get(key) === started) this.tries.delete(key); });
      attempt = started;
      this.tries.set(key, started);
      // A try past its budget still ends: its verdict is what the next call finds.
      void started.then(v => { this.verdicts.set(key, v); });
    }
    let timer: Timer | undefined;
    const late = new Promise<"late">(resolve => { timer = setTimeout(() => resolve("late"), this.budgetMs); });
    const verdict = await Promise.race([attempt, late]).finally(() => clearTimeout(timer));
    if (verdict === "late") {
      const v = this.fail(`no answer within ${this.budgetMs / 1000}s (the connection may still be coming up; the next try after the wait finds it if it has)`);
      // Only while the try is still running: its own verdict, when it comes, replaces this one.
      if (this.tries.has(key)) this.verdicts.set(key, v);
      return this.away(machine, v);
    }
    return verdict.up ? { board: verdict.board, host: verdict.host } : this.away(machine, verdict);
  }

  /** The forward answers, its host speaks this PROTOCOL and opens the outline: the outline is live. */
  private async reach(machine: string, outline: string): Promise<Verdict> {
    let socket: string;
    try { socket = (await this.forward(machine)).socket; }
    catch (e) { this.log(`mcp live: ${machine}: ${firstLine(e)}`); return this.fail(firstLine(e)); }
    if (this.closed) return this.fail("the gateway is shutting down");
    const probe = new SocketBoard(socket, REQUEST_TIMEOUT_MS);
    try {
      const r = await probe.request<{ protocolVersion: number }>("ping");
      if (r.protocolVersion !== PROTOCOL) {
        const why = `its outline host speaks protocol ${r.protocolVersion} and this gateway ${PROTOCOL}`;
        this.log(`mcp live: ${machine}: ${why}`);
        return this.fail(r.protocolVersion < PROTOCOL ? `${why}; on ${machine} run \`ep0ch install --apply\` to update and restart it` : `${why}; on this gateway's machine run \`ep0ch install --apply\``, "ep0ch install --apply");
      }
    } catch (e) { return this.fail(firstLine(e)); }
    finally { probe.close(); }
    const key = `${machine}/${outline}/${socket}`;
    let board = this.boards.get(key);
    if (!board) {
      board = Object.assign(new SocketBoard(socket, REQUEST_TIMEOUT_MS, outline), { address: { outline, machine } }) as SocketBoard;
      this.boards.set(key, board);
    }
    let host: string;
    try { host = (await board.info()).host; }
    catch (e) { this.boards.delete(key); board.close(); this.log(`mcp live: ${machine}: ${outline}: ${firstLine(e)}`); return this.fail(`its host can't open ${outline}: ${firstLine(e)}`); }
    if (this.closed) { this.boards.delete(key); board.close(); return this.fail("the gateway is shutting down"); }
    return { up: true, at: this.now(), board: board as unknown as NotesBoard, host };
  }

  close() { this.closed = true; for (const b of this.boards.values()) b.close(); this.boards.clear(); }
}

/** The settings from the environment: `EP0CH_MCP_LIVE=0` turns the live route off. */
export function liveFromEnv(env: Record<string, string | undefined>, log?: (line: string) => void): LiveMachines | null {
  if (env.EP0CH_MCP_LIVE?.trim() === "0") return null;
  const ms = (v: string | undefined) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : undefined; };
  return new LiveMachines({ budgetMs: ms(env.EP0CH_MCP_LIVE_BUDGET_MS), backoffMs: ms(env.EP0CH_MCP_LIVE_BACKOFF_MS), ...(log ? { log } : {}) });
}
