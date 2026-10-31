import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { startControl } from "../src/control";
import { Desk } from "../src/desk/desk";
import { Mirror } from "../src/mirror";
import { traceRequests, type RunRequest } from "../src/surface/dispatch";
import { useShowcaseScreen } from "./showcase/harness";
import { messageContext } from "../src/status-log";
import { until } from "./scratch";

describe("one open has one landing owner (PIE-1377)", () => {
  const h = useShowcaseScreen();
  let control: Awaited<ReturnType<typeof startControl>>;
  beforeAll(async () => {
    control = await startControl({ app: h.app, mirror: new Mirror(200, 60), info: () => ({ cols: 200, rows: 60, cellW: 9, cellH: 16, kitty: false }) }, join(h.scratch.root, "trace.sock"));
  });
  afterAll(() => control?.close());

  async function cli(...args: string[]) {
    const p = Bun.spawn(["bun", join(import.meta.dir, "../src/main.ts"), ...args], {
      cwd: h.scratch.workspace, stdout: "pipe", stderr: "pipe",
      env: { ...process.env, ...h.scratch.env, EP0CH_CONTROL: control.path, EP0CH_PLACE: "" },
    });
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    expect({ code, err }).toEqual({ code: 0, err: "" });
    return JSON.parse(out);
  }

  test("the CLI reports the dispatched open, its one landing and the running revision", async () => {
    const desk = new Desk({ name: "garden", title: "Garden", layout: { root: { t: "split", dir: "row", ratio: 0.5,
      a: { t: "leaf", kind: "reader", name: "source" }, b: { t: "leaf", kind: "reader", name: "letters" },
    } } });
    h.app.push(desk);
    const note = await h.board.createBlock(null, "Letters from the allotment\nBring broad beans.");
    await cli("act", "tile.link", "tile=source", "to=letters", "--as", "garden-helper");
    const requests: RunRequest[] = [];
    const traced: (string | undefined)[] = [];
    const stop = traceRequests(r => { requests.push(r); if (r.action === "open") traced.push(messageContext.getStore()?.trace); });
    try {
      const on = await cli("trace", "on", "--json");
      expect(on.rev).toMatch(/^[a-f0-9]{40}$/);
      const opened = await cli("act", "open", `id=${note.id}`, "from=source", "--as", "garden-helper");
      const shown = await cli("trace", "show", "open", "--last", "1", "--json");
      expect(shown.runs).toHaveLength(1);
      const run = shown.runs[0];
      expect(run).toMatchObject({ action: "open", rev: on.rev, pid: process.pid });
      expect(requests.filter(r => r.action === "open")).toHaveLength(1);
      expect(run.rows.filter((r: { probe: string | null }) => r.probe).map((r: { probe: string }) => r.probe)).toEqual(["open.plan", "open.land"]);
      expect(run.rows.at(-1).tile).toBe(opened.tile);
      expect((await cli("act", "tile.info", `tile=${opened.tile}`, "--as", "garden-helper")).showing.id).toBe(note.id);
      expect(run.rows.every((r: { trace: string; rev: string }) => r.trace === run.trace && r.rev === on.rev)).toBe(true);
      expect(traced).toEqual([run.trace]);
      const next = await h.board.createBlock(null, "The next letter\nPeas are ready.");
      h.press({ kind: "char", ch: "k", ctrl: true });
      h.press({ kind: "paste", text: `open id=${next.id} from=source` });
      h.press({ kind: "enter" });
      await until(() => desk.layoutGet().tiles.some(t => t.showing?.id === next.id), "the keyboard open landing");
      const keyed = (await cli("trace", "show", "open", "--last", "2", "--json")).runs;
      expect(keyed.map((r: { trace: string }) => r.trace)).toEqual(traced);
      expect(keyed[1].rows.filter((r: { probe: string }) => r.probe === "open.land")).toHaveLength(1);
      h.press({ kind: "esc" });
      await cli("trace", "off", "--json");
      await h.app.dispatch.press("open", { id: note.id, from: "source" });
      expect((await cli("trace", "show", "open", "--last", "1", "--json")).runs[0].trace).toBe(keyed[1].trace);
    } finally { stop(); }
  }, 30_000);

  test("Ctrl+Z after a power-bar run reaches layout undo and leaves line undo alone", async () => {
    const desk = new Desk({ name: "seeds", title: "Seeds", layout: { root: { t: "leaf", kind: "reader", name: "reader" } } });
    h.app.push(desk);
    await cli("trace", "on", "--json");
    try {
      h.press({ kind: "char", ch: "k", ctrl: true });
      h.press({ kind: "paste", text: "tile.open kind=reader name=seedling where=right" });
      h.press({ kind: "enter" });
      await until(() => desk.layoutGet().tiles.some(t => t.name === "seedling"), "the power-bar run");
      // Wait for the kept answer, which makes takesBackRun hand Ctrl+Z to App.route.
      await until(() => (h.app.describe() as any).bar?.runs?.at(-1)?.line === "tile.open kind=reader name=seedling where=right", "the kept answer");
      h.press({ kind: "char", ch: "z", ctrl: true });
      await until(() => !desk.layoutGet().tiles.some(t => t.name === "seedling"), "the run undone");
      const shown = await cli("trace", "show", "--json");
      const hits = shown.runs.flatMap((r: { rows: { probe: string }[] }) => r.rows.map(row => row.probe));
      expect(hits).toContain("bar.run");
      expect(hits).toContain("layout.undo");
      expect(hits).not.toContain("bar.edit.undo");
    } finally { await cli("trace", "off", "--json"); }
  }, 30_000);

  test("an edit of an ask and a reply from another writer name both handlers, once", async () => {
    const note = await h.board.createBlock(null, "The seed order\nBroad beans first.");
    const ask = await h.board.comment(crypto.randomUUID(), note.id, note.revision!, "@fern explain the seed order", null);
    const first = { kind: "agent", id: "first-gardener" } as const;
    const second = { kind: "agent", id: "second-gardener" } as const;
    const comment = (await h.board.comments(note.id))[0]!;
    await h.board.updateComment(ask.id, comment.revision!, "@fern explain the seed order\nAn answer written into the ask.", first);
    await h.board.reply(crypto.randomUUID(), ask.id, "A second answer.", second);
    await h.board.reply(crypto.randomUUID(), ask.id, "The same handler continues.", second);
    const shown = await cli("trace", "show", "--json");
    expect(shown.service.findings.find((f: { ask: string }) => f.ask === ask.id)).toMatchObject({
      handlers: ["first-gardener", "second-gardener"],
    });
  }, 30_000);

  test("the file keeps whole recent runs, including actions that reached no probe", async () => {
    const on = await cli("trace", "on", "--json");
    try {
      const ids: string[] = [];
      const stop = traceRequests(r => { if (r.action === "screen.list") ids.push(messageContext.getStore()!.trace!); });
      try {
        for (let i = 0; i < 105; i++) await h.app.act({ action: "screen.list", as: "garden-helper" });
      } finally { stop(); }
      const shown = await cli("trace", "show", "screen.list", "--last", "200", "--json");
      expect(shown.runs.map((r: { trace: string }) => r.trace)).toEqual(ids.slice(-100));
      expect(shown.runs.every((r: { rev: string; rows: { probe: string | null }[] }) => r.rev === on.rev && r.rows.length === 1 && r.rows[0]!.probe === null)).toBe(true);
      const disk = readFileSync(on.path, "utf8").trim().split("\n").map(line => JSON.parse(line));
      expect([...new Set(disk.map(r => r.trace))]).toEqual(ids.slice(-100));
    } finally { await cli("trace", "off", "--json"); }
  }, 30_000);
});
