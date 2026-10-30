// PIE-1462: a person's press of a script is recorded as the person, with the script as how; an agent's press of the same
// line stays the agent's. Pressed through the door's one `button.press`, read back from the note's revisions (what
// `ep0ch revisions` prints) and the change feed; ctrl+z (`ext.undo`, which asks the service's `extensions.undo`) takes the person's press back. Made-up notes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { revisionByline } from "@ep0ch/outline-core/attribution";
import { App } from "../src/app";
import { openScreen } from "../src/desk/screen-specs";
import { SocketBoard, USER } from "../src/socket";
import type { Key } from "../src/term";
import { Scratch, outliner } from "./scratch";

describe.skipIf(!outliner)("who a pressed script's write is recorded as (PIE-1462)", () => {
  const scratch = new Scratch();
  const savedAgent = process.env.EP0CH_DAILY_AGENT, savedState = process.env.EP0CH_STATE;
  const size = { cols: 120, rows: 40, cellW: 9, cellH: 16, kitty: true };
  let board: SocketBoard, app: App;
  const over = new Set<string>();
  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    process.env.EP0CH_DAILY_AGENT = "cat";
    board = new SocketBoard(await scratch.start());
    await board.info();
    app = new App({ info: size, write() {}, paint() {}, paintRow() {}, invalidate() {}, onKey(_f: (k: Key) => void) {}, onResize() {}, stop() {}, resume() {} }, board, Date.now(), () => {});
    board.subscribe(e => { app.event(e); const ended = (e as { ended?: { run: string } }).ended; if (ended) over.add(ended.run); });
    await board.installExtension("lens");
    await app.loadExtensions();
    app.push(openScreen("desk")!);
  }, 60_000);
  afterAll(async () => {
    app?.quit(); app?.drawer.tile?.kill(); board?.close(); await scratch.dispose();
    if (savedState === undefined) delete process.env.EP0CH_STATE; else process.env.EP0CH_STATE = savedState;
    if (savedAgent === undefined) delete process.env.EP0CH_DAILY_AGENT; else process.env.EP0CH_DAILY_AGENT = savedAgent;
  });

  const stageOf = async (id: string) => /\[stage::(\w*)\]/.exec((await board.get(id))!.text)?.[1];
  /** Waits for the stage to read `want` (a script run ends on its own clock). */
  const stageIs = async (id: string, want: string) => {
    for (let i = 0; i < 100 && (await stageOf(id)) !== want; i++) await Bun.sleep(50);
    expect(await stageOf(id)).toBe(want);
  };

  test("the person's press says 'by you' (the script as how) and ctrl+z undoes it; an agent's press stays the agent's", async () => {
    const job = await board.createBlock(null, "Fix the gate latch [type::job] [stage::todo]");
    const doing = await board.createBlock(null, `Jobs\n::button{label="Step" act="lens-set note=${job.id} key=stage next=1 choices=todo|doing|done"}`);

    // The person presses it.
    const before = (await board.revisions(job.id)).revision;
    const run = await app.dispatch.act({ action: "button.press", args: { note: doing.id, label: "Step" } }, USER) as { undo: string };
    await stageIs(job.id, "doing");
    const entry = (await board.revisions(job.id)).revisions.find(r => r.revision === before + 1)!;
    expect(entry).toMatchObject({ author: "user" });
    expect(entry!.actorId).toBeUndefined();
    expect(revisionByline(entry!)).toBe("by you · via script");
    const feed = (await board.request<any>("changes.since", { sequence: 0, limit: 500 })).changes as any[];
    const change = feed.find(c => c.blockId === job.id && c.revision === before + 1);
    expect(change).toMatchObject({ actor: { author: "user" }, requestedBy: { author: "user" } });

    // ctrl+z takes the person's press back (once the run has ended: the service refuses an undo of a running one).
    for (let i = 0; i < 100 && !over.has(run.undo); i++) await Bun.sleep(50);
    await board.undoExtension(run.undo, USER);
    await stageIs(job.id, "todo");

    // An agent's press of the same button through act: the agent's, by its own id.
    const next = (await board.revisions(job.id)).revision;
    await app.act({ action: "button.press", args: { note: doing.id, label: "Step" }, as: "kitty-press" });
    await stageIs(job.id, "doing");
    const agent = (await board.revisions(job.id)).revisions.find(r => r.revision > next && r.author === "agent")!;
    expect(agent).toMatchObject({ author: "agent", actorId: "kitty-press" });
    expect(revisionByline(agent)).toBe("by kitty-press · via script");
  }, 60_000);
});
