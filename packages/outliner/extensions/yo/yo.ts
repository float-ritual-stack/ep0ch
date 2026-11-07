// yo (PIE-1585): an agent whose whole world is ep0ch. It answers how-to asks with two lines quoted from an action's own
// doc and a button, presses the button when asked (`door.act`: attributed to yo, one undo step), and remembers what
// worked in its own outline. Code quotes, decides and steps up; the model only picks. Cheap first: memory and "do it"
// run no model, a quote runs config.answer, and only an act steps up, once, to config.act.
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { outline, type Route } from "./outline";
import { actPrompt, buttonLine, isGo, keysOf, labelOf, lastButton, memoryText, planOf, planPrompt, pressLine, quoted, ranked, recalled, sections, stepsFold, wordsOf, type ActionRecord, type Memory, type Plan } from "./yo-line";

interface Config { answer?: string[]; act?: string[]; memory?: { outline?: string; machine?: string }; ep0ch?: string[] }
interface Input {
  action?: string;
  args?: Record<string, string>;
  request?: string;
  mark?: string;
  door?: string;
  note?: { id: string; text: string };
  thread?: { author: string; body: string }[];
  properties?: Record<string, string[]>;
}
const { operation, input, config = {} } = (await Bun.stdin.json()) as { operation: string; input: Input; config?: Config };
const ok = (value: unknown) => process.stdout.write(JSON.stringify({ ok: true, value }));

const defaults: { answer: { default: string[] }; act: { default: string[] }; memory: { default: { outline: string } } } = (await Bun.file(join(import.meta.dir, "extension.json")).json()).configSchema.properties;
const memoryAt = config.memory ?? defaults.memory.default;
const route: Route = { ...(memoryAt.outline ? { outline: memoryAt.outline } : {}), ...("machine" in memoryAt && memoryAt.machine ? { machine: memoryAt.machine } : {}) };
const steps: string[] = [];

/** The door CLI: config.ep0ch, else the door of the checkout this host runs from, else `ep0ch` on the PATH. */
function ep0chCommand(): string[] {
  if (config.ep0ch?.length) return config.ep0ch;
  const main = process.env.EP0CH_SOURCE ? resolve(process.env.EP0CH_SOURCE, "packages/door/src/main.ts") : null;
  return main && existsSync(main) ? ["bun", main] : ["ep0ch"];
}
async function ep0ch(args: string[]): Promise<string> {
  const proc = Bun.spawn([...ep0chCommand(), ...args], { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) throw new Error(`${ep0chCommand().join(" ")} ${args.join(" ")} exited ${code}: ${err.trim().split("\n")[0]}`);
  return out;
}

/** Every action's own description: the door's built-ins, and what the installed extensions and scripts say of themselves. */
async function catalog(): Promise<ActionRecord[]> {
  const builtIn = JSON.parse(await ep0ch(["actions", "--all"])) as ActionRecord[];
  const listed = await outline<{ extensions: { id: string; name?: string; state?: string; actions?: { id: string; label: string; description?: string; key?: string }[] }[] }>({ action: "extensions.list" }).catch(() => ({ extensions: [] }));
  const installed = listed.extensions.filter(e => e.state === "active").flatMap(e => (e.actions ?? []).map((a): ActionRecord => ({
    name: `ext.${e.id}.${a.id}`, summary: `${e.name ?? e.id}: ${a.label}${a.description ? `. ${a.description}` : ""}`, ...(a.key ? { keys: a.key } : {}),
  })));
  return [...builtIn, ...installed];
}

async function memories(): Promise<Memory[]> {
  try {
    const { blocks } = await outline<{ blocks: { id: string; text: string; properties?: { key: string; value: string }[] }[] }>({ action: "blocks.query", query: { where: "yo-memory", limit: 200 } }, route);
    const found = blocks.map(b => {
      const prop = (key: string) => b.properties?.find(p => p.key === key)?.value ?? "";
      return { id: b.id, asked: prop("yo-asked"), action: prop("yo-action"), kind: prop("yo-memory"), text: b.text.split("\n", 1)[0]!.replace(/\s*\[[^\]]*::[^\]]*\]/g, "") };
    });
    steps.push(`read memory: ${found.length} note${found.length === 1 ? "" : "s"}`);
    return found;
  } catch (error) {
    steps.push(`memory skipped (${firstLine(error)}): make it with ep0ch outline create ${memoryAt.outline}`);
    return [];
  }
}

/** One fact, once: nothing if a note already says it; a memory that can't be written is said, and the answer stands. */
async function remember(asked: string, action: string): Promise<void> {
  try {
    const text = memoryText(asked, action);
    const title = text.split(" [yo-memory", 1)[0]!, words = wordsOf(asked);
    const { blocks } = await outline<{ blocks: { text: string }[] }>({ action: "blocks.query", query: { where: `yo-action=${action}`, limit: 50 } }, route);
    if (blocks.some(b => { const have = new Set(wordsOf(b.text.split("\n", 1)[0]!)); return words.every(w => have.has(w)); })) return void steps.push("already in memory");
    await outline({ action: "create", text }, route);
    steps.push(`wrote to memory: ${title}`);
  } catch (error) { steps.push(`not remembered (${firstLine(error)})`); }
}

const firstLine = (error: unknown) => (error instanceof Error ? error.message : String(error)).split("\n", 1)[0]!.slice(0, 160);

/** The model as a command: prompt on stdin, its JSON on stdout (`claude --output-format json`'s envelope unwrapped, and its cost said). */
async function model(command: string[], which: string, prompt: string): Promise<unknown> {
  const started = Date.now();
  let proc;
  try { proc = Bun.spawn(command, { stdin: new Blob([prompt]), stdout: "pipe", stderr: "pipe" }); }
  catch (error) { throw new Error(`${which} command couldn't start: ${firstLine(error)}`); }
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) throw new Error(`${which} command exited ${code}${err.trim() ? `: ${firstLine(err)}` : ""}`);
  let parsed = JSON.parse(out.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/, "$1")) as Record<string, unknown>;
  let cost = "";
  if (parsed && parsed.type === "result" && typeof parsed.result === "string") {
    if (typeof parsed.total_cost_usd === "number") cost = ` · $${parsed.total_cost_usd.toFixed(4)}`;
    parsed = JSON.parse(parsed.result.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/, "$1")) as Record<string, unknown>;
  }
  steps.push(`asked ${which} (${((Date.now() - started) / 1000).toFixed(1)} s${cost})`);
  return parsed;
}

/** Press it, as yo: `door.act`, in the door that asked. What came back says whether it ran. */
async function press(line: string, label: string): Promise<{ undo: string } | { refused: string }> {
  const door = input.door ?? input.properties?.["ask-door"]?.[0];
  const answer = await outline<{ undo: string; done: boolean; error?: string }>({
    action: "door.act", line, label, ...(door ? { door } : {}), ...(input.note && !input.note.id.startsWith("resource:") ? { blockId: input.note.id } : {}),
  }, { timeoutMs: 30_000 }).catch((error: unknown) => ({ undo: "", done: false, error: firstLine(error) }));
  steps.push(answer.done ? `pressed ${line} as yo` : `the door refused ${line}: ${answer.error}`);
  return answer.done ? { undo: answer.undo } : { refused: answer.error ?? "the door refused it" };
}

const doneRow = (label: string, undo: string) => `✓ yo pressed ${label} · [undo](act: ext.undo run=${undo})`;
const withSteps = (lines: readonly string[]) => [...lines, ...stepsFold(steps)].join("\n");
const inThread = () => Array.isArray(input.thread);

/** What the person's earlier words asked: the ask a button answers, for what's kept in memory. */
function askedBefore(lines: readonly string[]): string {
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = /^\s*(?:[-*+]\s+)?@yo\b[:,]?\s*(.*)$/.exec(lines[i]!);
    if (m && m[1] && !isGo(m[1])) return m[1];
  }
  return "";
}

/** `@yo do it`: the newest button yo drew here, pressed. Nothing to work out, so no model. */
async function go() {
  const text = inThread() ? input.thread!.map(t => t.body).join("\n") : input.note?.text ?? "";
  const lines = text.split("\n");
  const above = inThread() ? lines : lines.slice(0, Math.max(0, lines.lastIndexOf(input.mark ?? "")));
  const button = lastButton(above);
  if (!button) return ok({ message: "nothing to press yet", reply: "nothing here to press yet: ask me how to do something first." });
  const pressed = await press(button.act, button.label);
  if ("refused" in pressed) {
    const said = `the door refused ${button.label}: ${pressed.refused}`;
    return ok(inThread() ? { reply: said } : { message: said.slice(0, 480), reply: withSteps([said]) });
  }
  await remember(askedBefore(above) || button.act, button.act.split(/\s/, 1)[0]!);
  const row = doneRow(button.label, pressed.undo);
  if (inThread()) return ok({ reply: withSteps([row]) });
  const prefix = /^[>\s]*/.exec(button.line)![0];
  return ok({ message: `✓ pressed ${button.label} as yo`, patches: [{ observed: button.line, replacement: `${prefix}${row}` }] });
}

/** What the line says while the person keeps typing: the action and its first keys. */
const said = (a: ActionRecord) => [a.name, keysOf(a, 2)].filter(Boolean).join(" · ");

/** Quote one action: its two lines and its button. */
function quoteAnswer(a: ActionRecord, asked: string, args?: Record<string, string>, note?: string): string[] {
  return [...quoted(a), buttonLine(a, pressLine(a, args), asked, { thread: inThread() }), ...(note ? [note] : [])];
}

async function respond() {
  const asked = (input.request ?? "").trim();
  if (isGo(asked)) return go();
  const tile = input.properties?.["ask-tile-kind"]?.[0];
  const known = await memories();
  const actions = await catalog();
  steps.push(`read ${actions.length} actions' own docs`);

  const hit = recalled(known.filter(m => m.kind === "answer"), asked);
  const remembered = hit ? actions.find(a => a.name === hit.action) : undefined;
  if (remembered) {
    steps.push(`answered from memory: ${hit!.text}`);
    const [quote, keys] = quoted(remembered);
    return ok({ message: `from memory: ${said(remembered)}`, reply: withSteps([`${quote} · ${keys}`, buttonLine(remembered, pressLine(remembered), asked, { thread: inThread() })]) });
  }

  const boost = tile ? wordsOf(tile) : [];
  // The tile's own actions first when the ask is about it: each action says the scope it belongs to.
  const own = tile && wordsOf(asked).every(w => w === "tile") ? actions.filter(a => a.scope === tile) : [];
  const candidates = [...own, ...ranked(actions, asked || "tile", boost).filter(a => !own.includes(a))].slice(0, 12);
  steps.push(candidates.length ? `closest actions: ${candidates.slice(0, 4).map(a => a.name).join(", ")}` : "no action's words match");
  const docs = (await Promise.all(["scripts", "extensions"].map(d => ep0ch(["docs", d]).catch(() => "")))).flatMap(d => sections(d, asked));
  if (docs.length) steps.push(`read ${docs.length} doc section${docs.length === 1 ? "" : "s"}`);

  const answerCommand = config.answer ?? defaults.answer.default;
  let plan: Plan | null = null;
  let trouble = "";
  if (answerCommand.length) {
    try {
      plan = planOf(await model(answerCommand, "the answer model", planPrompt({ asked, candidates, docs, habits: known.filter(m => m.kind === "habit").map(m => m.text), ...(tile ? { tile } : {}) })), candidates, docs);
      if (!plan) trouble = "the model's pick wasn't one of what it was offered";
    } catch (error) { trouble = firstLine(error); steps.push(`no answer from the model: ${trouble}`); }
  } else trouble = "no model set";

  if (!plan) {
    const best = candidates[0];
    if (!best) return ok({ message: "nothing here answers it", reply: withSteps([`nothing in the actions' docs answers that${trouble ? ` (${trouble})` : ""}.`]) });
    return ok({ message: said(best), reply: withSteps(quoteAnswer(best, asked, undefined, trouble ? `closest match by its words (${trouble}).` : undefined)) });
  }
  if (plan.kind === "chat") return ok({ message: "yo", reply: plan.line });
  if (plan.kind === "none") return ok({ message: "nothing here answers it", reply: withSteps([plan.line]) });
  if (plan.kind === "doc") return ok({ message: "from the docs", reply: withSteps([`> ${plan.quote}`]) });

  const action = candidates.find(a => a.name === (plan as { action: string }).action)!;
  if (plan.kind === "quote") return ok({ message: said(action), reply: withSteps(quoteAnswer(action, asked, plan.args)) });

  // An act: code steps up, once, to the model that presses.
  const actCommand = config.act ?? defaults.act.default;
  if (!actCommand.length) return ok({ message: action.name, reply: withSteps(quoteAnswer(action, asked, plan.args, "no act model set: press it yourself.")) });
  let args = plan.args;
  try {
    const page = await ep0ch(["actions", "--doc", action.name, "--source"]).catch(() => action.summary);
    const answer = await model(actCommand, "the act model", actPrompt({ asked, action: action.name, page })) as { press?: boolean; args?: Record<string, unknown>; line?: string };
    if (answer?.press === false) return ok({ message: "not pressed", reply: withSteps([...quoteAnswer(action, asked, plan.args), String(answer.line ?? "not pressed: that isn't what was asked")]) });
    if (answer?.args) args = Object.fromEntries(Object.entries(answer.args).map(([k, v]) => [k, String(v)]));
  } catch (error) { return ok({ message: "not pressed", reply: withSteps([...quoteAnswer(action, asked, plan.args), `not pressed: ${firstLine(error)}`]) }); }
  const line = pressLine(action, args);
  if (line.slots.length) return ok({ message: action.name, reply: withSteps(quoteAnswer(action, asked, args, `it needs ${line.slots.join(", ")}: press it and say.`)) });
  const pressed = await press(line.line, labelOf(action));
  if ("refused" in pressed) return ok({ message: "the door refused it", reply: withSteps([...quoteAnswer(action, asked, args), `the door refused it as yo: ${pressed.refused}`]) });
  await remember(asked, action.name);
  return ok({ message: `✓ pressed ${labelOf(action)} as yo`, reply: withSteps([...quoted(action), doneRow(labelOf(action), pressed.undo)]) });
}

try {
  if (operation === "respond") await respond();
  else if (operation === "act" && input.action === "remember") {
    await remember((input.args?.asked ?? "").replaceAll("-", " "), input.args?.act ?? "");
    ok({ message: steps.at(-1) ?? "remembered" });
  } else process.stdout.write(JSON.stringify({ ok: false, code: "invalid-config" }));
} catch (error) {
  process.stderr.write(`yo couldn't answer: ${firstLine(error)}`);
  process.exitCode = 1;
}
