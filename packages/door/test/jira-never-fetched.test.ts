// PIE-1801: Evan opens a Jira card for a ticket that has never fetched, and it tells him what failed, whether it's still
// trying, and that R retries now; every message about one fetch uses the same words. A real tmux pane over a scratch host
// with the Jira extension against the fake Jira (the outliner's test/fake-jira.ts, polling every 1.5 s). Made up.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { outliner, until } from "./scratch";
import { TallyDoors } from "./tally-pane";
import { FAKE_TOKEN, installJira, startFakeJira, type FakeJira } from "../../outliner/test/fake-jira";

const TOKEN_ENV = "EP0CH_FAKE_JIRA_TOKEN_NEVER";
const card = (frame: string) => frame.split("\n").filter(l => l.includes("▌")).map(l => l.replace(/[║▌]/g, "").trim()).join(" ").replace(/\s+/g, " ");

describe.skipIf(!outliner || !Bun.which("tmux"))("a ticket that never fetched says why and when it tries again (PIE-1801)", () => {
  const doors = new TallyDoors();
  let fake: FakeJira;
  beforeAll(async () => {
    fake = startFakeJira([{ id: "20002", key: "PC-2", summary: "Label printer drops the last line", status: "To Do", assignee: "Lee Park", type: "Bug", priority: "Medium", updated: "2026-01-05T09:00:00.000Z" }]);
    await installJira(join(doors.scratch.workspace, "extensions"), fake.origin, TOKEN_ENV);
    doors.scratch.hostEnv = { [TOKEN_ENV]: FAKE_TOKEN, OUTLINER_EXTENSION_POLL_MS: "1500" };
    await doors.start();
  }, 60_000);
  afterAll(async () => { await doors.stop(); fake?.stop(); });

  test("a ticket Jira doesn't have says so plainly, R tries again, and the poll stops asking", async () => {
    const id = await doors.create("Ghost ticket [jira::PC-9]\nIt was never there.");
    const p = await doors.pane(id, "Ghost ticket", 120, 30);
    try {
      await until(() => card(p.capture()).includes("PC-9"), "the card", 10_000);
      await until(() => card(p.capture()).includes("Jira has no PC-9"), "said plainly", 8000).catch(e => { throw new Error(`${e.message}: ${card(p.capture())}`); });
      expect(card(p.capture())).toContain("R tries again");
      expect(card(p.capture())).not.toContain("next poll");
      const asked = fake.requests.length;
      await Bun.sleep(4000);   // two polls and more
      expect(fake.requests.slice(asked).filter(r => r.includes("PC-9"))).toEqual([]);
    } finally { p.close(); }
  }, 60_000);

  test("a ticket whose first fetch failed says what failed and that the poll tries again, and the poll does", async () => {
    fake.status = 500;
    const id = await doors.create("Printer [jira::PC-2]\nSecond shift.");
    const p = await doors.pane(id, "Printer", 120, 30);
    try {
      await until(() => card(p.capture()).includes("couldn't fetch"), "the failure said", 10_000).catch(e => { throw new Error(`${e.message}: ${card(p.capture())}`); });
      expect(card(p.capture())).toContain("couldn't fetch: provider request failed");
      expect(card(p.capture())).toContain("the next poll tries again, R now");
      fake.status = null;
      await until(() => p.capture().includes("Label printer drops"), "fetched by the poll, no reopen", 10_000).catch(e => { throw new Error(`${e.message}: ${card(p.capture())}`); });
    } finally { fake.status = null; p.close(); }
  }, 60_000);

  test("R on a failing card says it in the card's words", async () => {
    const id = await doors.create("Dock keys [jira::PC-2]\nSpare set.");
    const p = await doors.pane(id, "Dock keys", 120, 30);
    try {
      await until(() => p.capture().includes("Label printer drops"), "the card", 10_000);
      fake.status = 500;
      p.keys("R");
      await until(() => /(couldn.t|can.t) fetch/.test(p.capture().split("\n").slice(-2).join(" ")), "the toast", 8000);
      const bar = p.capture().split("\n").slice(-2).join(" ");
      expect(bar).toContain("couldn't fetch");
      expect(bar).not.toContain("can't fetch");
    } finally { fake.status = null; p.close(); }
  }, 60_000);
});
