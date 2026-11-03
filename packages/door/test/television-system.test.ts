// The television extension's system channels (PIE-1535): ep0ch-agents, ep0ch-health, ep0ch-board and herdr. Each row
// comes from a command's JSON (made up here, through a fake door), its key out of view and taken back by the channel's
// own template; an action reads its row again by that key. And doctor's machine checks those rows include.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentCommand, agentStatus, healthRows, herdrPanes, newestMessages, prMarkdown, prTicket, runnable, type AgentRow } from "../ext/television/lib/rows";
import { machineChecks, type MachineHealth } from "../src/setup/machine-health";

const EXT = join(import.meta.dir, "../ext/television");
const TV = join(EXT, "bin/ep0ch-tv");
const shown = (l: string) => l.replace(/\x1b\][^\x1b]*\x1b\\/g, "").replace(/\x1b\[[0-9;]*m/g, "");
/** The key as a cable file's own output template takes it (tv's replace, a Rust regex the JS one reads the same). */
function keyOf(cable: string): (line: string) => string {
  const t = /^output = "(?:\(\()?\{replace:s\/(.+)\/\$1\/\}/m.exec(readFileSync(join(EXT, "cable", cable), "utf8"))![1]!;
  const re = new RegExp(t.replaceAll("\\\\", "\\"));
  return l => l.replace(re, "$1");
}

const agent = (o: Partial<AgentRow>): AgentRow => ({ name: "wren", id: "1a2b3c4d", sessionId: "1a2b3c4d-0000-4000-8000-000000000001", kind: "background", status: "busy", state: "working", cwd: "/work/wt-seeds", place: null, pid: 4242, startedAt: 1, lastWrite: 1, ...o });

let dir = "";
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "ep0ch-tv-sys-")); });
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** ep0ch-tv against a fake door that answers each command (its argv joined) from `answers`. */
async function tv(args: string[], answers: Record<string, string>) {
  const main = join(dir, "main.ts");
  await Bun.write(main, "const a = JSON.parse(process.env.FAKE_ANSWERS!); const k = process.argv.slice(2).join(' '); if (k in a) process.stdout.write(a[k]); else { process.stderr.write('no answer for ' + k); process.exit(1); }\n");
  const p = Bun.spawn([TV, ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env, EP0CH_DOOR_MAIN: main, FAKE_ANSWERS: JSON.stringify(answers), TMPDIR: dir, EP0CH_TV_PAUSE: "0" } });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { out, err, code, lines: out.split("\n").filter(Boolean) };
}

describe("ep0ch-agents", () => {
  const rows = [agent({}), agent({ name: "moss", id: "5e6f7a8b", sessionId: "5e6f7a8b-0000-4000-8000-000000000002", kind: "interactive", status: "waiting", state: null, waitingFor: "dialog open", place: "Herdr pane" })];
  test("each session shows what it's doing in claude's words, blocked with why; the session id comes back whole", async () => {
    const r = await tv(["agents"], { "agent ls --json": JSON.stringify(rows) });
    expect(r.code).toBe(0);
    expect(r.lines.map(keyOf("ep0ch-agents.toml"))).toEqual(rows.map(x => x.sessionId));
    expect(shown(r.lines[0]!)).toMatch(/^working\s+wren\s+bg · wt-seeds/);
    expect(shown(r.lines[1]!)).toMatch(/^blocked: dialog open\s+moss\s+tty · Herdr pane/);
  });
  test("the actions: a background job opens in a door tile, restarts and stops; a terminal's session says where it runs", () => {
    expect(agentCommand(rows[0]!, "open")).toEqual({ argv: ["act", "tile.open", "kind=pty", "cmd=claude attach 1a2b3c4d", "name=attach-1a2b3c4d", "--as", "television"], door: true });
    expect(agentCommand(rows[0]!, "restart")).toEqual({ argv: ["agent", "restart", "1a2b3c4d"], door: true });
    expect(agentCommand(rows[0]!, "stop")).toEqual({ argv: ["claude", "stop", "1a2b3c4d"] });
    for (const what of ["open", "restart", "stop"] as const) expect(agentCommand(rows[1]!, what)).toEqual({ refused: expect.stringContaining("it runs in Herdr pane") });
    expect(agentStatus(agent({ status: "idle", state: "done" })).word).toBe("done");
  });
  test("a finished job claude still calls waiting is done; blocked only with a reason claude gives", () => {
    expect(agentStatus(agent({ status: "waiting", state: "done" }))).toEqual({ word: "done", tone: "36" });
    expect(agentStatus(agent({ status: "waiting", state: null, waitingFor: null })).word).toBe("waiting");
    expect(agentStatus(agent({ status: "waiting", state: null, waitingFor: null })).tone).not.toBe("31;1");
    expect(agentStatus(agent({ status: "waiting", state: null, waitingFor: "permission prompt" }))).toEqual({ word: "blocked: permission prompt", tone: "31;1" });
  });
  test("the preview's messages are the transcript's newest, text only, oldest first", () => {
    const jsonl = [
      { type: "user", message: { content: "plant the beans" } },
      { type: "assistant", message: { content: [{ type: "tool_use" }, { type: "text", text: "Beans are in row 3." }] } },
      { type: "system" },
      { type: "user", message: { content: [{ type: "tool_result" }] } },
    ].map(x => JSON.stringify(x)).join("\n");
    expect(newestMessages(jsonl)).toEqual([{ who: "you", text: "plant the beans" }, { who: "claude", text: "Beans are in row 3." }]);
  });
  test("a key that isn't a key's letters is refused before any command sees it", async () => {
    for (const bad of ["x'; touch nope", "a b", ""]) {
      const r = await tv(["agent-stop", bad], {});
      expect([r.code, r.err]).toEqual([2, expect.stringContaining("isn't a row's key")]);
    }
  });
});

describe("ep0ch-health", () => {
  const doctor = { ok: false, checks: [
    { group: "bun", name: "bun", status: "ok", detail: "/opt/bun 1.4.2" },
    { group: "outlines", name: "host", status: "missing", detail: "nothing answers at /x/host.sock", fix: "systemctl --user start outliner-host.service" },
  ] };
  const answers = {
    "doctor --json": JSON.stringify(doctor),
    "link status --json": JSON.stringify({ links: [{ machine: "box-a", transport: "ssh", up: false, direction: "inbound" }] }),
    "session list --json": JSON.stringify([{ pid: 77, code: { dir: "/src/door", commit: "0000000000aaaa" }, place: { outline: "garden" }, clients: [{}] }]),
  };
  test("doctor's checks, the links and each session against main, worst first; the preview and the fix read the same row", async () => {
    const r = await tv(["health"], answers);
    expect(r.code).toBe(0);
    const keys = r.lines.map(keyOf("ep0ch-health.toml"));
    expect(keys[0]).toBe("outlines~host");
    expect(r.lines.map(l => shown(l).split(/\s+/).slice(0, 4).join(" "))).toEqual(expect.arrayContaining(["× missing outlines host", "! behind links box-a", "✓ ok bun bun"]));
    const pre = await tv(["health-preview", "outlines~host"], {});
    expect(shown(pre.out)).toContain("systemctl --user start outliner-host.service");
  });
  test("enter runs the fix of the row listed, read again by its key; a row with none runs nothing", async () => {
    const mark = join(dir, "fixed");
    const fixable = { ...answers, "doctor --json": JSON.stringify({ checks: [{ group: "seeds", name: "tray", status: "behind", detail: "dry", fix: `echo watered > ${mark}` }, { group: "bun", name: "bun", status: "ok", detail: "1.4" }] }) };
    expect((await tv(["health"], fixable)).code).toBe(0);
    const r = await tv(["health-fix", "seeds~tray"], {});
    expect(r.err).toContain(`running: echo watered > ${mark}`);
    expect(readFileSync(mark, "utf8")).toBe("watered\n");
    expect((await tv(["health-fix", "bun~bun"], {})).err).toContain("bun · bun: nothing to run");
  });
  test("a session's code is ok at main, behind with the install that moves it otherwise", () => {
    const rows = healthRows({ doctor: { checks: [] }, links: null, main: "0000000000aaaa", sessions: [
      { machine: "here", rows: [{ pid: 1, code: { commit: "0000000000aaaa" }, place: { outline: "garden" } }] },
      { machine: "box-a", rows: [{ pid: 2, code: { commit: "1111111111bbbb" }, place: { outline: "attic" } }] },
      { machine: "box-b", rows: null, error: "ssh: no route" },
    ] });
    expect(rows.map(r => [r.name, r.status, r.fix])).toEqual([
      ["attic (door on box-a)", "behind", "ssh box-a ep0ch install --apply"],
      ["box-b", "unknown", undefined],
      ["garden (door on here)", "ok", undefined],
    ]);
  });
  test("a machine whose doors come through another's link answers its doors record, not a list: each door is a row", async () => {
    const linked = { ...answers,
      "where --json": JSON.stringify({ elsewhere: [{ machine: "box-b", via: "box-a", doors: ["attic"] }] }),
      "session list --machine box-b --json": JSON.stringify({ machine: "box-b", via: "box-a", addresses: [], doors: [{ key: "attic", outline: "attic", idle: 1000, clients: 2, screen: "desk", control: "/x/attic.sock" }], at: 1 }),
    };
    const r = await tv(["health"], linked);
    expect([r.code, r.err]).toEqual([0, ""]);
    const row = r.lines.map(shown).find(l => l.includes("attic"));
    expect(row).toMatch(/·\s+info\s+sessions\s+attic \(door on box-b\)/);
    expect(row).toContain("2 attached · desk · through box-a's link");
  });
  test("enter runs a fix only when it is a whole command; prose and placeholders are shown to copy", () => {
    const which = (n: string) => ["ep0ch", "systemctl", "ln", "herdr"].includes(n);
    expect(runnable("ep0ch install --apply", which)).toBe(true);
    expect(runnable("systemctl --user restart seed-sync.service", which)).toBe(true);
    expect(runnable("herdr plugin unlink x && herdr plugin link /y --enabled", which)).toBe(true);
    expect(runnable("ep0ch agent ls; top -o %CPU (what's running)", which)).toBe(false);
    expect(runnable("export EP0CH_PACKS=<the folder with the packs>", which)).toBe(false);
    expect(runnable("first: name this machine for its backups (other machines mirror it)", which)).toBe(false);
    expect(runnable("update the plugin (ep0ch install --apply)", which)).toBe(false);
  });
  test("doctor that answers nothing readable is a row saying so, not an empty channel", () => {
    expect(healthRows({ doctor: null, doctorError: "boom", links: null, sessions: [], main: null })[0]).toMatchObject({ status: "missing", detail: expect.stringContaining("boom") });
  });
});

describe("doctor's machine checks", () => {
  const m = (o: Partial<MachineHealth>): MachineHealth => ({ failed: [], nightly: { file: "/s/nightly.tsv", none: true }, boxTest: { last: null, file: "/s/box-test.tsv", running: 0, slots: 2 }, load: { five: 1, cpus: 8 }, now: Date.parse("2026-03-02T12:00:00Z"), ...o });
  test("a failed unit, a red nightly, a busy machine: each behind with the command that looks closer or fixes it", () => {
    const c = machineChecks(m({
      failed: ["seed-sync.service"],
      nightly: { file: "/s/nightly.tsv", cols: ["2026-03-02T09:00:00Z", "abc123def456", "1", "1800s", "2", "/s/run.log"] },
      load: { five: 12.5, cpus: 8 },
    }));
    expect(c.map(x => [x.name, x.status, x.fix])).toEqual([
      ["user units", "behind", "systemctl --user restart seed-sync.service"],
      ["nightly", "behind", "tail -n 80 /s/run.log"],
      ["box-test", "info", undefined],
      ["load", "behind", "ep0ch agent ls"],
    ]);
    expect(c[1]!.detail).toContain("red (exit 1, 2 red files) 3h ago");
  });
  test("all quiet, and a nightly that stopped running", () => {
    const c = machineChecks(m({ nightly: { file: "/s/nightly.tsv", cols: ["2026-02-27T04:00:00Z", "abc123def456", "0", "1700s", "0", "/s/run.log"] }, boxTest: { last: { file: "/s/b.tsv", cols: ["2026-03-02T11:00:00Z", "abc123def456", "door", "box", "60s", "€0", "0", "float-box"] }, file: "/s/b.tsv", running: 1, slots: 2 } }));
    expect(c.map(x => x.status)).toEqual(["ok", "behind", "info", "ok"]);
    expect(c[2]!.detail).toBe("1 running of 2 slots; last: door at abc123def456 on float-box exit 0 60m ago, 60s");
  });
});

describe("herdr and the board", () => {
  test("a pane row says its session, workspace and tab, the agent herdr sees and its state; the key holds session and pane", () => {
    const rows = herdrPanes("main", {
      panes: [{ pane_id: "w1:p2", tab_id: "w1:t1", workspace_id: "w1", agent: "claude", agent_status: "blocked", cwd: "/work", terminal_title_stripped: "planting" }],
      tabs: [{ tab_id: "w1:t1", label: "2" }], workspaces: [{ workspace_id: "w1", label: "garden" }],
    });
    expect(rows).toEqual([{ key: "main~w1:p2", session: "main", pane: "w1:p2", tab: "w1:t1", workspace: "w1", where: "garden › 2", program: "claude", status: "blocked", title: "planting", cwd: "/work" }]);
  });
  test("a PR opens the ticket it names", () => {
    expect(prTicket({ title: "Seeds: sort by sow date", headRefName: "feat/pie-77-sow" })).toBe("PIE-77");
    expect(prTicket({ title: "tidy" })).toBeNull();
  });
});

describe("a PR's preview", () => {
  test("reads as Markdown: its title a heading, the facts a reviewer looks at, then its body", () => {
    const md = prMarkdown({ number: 7, title: "Lanterns light the path", state: "OPEN", isDraft: false, author: { login: "wren" }, headRefName: "feat/lanterns", additions: 12, deletions: 3, reviewDecision: "CHANGES_REQUESTED", url: "https://example.org/pull/7", body: "## Why\n- the path was dark\n" });
    expect(md.split("\n").slice(0, 3)).toEqual(["# #7 Lanterns light the path", "", "open · `feat/lanterns` · +12 −3 · changes requested · by wren  "]);
    expect(md).toContain("## Why\n- the path was dark");
    expect(prMarkdown({ number: 8, title: "t", state: "OPEN", isDraft: true, headRefName: "b", additions: 0, deletions: 0, url: "u", body: "" })).toContain("draft · `b`");
  });
});
