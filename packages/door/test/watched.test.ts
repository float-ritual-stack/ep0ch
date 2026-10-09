// The door's watched reads (src/watched.ts, ADR 0004): asked once, asked again only when the service says the answer
// changed, registered again after the connection was lost, and never asked on paint. A fake connection.
import { describe, expect, test } from "bun:test";
import { RETRY_MS, Watched } from "../src/watched";

function fake() {
  const asked: { action: string; params: any }[] = [];
  let generation = 0, value = "a";
  const source = {
    async request(action: string, params: any = {}): Promise<any> {
      asked.push({ action, params });
      return { generation: params.generation ?? (params.watch ? 0 : generation), value };
    },
  };
  return { source, asked, set(v: string, g: number) { value = v; generation = g; } };
}

describe("watched reads", () => {
  test("a read is asked once; a paint asks nothing; queries.changed asks again with its generation", async () => {
    const f = fake(), w = new Watched(f.source);
    let told = 0;
    w.listen(() => told++);
    expect(w.read("blocks.query", { query: { where: "x" } }, (r: any) => r.value).state).toBe("loading");
    await w.settled();
    expect(w.read("blocks.query", { query: { where: "x" } }, (r: any) => r.value)).toEqual({ state: "ready", value: "a" });
    for (let i = 0; i < 5; i++) w.read("blocks.query", { query: { where: "x" } }, (r: any) => r.value);
    expect(f.asked.length).toBe(1);
    const key = f.asked[0]!.params.watch;
    f.set("b", 1);
    w.changed([{ key, generation: 1 }]);
    await w.settled();
    expect(f.asked.at(-1)!.params).toMatchObject({ watch: key, generation: 1 });
    expect(w.read("blocks.query", { query: { where: "x" } }, (r: any) => r.value).value).toBe("b");
    expect(told).toBe(2);
    // An old generation, or one already had, asks nothing.
    w.changed([{ key, generation: 1 }]);
    expect(f.asked.length).toBe(2);
  });

  test("after the connection is lost, the next read registers it again from generation 0, keeping what it showed", async () => {
    const f = fake(), w = new Watched(f.source);
    w.read("views.read", { viewId: "v" }, (r: any) => r.value);
    await w.settled();
    const key = f.asked[0]!.params.watch;
    w.changed([{ key, generation: 4 }]);
    await w.settled();
    w.lost();
    f.set("c", 0);
    expect(w.read("views.read", { viewId: "v" }, (r: any) => r.value)).toEqual({ state: "ready", value: "a" });
    await w.settled();
    expect(f.asked.at(-1)!.params.generation).toBeUndefined();
    // A change on the new connection at generation 1 is taken, though the old one had reached 4.
    w.changed([{ key, generation: 1 }]);
    await w.settled();
    expect(f.asked.at(-1)!.params.generation).toBe(1);
  });

  test("a watch the service dropped keeps its answer and is registered again only after a pause", async () => {
    const f = fake(), w = new Watched(f.source);
    w.read("blocks.query", { query: {} }, (r: any) => r.value);
    await w.settled();
    const key = f.asked[0]!.params.watch;
    w.changed([{ key, generation: 0, dropped: true }]);
    expect(w.read("blocks.query", { query: {} }, (r: any) => r.value).value).toBe("a");
    expect(f.asked.length).toBe(1);
    expect(RETRY_MS).toBeGreaterThan(0);
  });

  test("a refused read waits before it asks again, so a paint loop doesn't hammer the service", async () => {
    let asked = 0;
    const w = new Watched({ request: async (): Promise<any> => { asked++; throw new Error("no notes have aera"); } });
    w.read("blocks.query", { query: { where: "aera" } }, (r: any) => r);
    await w.settled();
    for (let i = 0; i < 10; i++) expect(w.read("blocks.query", { query: { where: "aera" } }, (r: any) => r)).toMatchObject({ state: "error", error: "no notes have aera" });
    expect(asked).toBe(1);
  });

  test("past the reads it keeps, the least recently drawn go, never the one being read", async () => {
    const f = fake(), w = new Watched(f.source);
    for (let i = 0; i < 70; i++) w.read("blocks.query", { query: { where: `k${i}` } }, (r: any) => r.value);
    await w.settled();
    // The newest is still kept: read again, it is answered without asking.
    const before = f.asked.length;
    expect(w.read("blocks.query", { query: { where: "k69" } }, (r: any) => r.value).state).toBe("ready");
    expect(f.asked.length).toBe(before);
  });
});
