// A Claude session running twice (PIE-1369): two processes on one session id (a `claude --continue` started while the
// session was live elsewhere: Remote Control, a reconnect after ssh dropped), both writing one transcript. The door
// reads each machine's sessions through `ep0ch agent ls`'s one reader (src/agent-fleet.ts `readSessions`: this machine's
// `scripts/agent-restart --ls`, the outline's machine over ssh), finds a session id held by two or more processes, and
// says it as the status bar's `⚠ <name> ×2` chip only while it lasts. A click on the chip (`claude.splits`) lists the
// processes in a picker over the screen; `claude.attach` and `claude.stop` are what a row does, by key, click and `act`.
// Glue only: the reader, the chip, the picker and the dispatcher are the door's own parts.
import { isLocalMachine, localMachineName } from "@ep0ch/outliner/machine-name";
import { isMachineName } from "@ep0ch/outline-core/outline-location";
import { agentStop, readSessions, type FleetIO, type SessionRow } from "./agent-fleet";
import { ago as agoOf } from "./text";
import { ActionRefused, actionSet, def } from "./surface/actions";
import { centred, ListPicker, pickRow, pickRows } from "./surface/picker";
import { C, fg } from "./style";
import type { Actor } from "./socket";

type Env = Record<string, string | undefined>;

/** One session id held by two or more processes on one machine, its processes oldest first. */
export interface Split {
  machine: string;
  /** The machine is this one: its processes are stopped and attached here, not over ssh. */
  local: boolean;
  sessionId: string;
  name: string;
  procs: SessionRow[];
}

/** What each machine answered: its rows, or why it couldn't be read. */
export interface MachineRead { machine: string; local: boolean; rows?: readonly SessionRow[]; error?: string }

/**
 * The splits in what the machines answered: a session id with two or more processes on one machine (two machines can't
 * write one transcript). A process listed twice (the same pid) is one process.
 */
export function splitsOf(reads: readonly MachineRead[]): Split[] {
  const out: Split[] = [];
  for (const m of reads) {
    const by = new Map<string, SessionRow[]>();
    for (const r of m.rows ?? []) {
      if (!r.sessionId) continue;
      const list = by.get(r.sessionId) ?? [];
      if (r.pid != null && list.some(o => o.pid === r.pid)) continue;
      list.push(r);
      by.set(r.sessionId, list);
    }
    for (const [sessionId, procs] of by) {
      if (procs.length < 2) continue;
      procs.sort((a, b) => (a.startedAt ?? Infinity) - (b.startedAt ?? Infinity));
      out.push({ machine: m.machine, local: m.local, sessionId, name: procs.find(p => p.name)?.name || sessionId.slice(0, 8), procs });
    }
  }
  return out;
}

/** The status bar's chip: `⚠ kitty-sr-1 ×2`, `⚠ 2 sessions ×3` for several (the most processes one has); "" when nothing runs twice. */
export function splitChip(splits: readonly Split[]): string {
  if (!splits.length) return "";
  if (splits.length === 1) return `⚠ ${splits[0]!.name} ×${splits[0]!.procs.length}`;
  return `⚠ ${splits.length} sessions ×${Math.max(...splits.map(s => s.procs.length))}`;
}

/** How long ago `at` was (the door's one `ago`, src/text.ts), or `?`. */
const ago = (at: number | null | undefined, now: number) => (at == null ? "?" : agoOf(at, now));

/** A clock time, local: `07:02`, or `?`. */
const clock = (at: number | null | undefined) => (at == null ? "?" : new Date(at).toTimeString().slice(0, 5));

/**
 * The words for one process of a split: its pid, machine, start, what `claude agents` says it's doing (busy, idle,
 * waiting: the one per-process sign of which is in use), which one it is, and where it runs.
 */
export function processWords(s: Split, p: SessionRow, now: number): string {
  const i = s.procs.indexOf(p);
  const which = i === 0 ? "older" : i === s.procs.length - 1 ? "newer" : `#${i + 1}`;
  const where = p.kind === "background" ? `background job ${p.id}` : p.place ?? "interactive";
  return `pid ${p.pid ?? "?"} · ${s.machine} · started ${clock(p.startedAt)} (${ago(p.startedAt, now)} ago) · ${p.status || "?"} · ${which} · ${where}`;
}

/** When the session's one transcript was last written: the processes share it, so it is the session's, not a process's. */
export function lastWriteOf(s: Split): number | null {
  const ts = s.procs.map(p => p.lastWrite).filter((t): t is number => typeof t === "number");
  return ts.length ? Math.max(...ts) : null;
}

/** The command that stops one process of a split, as a person types it. */
export function stopCommand(s: Split, p: SessionRow): string {
  return `ep0ch agent stop ${p.pid ?? "<pid>"} --session ${s.sessionId.slice(0, 8)}${s.local ? "" : ` --machine ${s.machine}`}`;
}

/**
 * The command line that attaches this terminal to a background process (`claude attach <job id>`, over `ssh -t` on
 * another machine), or why it can't be: an interactive one is its terminal's, so it says where that runs and how to stop it.
 */
export function attachCommand(s: Split, p: SessionRow): { cmd: string } | { refused: string } {
  if (p.kind !== "background") return { refused: `pid ${p.pid ?? "?"} is interactive: its terminal owns it (${p.place ?? "where it runs isn't known"}), so there is nothing to attach; go there, or stop one: ${stopCommand(s, p)}` };
  if (!/^[\w-]+$/.test(p.id)) return { refused: `job id ${JSON.stringify(p.id)} isn't one claude attach takes` };
  const here = `claude attach ${p.id}`;
  return { cmd: s.local ? here : `ssh -t ${s.machine} 'exec "\${SHELL:-/bin/sh}" -lc "${here}"'` };
}

/** How often the machines are read while someone looks at the door: the chip shows within a minute (the ticket's bar). */
export const SPLIT_EVERY_MS = 45_000;

export interface SplitWatchOptions {
  fleet: FleetIO;
  env: Env;
  /** The machines to read: this one (undefined) and the outline's, when the door reached it on another. */
  machines(): readonly (string | undefined)[];
  now(): number;
  /** Someone sees the door: nothing is read for nobody. */
  seen(): boolean;
  /** The splits changed: the status bar is drawn again. */
  changed(): void;
}

/** The door's reading of its machines' Claude sessions: read at most every SPLIT_EVERY_MS, while someone looks. */
export class SplitWatch {
  private found: Split[] = [];
  private reads: MachineRead[] = [];
  private at = -Infinity;
  private reading: Promise<Split[]> | null = null;
  /** Off for tests (EP0CH_CLAUDE_SPLITS=off): no test reads the real `claude agents`; the showcase's section hands it rows. */
  private on: boolean;
  /** The showcase's made-up machines, when it handed some (`demo`). */
  private demoMachines: readonly string[] | null = null;
  /** Showing made-up sessions: an attach's terminal says the command it would run instead of running it. */
  get demoing(): boolean { return !!this.demoMachines; }
  constructor(private o: SplitWatchOptions) { this.on = o.env.EP0CH_CLAUDE_SPLITS !== "off"; }

  /** The splits as last read; a read is started when it's due and someone looks. */
  splits(): Split[] {
    if (this.on && !this.reading && this.o.now() - this.at >= SPLIT_EVERY_MS && this.o.seen()) void this.refresh();
    return this.found;
  }
  chip(): string { return splitChip(this.splits()); }

  private machines(): { machine?: string; label: string; local: boolean }[] {
    if (this.demoMachines) return this.demoMachines.map(m => ({ machine: m, label: m, local: false }));
    const here = localMachineName();
    const seen = new Set<string>();
    // An outline's machine that is this one (its own name, an alias) is read once, as this machine.
    return this.o.machines().map(m => (m && isLocalMachine(m, this.o.env as NodeJS.ProcessEnv) ? undefined : m)).flatMap(m => {
      const key = m ?? "";
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ ...(m ? { machine: m } : {}), label: m ?? here, local: !m }];
    });
  }

  /** Read every machine now (the one read in flight, if one is). */
  refresh(): Promise<Split[]> {
    if (this.reading) return this.reading;
    this.reading = (async () => {
      const reads = await Promise.all(this.machines().map(async (m): Promise<MachineRead> => {
        try {
          const r = await readSessions(m.machine, this.o.env, this.o.fleet);
          return "error" in r ? { machine: m.label, local: m.local, error: r.error } : { machine: m.label, local: m.local, rows: r.rows };
        } catch (e) { return { machine: m.label, local: m.local, error: (e as Error).message }; }
      }));
      const before = splitChip(this.found) + this.found.map(s => s.procs.map(p => p.pid).join()).join();
      this.reads = reads;
      this.found = splitsOf(reads);
      this.at = this.o.now();
      if (splitChip(this.found) + this.found.map(s => s.procs.map(p => p.pid).join()).join() !== before) this.o.changed();
      return this.found;
    })().finally(() => { this.reading = null; });
    return this.reading;
  }

  /** The showcase's made-up machines (their rows come from `fleet`): read at once, and on from now on. */
  demo(fleet: FleetIO, machines: readonly string[]): Promise<Split[]> {
    this.o = { ...this.o, fleet };
    this.demoMachines = machines;
    this.on = true;
    this.at = -Infinity;
    return this.refresh();
  }

  /** The process `pid` (on `machine`, when the pid alone names more than one; of `session`, when the caller saw one), with its split. */
  find(pid: number, machine?: string, session?: string): { split: Split; proc: SessionRow } {
    const hits = this.found.flatMap(split => split.procs.filter(p => p.pid === pid && (!machine || split.machine === machine) && (!session || split.sessionId.startsWith(session))).map(proc => ({ split, proc })));
    if (!hits.length) throw new ActionRefused(`pid ${pid}${machine ? ` on ${machine}` : ""}${session ? ` of session ${session.slice(0, 8)}` : ""} isn't a process of a session running twice now · claude.splits lists them`);
    if (hits.length > 1) throw new ActionRefused(`pid ${pid} is on ${hits.map(h => h.split.machine).join(" and ")}: say machine=`);
    return hits[0]!;
  }

  /** Stop one process (its pid checked again where it runs), then read again; the words said. */
  async stop(split: Split, proc: SessionRow): Promise<{ ok: boolean; said: string }> {
    let said = "";
    const code = await agentStop([String(proc.pid), "--session", split.sessionId, ...(split.local ? [] : ["--machine", split.machine])], this.o.env, this.o.fleet, s => { said += s; }, s => { said += s; });
    await this.refresh();
    return { ok: code === 0, said: said.trim() };
  }

  /** What `peek` and `claude.splits` answer: each split with its processes, and the machines that couldn't be read. */
  describe() {
    return { ...describeSplits(this.found, this.o.now()), unread: this.reads.filter(r => r.error).map(r => ({ machine: r.machine, why: r.error })), readAt: Number.isFinite(this.at) ? this.at : null };
  }
}

/** The splits as data: what `claude.splits`, `peek` and `ep0ch agent splits --json` answer (the Claude mod reads the last). */
export function describeSplits(splits: readonly Split[], now: number) {
  return {
    splits: splits.map(s => ({
      machine: s.machine, sessionId: s.sessionId, name: s.name, lastWrite: lastWriteOf(s),
      procs: s.procs.map(p => {
        const attach = attachCommand(s, p);
        return { pid: p.pid ?? null, kind: p.kind, id: p.id, status: p.status, startedAt: p.startedAt ?? null, place: p.place, words: processWords(s, p, now), stop: stopCommand(s, p), ...("cmd" in attach ? { attach: attach.cmd } : {}) };
      }),
    })),
  };
}

const SPLITS_USAGE = "ep0ch agent splits [--session <id>] [--machine <ssh-name>] [--json]";

/**
 * `ep0ch agent splits`: the Claude sessions running twice on this machine (or `--machine`), `--session` only that one,
 * each process with the command that stops it and, for a background job, the one that attaches it. The Claude mod
 * runs it at session start (`--json --session <its id>`), so the door and the mod decide a split in one place.
 */
export async function agentSplits(argv: readonly string[], env: Env, io: FleetIO, out: (s: string) => void = console.log, err: (s: string) => void = console.error): Promise<number> {
  let machine: string | undefined, session: string | undefined, json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!, v = () => { const x = argv[++i]; if (x === undefined || x.startsWith("-")) throw new Error(`${a} needs a value · ${SPLITS_USAGE}`); return x; };
    try {
      if (a === "--json") json = true;
      else if (a === "--session") session = v();
      else if (a === "--machine") { machine = v(); if (!isMachineName(machine)) throw new Error(`--machine ${JSON.stringify(machine)} isn't an ssh config name · ${SPLITS_USAGE}`); }
      else throw new Error(`no argument ${a} · ${SPLITS_USAGE}`);
    } catch (e) { err(`ep0ch agent splits: ${(e as Error).message}`); return 2; }
  }
  const local = !machine || isLocalMachine(machine, env as NodeJS.ProcessEnv);
  const read = await readSessions(local ? undefined : machine, env, io);
  if ("error" in read) { err(read.error); return read.code; }
  const splits = splitsOf([{ machine: local ? localMachineName() : machine!, local, rows: read.rows }]).filter(s => !session || s.sessionId.startsWith(session));
  const now = Date.now();
  if (json) { out(JSON.stringify(describeSplits(splits, now))); return 0; }
  if (!splits.length) { out(`no Claude session runs twice${session ? ` as ${session.slice(0, 8)}` : ""} on ${local ? "this machine" : machine}`); return 0; }
  out(splits.map(s => [`${s.name} (session ${s.sessionId.slice(0, 8)}) runs as ${s.procs.length} processes on ${s.machine}, its transcript written ${ago(lastWriteOf(s), now)} ago:`,
    ...s.procs.map(p => { const a = attachCommand(s, p); return `  ${processWords(s, p, now)} · stop: ${stopCommand(s, p)}${"cmd" in a ? ` · attach: ${a.cmd}` : ""}`; })].join("\n")).join("\n"));
  return 0;
}

/** One row of the picker: a process of a split. */
interface Row { split: Split; proc: SessionRow }

/** What the claude actions run on: the door's watch, how to run an action as the person, and the screen to pick over. */
export interface SplitOn {
  splits?: SplitWatch;
  flash(msg: string, ms?: number): void;
  /** Run an action as the person (the dispatcher). */
  press?(action: string, args: Record<string, unknown>): Promise<unknown>;
  /** Run an action as the same actor (tile.open for an attach). */
  again?(action: string, args: Record<string, unknown>): Promise<unknown>;
  /** The screen shown, when it can hold a picker over it. */
  over?: { overlay(p: ListPicker<any, any>): void } | null;
  redraw(): void;
}

const watchOf = (on: SplitOn) => {
  if (!on.splits) throw new ActionRefused("this door doesn't read Claude sessions");
  return on.splits;
};

/** The picker of the splits' processes: a heading per session, a row per process; a and s act on the row, ⏎ asks which. */
function splitsPicker(on: SplitOn, watch: SplitWatch): ListPicker<Row, unknown> {
  const now = () => Date.now();
  const rows = (): Row[] => watch.splits().flatMap(split => split.procs.map(proc => ({ split, proc })));
  const press = (action: string, r: Row | undefined) => { if (r) void on.press?.(action, { pid: r.proc.pid, machine: r.split.machine, ...(action === "claude.stop" ? { session: r.split.sessionId } : {}) }); };
  const p: ListPicker<Row, unknown> = new ListPicker<Row, unknown>({
    name: "claude splits", items: rows, scrolls: true,
    heading: (r, i, w) => (i === 0 || rows()[i - 1]!.split !== r.split ? pickRow(` ${r.split.name} · session ${r.split.sessionId.slice(0, 8)} · ${r.split.procs.length} processes write one transcript, written ${ago(lastWriteOf(r.split), now())} ago`, false, w, C.yellow) : null),
    row: (r, _i, lit, w) => pickRows(`   ${processWords(r.split, r.proc, now())}`, lit, w),
    choose: r => { on.over?.overlay(rowChoice(on, r)); on.redraw(); },
    bindings: [{ key: "a", action: "claude.attach", label: "attach" }, { key: "s", action: "claude.stop", label: "stop…" }],
    dispatch: (b, h) => { const r = rows()[p.sel]; p.close(h, "letter"); press(b.action, r); },
    frame: (a, n) => ({ rect: centred(a, Math.min(a.cols - 2, 110), Math.min(a.rows - 1, n * 2 + 5)), title: "a Claude session running twice" }),
  });
  return p;
}

/** ⏎ on a row: attach (a background job), or stop this pid (asked again). */
function rowChoice(on: SplitOn, r: Row): ListPicker<string, unknown> {
  const attach = attachCommand(r.split, r.proc);
  const items = [...("cmd" in attach ? [`attach: ${attach.cmd}`] : []), `stop pid ${r.proc.pid ?? "?"}…`, "leave both"];
  return new ListPicker<string, unknown>({
    name: "claude split row", items: () => items, clickChooses: true,
    row: (t, _i, lit, w) => pickRows(` ${t}`, lit, w),
    choose: t => {
      if (t.startsWith("attach")) void on.press?.("claude.attach", { pid: r.proc.pid, machine: r.split.machine });
      else if (t.startsWith("stop")) void on.press?.("claude.stop", { pid: r.proc.pid, machine: r.split.machine, session: r.split.sessionId });
    },
    frame: a => ({ rect: centred(a, Math.min(a.cols - 2, Math.max(44, ...items.map(t => t.length + 4))), items.length + 2), title: `${r.split.name} · pid ${r.proc.pid ?? "?"} on ${r.split.machine}` }),
  });
}

/** The person's yes for a stop: the pid said again in the choice, as `note.trash`'s two-row choice. */
function stopConfirm(on: SplitOn, r: Row): ListPicker<string, unknown> {
  const items = [`stop pid ${r.proc.pid} (${processWords(r.split, r.proc, Date.now()).split(" · ").slice(2, 6).join(" · ")})`, "keep it"];
  const p = new ListPicker<string, unknown>({
    name: "claude stop", items: () => items, clickChooses: true,
    row: (t, _i, lit, w) => pickRows(` ${t}`, lit, w),
    choose: (_t, i) => { if (i === 0) void on.press?.("claude.stop", { pid: r.proc.pid, machine: r.split.machine, session: r.split.sessionId, confirm: r.proc.pid }); },
    frame: a => ({ rect: centred(a, Math.min(a.cols - 2, Math.max(44, items[0]!.length + 4)), 4), title: `stop pid ${r.proc.pid} of ${r.split.name} on ${r.split.machine}?` }),
  });
  return p;
}

const PID = { pid: { type: "number", about: "the process (claude.splits lists them)" }, machine: { type: "string", optional: true, about: "its machine, when the pid alone names more than one" } } as const;

export const CLAUDE_SPLIT_ACTIONS = actionSet<SplitOn>()("claude", {
  "claude.splits": def({
    summary: "the Claude sessions running twice (PIE-1369): a session id held by two or more processes on one machine (a `claude --continue` started while it ran elsewhere), both writing one transcript, read from this machine's and the outline's machine's `claude agents` (ep0ch agent ls). The person's opens them in a picker over the screen (a attach, s stop…, ⏎ asks which); an agent's answers them. refresh=true reads the machines first. The status bar's ⚠ <name> ×2 chip is a click on this, there only while a split lasts",
    keys: "a click on the status bar's ⚠ ×2 chip",
    touches: "nothing", replay: "safe", repaints: true,
    args: { refresh: { type: "boolean", optional: true, about: "read the machines now, not the last read (at most 45 s old)" } },
    answer: { splits: { type: "array", about: "each session running twice: machine, sessionId, name, procs (pid, kind, id, startedAt, lastWrite, place, words, stop: the command, attach: the command for a background job)" }, unread: { type: "array", about: "machines that couldn't be read, and why" } },
    examples: [
      { act: "claude.splits", does: "answers the sessions running twice, each process with its pid, start and last write" },
      { act: "claude.splits refresh=true", does: "reads every machine again first" },
    ],
    async run({ refresh }, on, actor) {
      const watch = watchOf(on);
      if (refresh) await watch.refresh();
      const d = watch.describe();
      if (actor.kind === "agent") return d;
      if (!d.splits.length) { on.flash(`no Claude session runs twice${d.unread.length ? ` · not read: ${d.unread.map(u => `${u.machine} (${u.why})`).join("; ")}` : ""}`, 6000); return d; }
      if (!on.over) {
        on.flash(d.splits.map(s => `${s.name} ×${s.procs.length} on ${s.machine}: ${s.procs.map(p => `pid ${p.pid}, ${p.stop}`).join("; ")}`).join(" · "), 20_000);
        return d;
      }
      on.over.overlay(splitsPicker(on, watch));
      on.redraw();
      return d;
    },
  }),
  "claude.attach": def({
    summary: "attach to one process of a Claude session running twice: a background job opens in a new terminal tile running `claude attach <job id>` (over ssh -t on another machine); an interactive one is its terminal's, refused with where it runs and how to stop it",
    keys: "a on a row of claude.splits' picker; ⏎ then attach",
    touches: "shape", replay: "ask",
    says: (out: { cmd?: string }) => (out?.cmd ? `· opened ${out.cmd}` : null),
    args: PID,
    answer: { cmd: { type: "string", about: "the command the new terminal tile runs" }, tile: { type: "string", kind: "tile", about: "the terminal tile it opened" } },
    examples: [{ act: "claude.attach pid=28521", does: "opens a terminal tile attached to that background job's session" }],
    async run({ pid, machine }, on) {
      const { split, proc } = watchOf(on).find(pid, machine);
      const a = attachCommand(split, proc);
      if ("refused" in a) throw new ActionRefused(a.refused);
      // The showcase's sessions are made up: its terminal says what it would run, and leaves a shell.
      const said = `made-up session (the showcase): a real one runs ${a.cmd}`;
      const cmd = watchOf(on).demoing ? `printf '%s\\n' '${said.replaceAll("'", `'\\''`)}'; exec "\${SHELL:-sh}"` : a.cmd;
      const opened = await (on.again ?? on.press)?.("tile.open", { kind: "pty", cmd, name: `attach-${proc.id}` }) as { tile?: string; name?: string } | undefined;
      return { cmd: a.cmd, pid, machine: split.machine, ...(opened?.tile ? { tile: opened.tile, name: opened.name } : {}) };
    },
  }),
  "claude.stop": def({
    summary: "stop one process of a Claude session running twice (a TERM, as closing its terminal; Claude saves as it goes), checked again where it runs: only while that pid is still a process of that session and another process still holds it. The person's first press asks in a two-row choice naming the pid; an agent passes confirm=<the pid>, said twice. The other process keeps the session",
    keys: "s on a row of claude.splits' picker; ⏎ then stop",
    touches: "nothing", replay: "ask", confirms: true,
    says: (out: { stopped?: number; said?: string }) => (out?.stopped ? `· ${out.said ?? `stopped pid ${out.stopped}`}` : null),
    args: { ...PID, session: { type: "string", optional: true, about: "the session id (or its first 8+ characters) the pid was seen in: a pid that holds another session by now is refused" }, confirm: { type: "number", optional: true, about: "the same pid again: the stop is meant" } },
    answer: { stopped: { type: "number", about: "the pid stopped" }, said: { type: "string", about: "what the stop said" } },
    examples: [{ act: "claude.stop pid=28521 confirm=28521", does: "stops that process; the session goes on in the other" }],
    async run({ pid, machine, session, confirm }, on, actor: Actor) {
      const watch = watchOf(on);
      const { split, proc } = watch.find(pid, machine, session);
      if (confirm === undefined) {
        if (actor.kind === "agent") throw new ActionRefused(`claude.stop needs confirm=${pid}: the same pid, said twice (${stopCommand(split, proc)})`);
        if (!on.over) throw new ActionRefused(`no screen to ask on here: ${stopCommand(split, proc)} stops it`);
        on.over.overlay(stopConfirm(on, { split, proc }));
        on.redraw();
        return { armed: pid, say: `stop pid ${pid}? ⏎ stops it, esc keeps it` };
      }
      if (confirm !== pid) throw new ActionRefused(`confirm=${confirm} isn't pid ${pid}; pass the same pid to stop it`);
      const r = await watch.stop(split, proc);
      if (!r.ok) throw new ActionRefused(r.said || `pid ${pid} wasn't stopped`);
      on.flash(`${r.said} · ${split.name} goes on in pid ${split.procs.filter(p => p !== proc).map(p => p.pid ?? "?").join(", ")}`, 8000);
      on.redraw();
      return { stopped: pid, said: r.said };
    },
  }),
});
