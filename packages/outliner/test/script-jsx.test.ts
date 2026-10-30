// tsx/jsx fences (note components): a tag is a view primitive, text children are a leaf's text, a fragment is a stack,
// a function tag is the script's own component. Run in the real VM with a stand-in host API; made-up data only.
import { expect, test } from "bun:test";
import type { RenderHostApi } from "../src/host-api";
import { scriptView } from "../src/script-runs";
import { runScript } from "../src/script-runtime";

const refuse = () => Promise.reject(new Error("not in this test"));
const api: RenderHostApi = { tool: {}, tools: [], call: refuse, q: refuse, read: refuse, query: refuse, resolve: refuse };

async function value(code: string, jsx = true) {
  const result = await runScript(code, api, undefined, undefined, {}, { jsx });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

test("tags, text children and a fragment make a view the catalogue accepts", async () => {
  const drawn = await value(`const xs = ["mend the gate", "wash the shed"];
return <row>{xs.map(x => <card title={x}/>)}<>t</></row>`);
  const view = scriptView(drawn);
  expect(view?.view).toEqual({ type: "row", children: [
    { type: "card", title: "mend the gate" },
    { type: "card", title: "wash the shed" },
    { type: "stack", children: [{ type: "text", text: "t" }] },
  ] });
});

test("text becomes a leaf's text or label, and nulls and falses are left out", async () => {
  const drawn = await value(`const n = 3;
return <box title="Errands">{false}{null}<text tone="dim">{n} open</text><badge>late</badge>{"loose"}</box>`);
  expect(scriptView(drawn)?.view).toEqual({ type: "box", title: "Errands", children: [
    { type: "text", text: "3 open", tone: "dim" },
    { type: "badge", label: "late" },
    { type: "text", text: "loose" },
  ] });
});

test("a function component gets its attributes and children as a plain object", async () => {
  const drawn = await value(`const Lane = ({ title, rows, children }) =>
  <box title={title + " · " + rows.length}>{rows.map(r => <card title={r}/>)}{children}</box>;
return <Lane title="doing" rows={["a", "b"]}><text>end</text></Lane>`);
  expect(scriptView(drawn)?.view).toEqual({ type: "box", title: "doing · 2", children: [
    { type: "card", title: "a" }, { type: "card", title: "b" }, { type: "text", text: "end" },
  ] });
});

test("a ts fence still reads <T>x as a cast", async () => {
  expect(await value("const x: unknown = 41;\nconst n = <number>x;\nreturn n + 1;", false)).toBe(42);
});

test("a tag that is no primitive is named, and a wrong attribute fails validation by its name", async () => {
  const unknown = await runScript("return <lanes/>", api, undefined, undefined, {}, { jsx: true });
  expect(unknown.ok).toBe(false);
  if (!unknown.ok) expect(unknown.error.message).toContain("<lanes> is no view primitive");
  const drawn = await value(`return <card titel="typo"/>`);
  expect(() => scriptView(drawn)).toThrow(/titel/);
});
