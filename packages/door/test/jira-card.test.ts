// PIE-1796: Evan has a Jira card open, the ticket changes in Jira, and within one poll the card shows the new content,
// with no reopen and no flash. A real tmux pane over a scratch host with the Jira extension against a fake Jira (the
// outliner's test/fake-jira.ts, polling every 1.5 s). Every ticket, name and site is made up.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { outliner, until } from "./scratch";
import { cellOf, TallyDoors, type Pane } from "./tally-pane";
import { FAKE_TOKEN, installJira, startFakeJira, type FakeJira } from "../../outliner/test/fake-jira";

const TOKEN_ENV = "EP0CH_FAKE_JIRA_TOKEN_CARD";
type Tile = { tile: string; name: string; showing?: { id: string; title: string } };
const tiles = (p: Pane) => (JSON.parse(p.act("layout.get").out).layers as { drawer: boolean; tiles: Tile[] }[]).find(l => !l.drawer)!.tiles;

describe.skipIf(!outliner || !Bun.which("tmux"))("an open Jira card follows its ticket (PIE-1796)", () => {
  const doors = new TallyDoors();
  let fake: FakeJira;
  beforeAll(async () => {
    fake = startFakeJira([{ id: "20001", key: "PC-1", summary: "Rollout checklist for the depot switch", status: "In Review", assignee: "Dana Ortiz", type: "Task", priority: "High", updated: "2026-01-05T09:00:00.000Z" }]);
    await installJira(join(doors.scratch.workspace, "extensions"), fake.origin, TOKEN_ENV);
    doors.scratch.hostEnv = { [TOKEN_ENV]: FAKE_TOKEN, OUTLINER_EXTENSION_POLL_MS: "1500" };
    await doors.start();
  }, 60_000);
  afterAll(async () => { await doors.stop(); fake?.stop(); });

  /** A note naming PC-1 only on a list item (Evan's form: no ticket block), and the pane on it. */
  async function bulleted() {
    const id = await doors.create("PC-1 Rollout [jira::PC-1]\nOur plan.");
    await until(() => fake.requests.length > 0, "the first read", 10_000);
    await Bun.sleep(1500);
    const m = await doors.board.get(id);
    await doors.board.update(id, "PC-1 Rollout\nOur plan.\n\n- [jira::PC-1]", m!.revision!);
    return doors.pane(id, "PC-1 Rollout", 120, 30);
  }

  test("the Resource note open on screen shows the ticket's new read within one poll, with no reopen and no placeholder frame", async () => {
    const p = await bulleted();
    try {
      const at = cellOf(p.capture(), "jira::PC-1")!;
      p.click(at); await Bun.sleep(300); p.click(at);
      await until(() => tiles(p).some(t => t.showing?.id.startsWith("resource:")), "the ticket's Resource note open", 8000);
      await until(() => p.capture().includes("status In Review"), "its fields");
      const raw = join(doors.scratch.root, "card.raw"); p.record(raw);
      const issue = fake.issues.get("PC-1")!;
      issue.summary = "Rollout checklist, second depot"; issue.status = "Done"; issue.updated = new Date().toISOString();
      await until(() => p.capture().includes("status Done"), "the new read on screen, no reopen", 8000).catch(e => { throw new Error(`${e.message}\n${p.capture().split("\n").slice(0, 12).join("\n")}`); });
      expect(p.capture()).toContain("second depot");
      // Every byte the door wrote meanwhile: no placeholder text was ever drawn on the way.
      const written = readFileSync(raw, "utf8").replace(/\x1b\[[0-9;?]*[A-Za-z]/g, " ");
      for (const placeholder of ["fetching…", "can't fetch", "isn't there", "Waiting", "not fetched"]) expect([placeholder, written.includes(placeholder)]).toEqual([placeholder, false]);
    } finally { p.close(); }
  }, 90_000);

  /** A note naming PC-1 on its title line (a ticket block, its card under the note), and the pane on it. */
  async function carded(title: string) {
    const id = await doors.create(`${title} [jira::PC-1]\nOur plan.`);
    const p = await doors.pane(id, title, 120, 30);
    await until(() => p.capture().includes("Jira PC-1"), "the card", 15_000);
    return { id, p };
  }
  /** The card's copy read two hours ago, as one is on a note Evan opens again after a while (Jira's stale age is 15 minutes). */
  function readLongAgo() {
    const db = new Database(join(doors.scratch.outlines, `${doors.scratch.name}.sqlite`));   // <name>.sqlite beside its folder
    db.exec("PRAGMA busy_timeout = 5000");
    db.query("UPDATE remote_entity_resource_state SET checked_at = ?").run(new Date(Date.now() - 2 * 60 * 60_000).toISOString());
    db.close();
  }

  test("opening a note whose card copy is old refreshes it quietly: the card keeps its fields and age, no \"fetching…\" frame", async () => {
    const { id, p } = await carded("Depot rota");
    try {
      readLongAgo();
      fake.delayMs = 800;   // a read slow enough that a placeholder would be drawn
      const raw = join(doors.scratch.root, "reopen.raw"); p.record(raw);
      const before = fake.requests.length;
      fake.issues.get("PC-1")!.status = "Blocked"; fake.issues.get("PC-1")!.updated = new Date().toISOString();
      expect(p.act("open", `id=${id}`).ok).toBe(true);
      await until(() => p.capture().includes("Blocked"), "the refreshed fields", 10_000).catch(e => { throw new Error(`${e.message}: ${fake.requests.length - before} requests\n${p.capture().split("\n").slice(4, 12).join("\n")}`); });
      const written = readFileSync(raw, "utf8").replace(/\x1b\[[0-9;?]*[A-Za-z]/g, " ");
      expect(written.includes("fetching…")).toBe(false);
    } finally { fake.delayMs = 0; p.close(); }
  }, 90_000);

  // The flash (recorded byte by byte before any fix): while Jira refuses a ticket, its card strobed, "fetching…" and the
  // yellow "can't fetch: …" in turn several times a second, each failure's event asking for the read that fetched again.
  test("a failed fetch is said once and stays: the last good fields, what failed and when it tries again, no strobe", async () => {
    const { p } = await carded("Depot keys");
    try {
      const fields = p.capture().split("\n").find(l => l.includes("· Dana Ortiz ·"))!.replace(/[║▌│]/g, "").trim();
      fake.status = 500;
      p.keys("R");   // the card's refresh
      await until(() => p.capture().includes("couldn't fetch") || p.capture().includes("can't fetch"), "the failure said", 10_000);
      const raw = join(doors.scratch.root, "fail.raw"); p.record(raw);
      const asked = fake.requests.length;
      await Bun.sleep(3000);
      const written = readFileSync(raw, "utf8").replace(/\x1b\[[0-9;?]*[A-Za-z]/g, " ");
      expect(written.split("fetching…").length - 1).toBe(0);   // nothing redrawn as fetching once it failed
      expect(fake.requests.slice(asked).filter(r => r.includes("/issue/"))).toEqual([]);   // nor read it again: the poll's search or r will
      const card = p.capture();
      const now = card.split("\n").find(l => l.includes("· Dana Ortiz ·"))!.replace(/[║▌│]/g, "").trim();
      expect(now.split(" · ").sort()).toEqual(fields.split(" · ").sort());   // the last good fields stay
      expect(card).toContain("kept the copy from");
      expect(card).toContain("couldn't fetch");
      expect(card).toContain("poll tries again");   // wrapped: "the next / poll tries again, R now"
    } finally { fake.status = null; p.close(); }
  }, 90_000);
});

