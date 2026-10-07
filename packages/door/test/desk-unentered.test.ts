// A desk that was never entered (a showcase stage not opened yet) has no Ctx: a change from the outline reaches it
// without its tiles reading `desk.ctx` (the showcase's ServicePane crashed the door on a save, Oct 7).
import { expect, test } from "bun:test";
import { Desk } from "../src/desk/desk";
import { ServicePane } from "../src/showcase/showcase";

test("a change reaches a desk never entered without its tiles touching the missing Ctx", async () => {
  const desk = new Desk();
  (desk as unknown as { panes: Map<number, unknown> }).panes.set(999, new ServicePane({} as never));
  const failures: unknown[] = [];
  const hear = (e: unknown) => failures.push(e);
  process.on("unhandledRejection", hear);
  try {
    desk.onEvent({ action: "updated", change: { kind: "updated", id: "x" } } as never);
    await new Promise(r => setTimeout(r, 20));
  } finally { process.off("unhandledRejection", hear); }
  expect(failures).toEqual([]);
});
