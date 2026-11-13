// PIE-1796: Evan has a Jira card open, the ticket changes in Jira, and within one poll the card shows the new content,
// with no reopen and no flash. A real tmux pane over a scratch host with the Jira extension against a fake Jira (the
// outliner's test/fake-jira.ts, polling every 1.5 s). Every ticket, name and site is made up.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
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
});
