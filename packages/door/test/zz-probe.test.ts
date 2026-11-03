import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Desk } from "../src/desk/desk";
const USER = { kind: "user" } as const;
test("probe", async () => {
  process.env.EP0CH_STATE = mkdtempSync(join(tmpdir(), "probe-"));
  const d = new Desk() as any;
  console.log(d.layoutGet().tiles.map((t: any) => t.name));
  const r = await d.dispatch.act({ action: "tile.open", args: { kind: "reader", name: "x", where: "right" } }, USER);
  console.log(r, d.outOfStep());
  await d.dispatch.act({ action: "tile.select", tile: "x" }, USER).catch((e: any) => console.log("sel", e.message));
  console.log([...d.selected]);
  const c = await d.dispatch.act({ action: "tile.close", tile: "x" }, USER);
  console.log(c, d.outOfStep());
});
