import { expect, test } from "bun:test";
import { Inspector } from "../src/surface/inspector";

// A quick second edit while the first field's save is still landing waits for it (CI hit this as a refusal: "the
// field's save is still landing"). A save that fails keeps its text and the next edit says why.
test("a second field edit waits for the first one's save to land", async () => {
  const ins = new Inspector();
  let land!: () => void;
  const slow = () => new Promise<void>(r => { land = r; });
  await ins.edit("title", "Plot jobs", [], false, "test:title", slow);
  ins.field!.session.replace("Plot jobs by the shed", { kind: "user" } as never);
  const saving = ins.input("save");
  await Bun.sleep(5);
  let opened = false;
  const next = ins.edit("density", "cozy", ["compact", "cozy"], false, "test:density", async () => {}).then(() => { opened = true; });
  await Bun.sleep(5);
  expect(opened).toBe(false);
  land();
  await saving; await next;
  expect(opened).toBe(true);
  expect(ins.field?.key).toBe("density");
});

test("a field whose save failed keeps its text and the next edit says why", async () => {
  const ins = new Inspector();
  await ins.edit("query", "type=plot-job", [], false, "test:query", async () => { throw new Error("the query doesn't parse"); });
  await ins.input("save");
  ins.field!.saving = true;
  ins.field!.landing = Promise.resolve();
  await expect(ins.edit("title", "x", [], false, "test:title2", async () => {})).rejects.toThrow(/query didn't save: the query doesn't parse/);
});
