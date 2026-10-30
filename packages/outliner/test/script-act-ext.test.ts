// A script's act("ext.<id>.<action>") is the service's own: it runs with no door connected, the action's run is waited
// for, and its whole answer comes back to the script. A door action (tile.open) with no door is refused as before.
// Scratch services in temp folders; every note and name is made up.
import { expect, test } from "bun:test";
import { setup } from "./script-harness";

test("act on a script's run answers its whole answer with no door, and what it wrote is the caller's to show", async () => {
  const { create, run, store } = await setup();
  create("Ledger [script::ledger] [effects::write]\n```js\nawait tools.outline_create({ parent: 'root', text: 'Oat sacks counted' });\nreturn `oats: ${props.oats?.[0]}\\nrye: 5`;\n```");
  create("Tally [script::tally] [effects::write]\n```js\nconst got = await act('ext.script:ledger.run', { oats: 3 });\nreturn `${got.state}: ${got.answer}`;\n```");
  const { text } = await run("tally");
  expect(text).toContain("done: oats: 3\nrye: 5");
  // The called run's write is its own, asked by the caller's run.
  const sacks = store.children(null).find(b => b.text === "Oat sacks counted");
  expect(sacks?.actorId).toBe("script:ledger");
});

test("a run's act on an extension that fails answers why, and an unknown one names ext ls", async () => {
  const { create, run } = await setup();
  create("Latch [script::latch]\n```js\nthrow new Error('the latch is stuck');\n```");
  create("Gate keeper [script::gate-keeper]\n```js\nconst got = await act('ext.script:latch.run');\nlet missing;\ntry { await act('ext.script:no-such-shed.run'); } catch (e) { missing = e.message; }\nreturn `${got.state} · ${got.error} · ${missing}`;\n```");
  const { text } = await run("gate-keeper");
  expect(text).toContain("failed");
  expect(text).toContain("the latch is stuck");
  expect(text).toContain("No extension script:no-such-shed is active here (outliner ext ls lists them)");
});

test("a door action with no door connected is still refused, with how to get one", async () => {
  const { create, run } = await setup();
  create("Opener [script::opener]\n```js\ntry { await act('tile.open', { kind: 'query', query: '#beans' }); return 'opened'; } catch (e) { return `refused: ${e.message}`; }\n```");
  const { text } = await run("opener");
  expect(text).toContain("refused: no door");
});
