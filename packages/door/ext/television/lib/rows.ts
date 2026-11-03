// The system channels' rows (packages/door/ext/television, PIE-1535): ep0ch-agents, ep0ch-health, ep0ch-board and
// herdr. `ep0ch-tv` runs this with bun; each verb is one read of a command that already answers in JSON (`ep0ch agent ls
// --json`, `ep0ch doctor --json`, `ep0ch link status --json`, `ep0ch session list --json`, `ep0ch find --json`, `gh pr
// list --json`, `herdr session list --json` and `herdr api snapshot`), drawn as tv lists it, or one action on a row.
// Nothing here lists a part again: a row is what its command answered.
//
// A row is a line as shown (coloured: the channel has ansi = true), then the row's key in an empty OSC 8 link
// (`ESC ]8;;ep0ch:<key> ESC \`), as the ep0ch channel's notes carry their ids: tv drops escapes from what it shows and
// matches, and the cable templates take the key from the raw line. A key is letters, digits and `_ . : ~ -` only (tv
// pastes it into commands unescaped); every action reads its row again by that key rather than trusting the line.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir, userInfo } from "node:os";
import { basename, dirname, join } from "node:path";

type Env = Record<string, string | undefined>;
export interface Ran { code: number; out: string; err: string }
export type Exec = (argv: string[], o?: { cwd?: string; timeoutMs?: number }) => Promise<Ran>;

export const KEY = /^[0-9A-Za-z_.:~-]+$/;
const E = "\x1b";
const c = (code: string, s: string) => `${E}[${code}m${s}${E}[0m`;
const dim = (s: string) => c("90", s);
/** One row as tv's channel lists it: what's shown, then the key out of view. */
export const row = (shown: string, key: string) => `${shown}${E}]8;;ep0ch:${key}${E}\\${E}]8;;${E}\\`;
const safeKey = (s: string) => s.replace(/[^0-9A-Za-z_.:~-]+/g, "_");

export function ago(ms: number | null | undefined, now = Date.now()): string {
  if (!ms) return "";
  const m = Math.max(0, Math.round((now - ms) / 60_000));
  return m < 60 ? `${m}m` : m < 48 * 60 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
}
const pad = (s: string, n: number) => (s.length >= n ? s : s + " ".repeat(n - s.length));

// ── agents ────────────────────────────────────────────────────────────────────────────────────────────────────────
/** A row of `ep0ch agent ls --json` (src/agent-fleet.ts's SessionRow; only what is drawn). */
export interface AgentRow {
  name: string; id: string; sessionId: string; kind: string; status: string; cwd: string; place: string | null;
  door?: string | null; state?: string | null; waitingFor?: string | null; pid?: number | null; startedAt?: number | null;
  lastWrite?: number | null; running?: string | null; behind?: boolean;
}

/** working, waiting (and why), idle: in claude's own words, coloured by whether it needs someone. */
export function agentStatus(r: AgentRow): { word: string; tone: string } {
  if (r.status === "waiting") return { word: `blocked: ${r.waitingFor || "waiting"}`, tone: "31;1" };
  if (r.status === "busy" || r.state === "working") return { word: "working", tone: "32" };
  return { word: r.state === "done" ? "done" : r.status || "?", tone: "36" };
}

export function agentRows(rows: readonly AgentRow[], now = Date.now()): string[] {
  const nameW = Math.min(28, Math.max(4, ...rows.map(r => (r.name || r.id).length)));
  return rows.map(r => {
    const s = agentStatus(r);
    const where = r.place ?? (r.cwd ? basename(r.cwd) : "");
    const name = r.name || r.id;
    const shown = `${c(s.tone, pad(s.word, 22).slice(0, 22))} ${c("33;1", pad(name.length > nameW ? `${name.slice(0, nameW - 1)}…` : name, nameW))}  ${dim(`${r.kind === "background" ? "bg" : "tty"} · ${where} · ${ago(r.lastWrite ?? r.startedAt, now)}${r.behind ? " · behind" : ""}`)}`;
    return row(shown, r.sessionId);
  });
}

/** The transcript Claude keeps for a session (~/.claude/projects/<folder>/<id>.jsonl), when there's one. */
export function transcriptOf(sessionId: string, env: Env = process.env): string | null {
  const base = join(env.CLAUDE_CONFIG_DIR || join(env.HOME || homedir(), ".claude"), "projects");
  try {
    for (const d of readdirSync(base)) { const f = join(base, d, `${sessionId}.jsonl`); if (existsSync(f)) return f; }
  } catch { /* none */ }
  return null;
}

/** Its newest messages, oldest first: who and the text, from a transcript's lines. */
export function newestMessages(jsonl: string, n = 8): { who: string; text: string }[] {
  const out: { who: string; text: string }[] = [];
  for (const line of jsonl.trimEnd().split("\n").reverse()) {
    if (out.length >= n) break;
    let e: { type?: string; message?: { content?: unknown } };
    try { e = JSON.parse(line); } catch { continue; }
    if (e.type !== "user" && e.type !== "assistant") continue;
    const content = e.message?.content;
    const text = typeof content === "string" ? content
      : Array.isArray(content) ? content.filter((p: { type?: string }) => p?.type === "text").map((p: { text?: string }) => p.text ?? "").join("\n") : "";
    if (text.trim()) out.push({ who: e.type === "user" ? "you" : "claude", text: text.trim() });
  }
  return out.reverse();
}

export function agentPreview(r: AgentRow, messages: { who: string; text: string }[], now = Date.now()): string {
  const s = agentStatus(r);
  const lines = [
    `${c("33;1", r.name || r.id)}  ${c(s.tone, s.word)}`,
    dim(`${r.kind} · ${r.id} · pid ${r.pid ?? "?"} · started ${ago(r.startedAt, now)} ago · last write ${ago(r.lastWrite, now)} ago`),
    dim(`${r.cwd}${r.place ? ` · ${r.place}` : ""}${r.running ? ` · claude ${r.running}${r.behind ? " (behind)" : ""}` : ""}`),
    "",
  ];
  if (!messages.length) lines.push(dim("(no messages in its transcript yet)"));
  else lines.push(dim("newest first"), "");
  for (const m of [...messages].reverse()) lines.push(c(m.who === "you" ? "35;1" : "36;1", m.who), ...m.text.split("\n").slice(0, 12), "");
  return lines.join("\n");
}

/** What each action runs for a session, or why it can't: background jobs are the daemon's; a terminal owns the rest. */
export function agentCommand(r: AgentRow, what: "open" | "restart" | "stop"): { argv: string[]; door?: true } | { refused: string } {
  const where = r.place ? ` (it runs in ${r.place})` : "";
  if (what === "restart") return r.kind === "background" || r.door ? { argv: ["agent", "restart", r.id], door: true } : { refused: `${r.name || r.id} is a terminal's session${where}: restart it there (/exit, then claude --continue)` };
  if (r.kind !== "background") return { refused: `${r.name || r.id} is a terminal's session${where}: ${what === "stop" ? "/exit in that terminal ends it" : "switch to that terminal"}` };
  if (what === "stop") return { argv: ["claude", "stop", r.id] };
  return { argv: ["act", "tile.open", "kind=pty", `cmd=claude attach ${r.id}`, `name=attach-${r.id}`, "--as", "television"], door: true };
}

// ── health ────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface HealthRow { key: string; group: string; name: string; status: string; detail: string; fix?: string }
interface DoctorJson { checks?: { group: string; name: string; status: string; detail: string; fix?: string }[] }
interface LinkJson { links?: { machine: string; transport?: string; up: boolean; since?: string; direction?: string; error?: string }[] }
interface SessionJson { pid: number; code?: { dir?: string; commit?: string }; place?: { outline?: string; machine?: string }; clients?: unknown[] }

const TONE: Record<string, string> = { ok: "32", info: "90", behind: "33;1", unknown: "33", missing: "31;1" };
const MARK: Record<string, string> = { ok: "✓", info: "·", behind: "!", unknown: "?", missing: "×" };

/** Doctor's checks, the links and each machine's door sessions against main: one row each, worst first. */
export function healthRows(o: { doctor: DoctorJson | null; doctorError?: string; links: LinkJson | null; sessions: { machine: string; rows: SessionJson[] | null; error?: string }[]; main: string | null }): HealthRow[] {
  const out: HealthRow[] = [];
  const add = (group: string, name: string, status: string, detail: string, fix?: string) => out.push({ key: safeKey(`${group}~${name}`), group, name, status, detail, ...(fix ? { fix } : {}) });
  if (o.doctor?.checks) for (const k of o.doctor.checks) add(k.group, k.name, k.status, k.detail, k.fix);
  else add("ep0ch", "doctor", "missing", `ep0ch doctor --json answered nothing it could read${o.doctorError ? `: ${o.doctorError}` : ""}`, "ep0ch doctor");
  for (const l of o.links?.links ?? []) add("links", l.machine, l.up ? "ok" : "behind", `${l.direction ?? ""} ${l.transport ?? "link"} ${l.up ? "up" : "down"}${l.since ? ` since ${l.since}` : ""}${l.error ? ` · ${l.error}` : ""}${l.up ? "" : ` · ${l.direction === "inbound" ? `ssh ${l.machine} ep0ch link status` : "ep0ch link status"} says why`}`.trim());
  for (const m of o.sessions) {
    if (!m.rows) { add("sessions", m.machine, "unknown", `ep0ch session list --machine ${m.machine} didn't answer${m.error ? `: ${m.error}` : ""}`); continue; }
    for (const s of m.rows) {
      const name = `${s.place?.outline ?? "?"}${s.place?.machine ? `@${s.place.machine}` : ""} (door on ${m.machine})`;
      const commit = s.code?.commit ?? "";
      const current = !!o.main && commit === o.main;
      const install = m.machine === "here" ? "ep0ch install --apply" : `ssh ${m.machine} ep0ch install --apply`;
      add("sessions", name, !o.main ? "info" : current ? "ok" : "behind", `pid ${s.pid} · ${(s.clients ?? []).length} attached · code ${commit.slice(0, 9) || "?"}${o.main ? (current ? " = main" : `, main is ${o.main.slice(0, 9)}`) : ""} · ${s.code?.dir ?? ""}`, current || !o.main ? undefined : install);
    }
  }
  const rank: Record<string, number> = { missing: 0, behind: 1, unknown: 2, ok: 3, info: 4 };
  return out.map((r, i) => ({ r, i })).sort((a, b) => (rank[a.r.status] ?? 5) - (rank[b.r.status] ?? 5) || a.i - b.i).map(x => x.r);
}

export function healthLines(rows: readonly HealthRow[]): string[] {
  return rows.map(r => row(`${c(TONE[r.status] ?? "37", `${MARK[r.status] ?? "?"} ${pad(r.status, 7)}`)} ${c("33", pad(r.group, 9))} ${pad(r.name, 22)}${dim(`  ${r.detail.length > 90 ? `${r.detail.slice(0, 89)}…` : r.detail}${r.fix ? " · fix" : ""}`)}`, r.key));
}

export function healthPreview(r: HealthRow): string {
  return [`${c(TONE[r.status] ?? "37", `${MARK[r.status] ?? "?"} ${r.status}`)}  ${c("33;1", `${r.group} · ${r.name}`)}`, "", ...r.detail.split(/;\s+|\s+·\s+/), "",
    r.fix ? `${c("36;1", "fix (enter runs it):")}\n  ${r.fix}` : dim("nothing to run: this one is information")].join("\n");
}

// ── board ─────────────────────────────────────────────────────────────────────────────────────────────────────────
interface FoundNote { id: string; title: string; properties?: { key: string; values: string[] }[] }
const prop = (n: FoundNote, k: string) => n.properties?.find(p => p.key === k)?.values[0] ?? "";

export function boardRows(notes: readonly FoundNote[]): string[] {
  return notes.map(n => {
    const stage = prop(n, "work-stage"), pri = prop(n, "priority"), needs = prop(n, "needs");
    return row(`${c(stage === "doing" ? "32" : stage === "review" ? "35" : stage === "validate" ? "36" : "33", pad(stage || "·", 9))} ${n.title}${dim(`  · ${[pri, needs && `needs ${needs}`].filter(Boolean).join(" · ")}`)}`, n.id);
  });
}

interface Pr { number: number; title: string; headRefName?: string; isDraft?: boolean; author?: { login?: string }; updatedAt?: string }
export function prRows(prs: readonly Pr[], now = Date.now()): string[] {
  return prs.map(p => row(`${c(p.isDraft ? "90" : "32", pad(`#${p.number}`, 7))} ${p.title}${dim(`  · ${p.headRefName ?? ""} · ${ago(p.updatedAt ? Date.parse(p.updatedAt) : null, now)}`)}`, `pr-${p.number}`));
}
/** The ticket a PR carries: the first PIE-n in its title, branch or body. */
export const prTicket = (p: { title?: string; headRefName?: string; body?: string }) => /\bPIE-\d+\b/i.exec(`${p.title ?? ""} ${p.headRefName ?? ""} ${p.body ?? ""}`)?.[0]?.toUpperCase() ?? null;

// ── herdr ─────────────────────────────────────────────────────────────────────────────────────────────────────────
interface HerdrSnapshot {
  panes?: { pane_id: string; tab_id: string; workspace_id: string; agent?: string | null; agent_status?: string; cwd?: string; foreground_cwd?: string; terminal_title_stripped?: string | null; focused?: boolean }[];
  tabs?: { tab_id: string; label?: string; number?: number }[];
  workspaces?: { workspace_id: string; label?: string; number?: number }[];
}
export interface PaneRow { key: string; session: string; pane: string; tab: string; workspace: string; where: string; program: string; status: string; title: string; cwd: string }

export function herdrPanes(session: string, snap: HerdrSnapshot): PaneRow[] {
  const tab = new Map((snap.tabs ?? []).map(t => [t.tab_id, t])), ws = new Map((snap.workspaces ?? []).map(w => [w.workspace_id, w]));
  return (snap.panes ?? []).map(p => ({
    key: `${session}~${p.pane_id}`, session, pane: p.pane_id, tab: p.tab_id, workspace: p.workspace_id,
    where: `${ws.get(p.workspace_id)?.label ?? p.workspace_id} › ${tab.get(p.tab_id)?.label ?? p.tab_id}`,
    program: p.agent ?? "", status: p.agent ? p.agent_status ?? "" : "", title: p.terminal_title_stripped ?? "", cwd: p.foreground_cwd ?? p.cwd ?? "",
  }));
}

export function paneLines(rows: readonly PaneRow[]): string[] {
  return rows.map(p => row(`${c("33", pad(p.session, 10))} ${c("36", pad(p.where, 22))} ${c(p.status === "blocked" ? "31;1" : p.status === "working" ? "32" : "37", pad(p.program ? `${p.program} ${p.status}` : "shell", 16))} ${p.title || basename(p.cwd)}${dim(`  · ${p.cwd}`)}`, p.key));
}

// ── running it ────────────────────────────────────────────────────────────────────────────────────────────────────
export const realExec: Exec = async (argv, o = {}) => {
  const p = Bun.spawn(argv, { cwd: o.cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  let timer: Timer | undefined;
  const late = new Promise<Ran>(res => { timer = setTimeout(() => { try { p.kill("SIGKILL"); } catch { /* gone */ } res({ code: 124, out: "", err: `${basename(argv[0]!)} didn't answer in ${(o.timeoutMs ?? 30_000) / 1000}s` }); }, o.timeoutMs ?? 30_000); });
  const ran = Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]).then(([out, err, code]) => ({ out, err, code }));
  try { return await Promise.race([ran, late]); } finally { clearTimeout(timer); }
};
const json = <T>(r: Ran): T | null => { try { return JSON.parse(r.out) as T; } catch { return null; } };
const firstLine = (s: string) => s.trim().split("\n").at(-1) ?? "";

/** Where health keeps the rows it last listed, for its preview and its fix (doctor takes seconds; a preview mustn't). */
const healthCache = () => join(tmpdir(), `ep0ch-tv-health-${userInfo().uid}.json`);

async function main(argv: string[]) {
  const door = process.env.EP0CH_DOOR_MAIN!;
  const ep0ch = (args: string[], o?: { timeoutMs?: number }) => realExec([process.execPath, door, ...args], o);
  const repo = join(dirname(door), "../../..");
  const [verb, arg = ""] = argv;
  if (["agent-preview", "agent-open", "agent-restart", "agent-stop", "health-preview", "health-fix", "board-preview", "board-open", "pane-preview", "pane-focus", "pane-attach"].includes(verb!) && !KEY.test(arg)) {
    console.error(`ep0ch-tv: ${JSON.stringify(arg)} isn't a row's key`); process.exit(2);
  }
  const say = (s: string) => console.log(s);
  const agents = async () => {
    const r = await ep0ch(["agent", "ls", "--json"]);
    const rows = json<AgentRow[]>(r);
    if (!rows) throw new Error(`ep0ch agent ls --json: ${firstLine(r.err) || `exit ${r.code}`}`);
    return rows;
  };
  const agent = async () => {
    const r = (await agents()).find(x => x.sessionId === arg);
    if (!r) throw new Error(`no session ${arg.slice(0, 8)} now (ep0ch agent ls lists what runs)`);
    return r;
  };
  switch (verb) {
    case "agents": for (const l of agentRows(await agents())) say(l); return;
    case "agent-preview": {
      const r = await agent(), t = transcriptOf(r.sessionId);
      say(agentPreview(r, t ? newestMessages(readFileSync(t, "utf8")) : [])); return;
    }
    case "agent-open": case "agent-restart": case "agent-stop": {
      const r = await agent(), cmd = agentCommand(r, verb.slice(6) as "open" | "restart" | "stop");
      if ("refused" in cmd) { console.error(cmd.refused); return pause(); }
      const ran = cmd.door ? await ep0ch(cmd.argv, { timeoutMs: 120_000 }) : await realExec(cmd.argv, { timeoutMs: 60_000 });
      console.error(ran.code === 0 ? `${verb.slice(6)}: ${r.name || r.id} · ${firstLine(ran.out) || "done"}` : `ep0ch-tv: ${firstLine(ran.err) || firstLine(ran.out) || `exit ${ran.code}`}`);
      return pause();
    }
    case "health": {
      const [doc, links, here, main] = await Promise.all([
        ep0ch(["doctor", "--json"], { timeoutMs: 90_000 }), ep0ch(["link", "status", "--json"]), ep0ch(["session", "list", "--json"]),
        realExec(["git", "-C", repo, "rev-parse", "origin/main"]),
      ]);
      const l = json<LinkJson>(links);
      const far = await Promise.all((l?.links ?? []).filter(x => x.up).map(async x => {
        const r = await ep0ch(["session", "list", "--machine", x.machine, "--json"], { timeoutMs: 20_000 });
        return { machine: x.machine, rows: json<SessionJson[]>(r), error: firstLine(r.err) };
      }));
      const rows = healthRows({ doctor: json<DoctorJson>(doc), doctorError: firstLine(doc.err), links: l, sessions: [{ machine: "here", rows: json<SessionJson[]>(here), error: firstLine(here.err) }, ...far], main: main.code === 0 ? main.out.trim() : null });
      writeFileSync(healthCache(), JSON.stringify(rows), { mode: 0o600 });
      for (const x of healthLines(rows)) say(x);
      return;
    }
    case "health-preview": case "health-fix": {
      let rows: HealthRow[] = [];
      try { rows = JSON.parse(readFileSync(healthCache(), "utf8")); } catch { /* listed by another tv */ }
      const r = rows.find(x => x.key === arg);
      if (!r) { say(`no check ${arg} in the last list: ctrl-r reloads the channel`); return; }
      if (verb === "health-preview") { say(healthPreview(r)); return; }
      if (!r.fix) { console.error(`${r.group} · ${r.name}: nothing to run`); return pause(); }
      console.error(`running: ${r.fix}`);
      const p = Bun.spawn(["sh", "-c", r.fix], { stdio: ["inherit", "inherit", "inherit"] });
      console.error(`exit ${await p.exited}`);
      return pause();
    }
    case "board": {
      const r = await ep0ch(["find", "--query", arg, "--property-scope", "all", "--json"], { timeoutMs: 60_000 });
      const notes = json<FoundNote[]>(r);
      if (!notes) { console.error(`ep0ch find: ${firstLine(r.err) || `exit ${r.code}`}`); process.exit(1); }
      for (const x of boardRows(notes)) say(x);
      return;
    }
    case "prs": {
      const r = await realExec(["gh", "pr", "list", "--json", "number,title,headRefName,isDraft,author,updatedAt"], { cwd: repo });
      const prs = json<Pr[]>(r);
      if (!prs) { console.error(`gh pr list: ${firstLine(r.err) || `exit ${r.code}`}`); process.exit(1); }
      for (const x of prRows(prs)) say(x);
      return;
    }
    case "board-preview": case "board-open": {
      let target = arg;
      if (arg.startsWith("pr-")) {
        const n = arg.slice(3);
        if (verb === "board-preview") { const r = await realExec(["gh", "pr", "view", n], { cwd: repo }); say(r.out || r.err); return; }
        const pr = json<{ title: string; headRefName: string; body: string }>(await realExec(["gh", "pr", "view", n, "--json", "title,headRefName,body"], { cwd: repo }));
        const t = pr && prTicket(pr);
        if (!t) { console.error(`PR #${n} names no PIE-n ticket to open`); return pause(); }
        target = t;
      }
      if (verb === "board-preview") { const r = await ep0ch(["show", target, "--ansi", "--width", String(panelWidth())]); say(r.out || r.err); return; }
      const r = await ep0ch(["open", target, "--as", "television"]);
      console.error(r.code === 0 ? `opened ${target} in the door` : `ep0ch-tv: ${firstLine(r.err) || firstLine(r.out)}`);
      return r.code === 0 ? undefined : pause();
    }
    case "herdr": {
      const s = json<{ sessions: { name: string; running: boolean }[] }>(await realExec(["herdr", "session", "list", "--json"]));
      for (const x of s?.sessions ?? []) if (x.running) {
        const snap = json<{ result?: { snapshot?: HerdrSnapshot } }>(await realExec(["herdr", "--session", x.name, "api", "snapshot"], { timeoutMs: 10_000 }));
        for (const l of paneLines(herdrPanes(x.name, snap?.result?.snapshot ?? {}))) say(l);
      }
      return;
    }
    case "pane-preview": case "pane-focus": case "pane-attach": {
      const [session, pane] = arg.split("~") as [string, string];
      if (verb === "pane-preview") { const r = await realExec(["herdr", "--session", session, "pane", "read", pane, "--source", "visible", "--format", "ansi"], { timeoutMs: 10_000 }); say(r.code === 0 ? paneScreen(r.out) : r.err); return; }
      if (verb === "pane-attach") { const p = Bun.spawn(["herdr", "session", "attach", session], { stdio: ["inherit", "inherit", "inherit"] }); await p.exited; return; }
      const snap = json<{ result?: { snapshot?: HerdrSnapshot } }>(await realExec(["herdr", "--session", session, "api", "snapshot"]));
      const p = herdrPanes(session, snap?.result?.snapshot ?? {}).find(x => x.pane === pane);
      if (!p) { console.error(`no pane ${pane} in herdr session ${session} now`); return pause(); }
      const r = await realExec(["herdr", "--session", session, "tab", "focus", p.tab]);
      console.error(r.code === 0 ? `focused ${p.where} in herdr session ${session}` : `herdr: ${firstLine(r.err)}`);
      return r.code === 0 ? undefined : pause();
    }
    default:
      console.error("ep0ch-tv: rows.ts verbs: agents, agent-preview|open|restart|stop <session>, health, health-preview|fix <key>, board <query>, prs, board-preview|open <id|pr-n>, herdr, pane-preview|focus|attach <session~pane>");
      process.exit(2);
  }
}

/** A pane's screen as tv's preview draws it: no carriage returns (tv's preview drops a line holding one), no blank tail. */
export const paneScreen = (ansi: string) => ansi.replaceAll("\r", "").replace(/(\s|\x1b\[0m)+$/, "") + "\n";

/** tv's preview panel in columns (ep0ch-tv's `panel`): its share of the terminal, less its border. */
function panelWidth(): number {
  const cols = Number(process.env.COLUMNS) || 120;
  return Math.max(20, Math.floor(cols * Number(process.env.EP0CH_TV_PREVIEW || 60) / 100) - 6);
}
/** An action's words stay on screen a moment before tv comes back. */
const pause = () => Bun.sleep(Number(process.env.EP0CH_TV_PAUSE ?? 2000));

if (import.meta.main) main(process.argv.slice(2)).catch(e => { console.error(`ep0ch-tv: ${(e as Error).message}`); process.exit(1); });
