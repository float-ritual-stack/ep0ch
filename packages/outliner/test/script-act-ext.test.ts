// A script's act("ext.<id>.<action>") is the service's own: it runs with no door connected, the action's run is waited
// for, and its whole answer comes back to the script. A door action (tile.open) with no door is refused as before.
// Scratch services in temp folders; every note and name is made up.
import { expect, test } from "bun:test";
import { setup, until } from "./script-harness";

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

test("the run act starts is asked by whoever asked the caller, not by the calling script", async () => {
  const { create, run, store } = await setup();
  const ledger = create("Ledger [script::ledger] [effects::write] [results::keep]\n```js\nreturn 'rye: 5';\n```");
  create("Tally [script::tally] [effects::write]\n```js\nconst got = await act('ext.script:ledger.run');\nreturn got.state;\n```");
  expect((await run("tally")).text).toContain("done");
  const note = store.children(ledger.id).find(b => b.text.includes("onBehalfOf"))!;
  expect(note.text).toContain("onBehalfOf: user");
  expect(note.text).not.toContain("onBehalfOf: script:tally");
});

test("a script can't start itself through act, nor start runs past the depth cap", async () => {
  const { create, run } = await setup();
  create("Loop [script::loop] [effects::write]\n```js\ntry { await act('ext.script:loop.run'); return 'ran again'; } catch (e) { return `refused: ${e.message}`; }\n```");
  const loop = await run("loop");
  expect(loop.text).toContain("refused: ext.script:loop.run: script:loop is already running in this chain");
  // Five scripts, each starting the next: the fifth is past the cap of four, and the refusal comes back up the chain.
  for (const n of [1, 2, 3, 4]) create(`Step ${n} [script::step-${n}] [effects::write]\n\`\`\`js\nconst got = await act('ext.script:step-${n + 1}.run');\nreturn got.state + ': ' + (got.answer ?? got.error ?? got.message);\n\`\`\``);
  create("Step 5 [script::step-5] [effects::write]\n```js\nreturn 'bottom';\n```");
  create("Top [script::top] [effects::write]\n```js\ntry { const got = await act('ext.script:step-1.run'); return `${got.state}: ${got.answer ?? got.error ?? got.message}`; } catch (e) { return `refused: ${e.message}`; }\n```");
  const top = await run("top");
  expect(top.text).toContain("at most 4");
  expect(top.text).not.toContain("bottom");
});

test("stopping the calling run stops the run it started", async () => {
  const { create, run, client, store } = await setup();
  create("Slow [script::slow] [effects::write]\n```js\nawait act('ext.script:slower.run');\nreturn 'slow done';\n```");
  const slower = create("Slower [script::slower] [effects::write] [results::keep]\n```js\nawait sh(['sleep', '5']);\nreturn 'slower done';\n```");
  const started = run("slow");
  const child = await until("the child run to start", () => store.children(slower.id).find(b => b.text.includes("onBehalfOf")));
  const runId = /script-run::([^\]\s]+)/.exec(child.text)?.[1];
  expect(runId).toBeTruthy();
  const parentRun = await until("the parent run's id", async () => {
    const slow = store.queryBlocks({ where: "script=slow" }).blocks[0]!;
    return /script-run::([^\]\s]+)/.exec(store.children(slow.id).map(b => b.text).join("\n"))?.[1];
  });
  await client.request({ action: "scripts.stop", run: parentRun });
  await started;
  await until("the child run to stop", () => !store.get(child.id)!.text.split("\n")[0]!.includes("· working") && store.get(child.id)!.text);
  expect(store.get(child.id)!.text).not.toContain("slower done");
});

test("an ext action only a door has (an extension's settings) still goes to the door", async () => {
  const { create, run } = await setup();
  create("Ledger [script::ledger]\n```js\nreturn 'rye';\n```");
  create("Tuner [script::tuner]\n```js\ntry { await act('ext.script:ledger.settings', { model: 'x' }); return 'set'; } catch (e) { return `refused: ${e.message}`; }\n```");
  const { text } = await run("tuner");
  expect(text).toContain("refused: no door");
});

test("with= is read as the door reads it: JSON names to text, each a slot", async () => {
  const { create, run } = await setup();
  create("Pricer [script::pricer] [form-field::rate text]\n```js\nreturn { answer: `rate ${props.rate?.[0]}` };\n```");
  create("Quoter [script::quoter]\n```js\nconst got = await act('ext.script:pricer.run', { with: JSON.stringify({ rate: 'nine' }) });\nreturn got.state;\n```");
  expect((await run("quoter")).text).toContain("done");
  create("Muddled [script::muddled]\n```js\ntry { await act('ext.script:pricer.run', { with: 'rate=nine' }); return 'ran'; } catch (e) { return `refused: ${e.message}`; }\n```");
  expect((await run("muddled")).text).toContain("with is JSON");
});
