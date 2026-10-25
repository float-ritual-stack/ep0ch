// PIE-1264: a script press answers its caller. The run's own words (a returned line, a refusal, the error that ended it)
// come back as the act's answer through every way in (extensions.act for `ep0ch act` and the door, scripts.run for MCP),
// and "working" is never the final word: a run still going after the wait says how to follow or stop it.
// Scratch services in temp folders; every note and name is made up.
import { expect, test } from "bun:test";
import { setup } from "./script-harness";

type Answer = { message: string; state?: string; answer?: string; undo: string };

test("a script that refuses with a line answers that line, whoever asks", async () => {
  const { client, create, extensionOf, store } = await setup();
  store.configureMcpAccess("full");
  const script = create("Gate [script::gate]\n```js\nreturn 'the cellar is closed: it needs candles >= 4';\n```");
  const extension = await extensionOf("gate");
  const act = await client.request<Answer>({ action: "extensions.act", extension: extension.id, extensionAction: "run" });
  expect(act.message).toBe("the cellar is closed: it needs candles >= 4");
  expect(act.state).toBe("done");
  const mcp = await client.request<Answer>({ action: "scripts.run", blockId: script.id, access: "full", mutation: { author: "agent", actorId: "mcp:gate-tester" } });
  expect(mcp.message).toBe("the cellar is closed: it needs candles >= 4");
  expect(store.require(script.id).text).not.toContain("working");
});

test("a script that throws answers the error that ended it, and says it failed", async () => {
  const { client, create, extensionOf } = await setup();
  create("Latch [script::latch]\n```js\nthrow new Error('the latch is stuck');\n```");
  const act = await client.request<Answer>({ action: "extensions.act", extension: (await extensionOf("latch")).id, extensionAction: "run" });
  expect(act.state).toBe("failed");
  expect(act.message).toContain("the latch is stuck");
});

test("a script that returns more than a line answers it whole, and a quiet success says done", async () => {
  const { client, create, extensionOf } = await setup();
  create("Ledger [script::ledger]\n```js\nreturn 'oats: 3\\nrye: 5';\n```");
  create("Sweep [script::sweep]\n```js\nreturn;\n```");
  const ledger = await client.request<Answer>({ action: "extensions.act", extension: (await extensionOf("ledger")).id, extensionAction: "run" });
  expect(ledger.answer).toBe("oats: 3\nrye: 5");
  expect(ledger.message).toBe("Ledger done");
  const sweep = await client.request<Answer>({ action: "extensions.act", extension: (await extensionOf("sweep")).id, extensionAction: "run" });
  expect(sweep).toMatchObject({ message: "Sweep done", state: "done" });
});

test("a run still going after the wait says so and how to stop it, never just working", async () => {
  const { client, create, extensionOf } = await setup();
  create("Kettle [script::kettle]\n```js\nwhile (true) await wait(25);\n```");
  const act = await client.request<Answer>({ action: "extensions.act", extension: (await extensionOf("kettle")).id, extensionAction: "run" });
  expect(act.state).toBe("running");
  expect(act.message).toContain("still running");
  expect(act.message).toContain(`script.stop run=${act.undo}`);
  await client.request({ action: "scripts.stop", run: act.undo });
});
