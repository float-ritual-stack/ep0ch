// yo (PIE-1585): an agent whose whole world is ep0ch. It answers how-to asks with two lines quoted from an action's own
// doc and a button, presses the button when asked (`door.act`: attributed to yo, one undo step), and remembers what
// worked in its own outline. Code quotes, decides and steps up; the model only picks. Cheap first: memory and "do it"
// run no model, a quote runs config.answer, and only an act steps up, once, to config.act.
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { outline, type Route } from "./outline";
import { actPrompt, argsOf, CLAUDE_LOGIN_FIX, notLoggedIn, ASKED_HOW, asksHow, buttonLine, doneRow, isGo, keysOf, labelOf, lastAnswer, lastButton, lineOf, lineStart, memoryStep, memoryText, planOf, planPrompt, pressLine, quoted, ranked, recalled, sections, shortReason, stepsFold, wordsOf, type ActionRecord, type Memory, type Plan } from "./yo-line";

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
      return { id: b.id, asked: prop("yo-asked"), action: prop("yo-action"), line: prop("yo-line") || prop("yo-action"), kind: prop("yo-memory"), text: b.text.split("\n", 1)[0]!.replace(/\s*\[[^\]]*::[^\]]*\]/g, "") };
    });
    steps.push(`read memory: ${found.length} note${found.length === 1 ? "" : "s"}`);
    return found;
  } catch (error) {
    steps.push(memoryStep(firstLine(error), memoryAt.outline ?? "yo"));
    return [];
  }
}

/** One fact, once: nothing if a note already covers these words with this line; other arguments are another fact. A memory that can't be written is said, and the answer stands. */
async function remember(asked: string, pressed: string): Promise<void> {
  try {
    const text = memoryText(asked, pressed);
    const [, title = "", action = "", line = ""] = /^(.*?) \[yo-memory::answer\] \[yo-action::(.*?)\] .*\[yo-line::(.*?)\]$/.exec(text) ?? [];
    const words = wordsOf(asked);
    const { blocks } = await outline<{ blocks: { text: string }[] }>({ action: "blocks.query", query: { where: `yo-action=${action}`, limit: 50 } }, route);
    const covers = (first: string) => {
      const said = /\[yo-line::(.*?)\]/.exec(first)?.[1] ?? action, have = new Set(wordsOf(/\[yo-asked::(.*?)\]/.exec(first)?.[1] ?? first));
      return said === line && words.every(w => have.has(w));
    };
    if (blocks.some(b => covers(b.text.split("\n", 1)[0]!))) return void steps.push("already in memory");
    await outline({ action: "create", text }, route);
    steps.push(`wrote to memory: ${title}`);
  } catch (error) { steps.push(memoryStep(firstLine(error), memoryAt.outline ?? "yo", "write")); }
}

const firstLine = (error: unknown) => shortReason(error instanceof Error ? error.message : String(error));

/** The model as a command: prompt on stdin, its JSON on stdout (`claude --output-format json`'s envelope unwrapped, and its cost said). */
async function model(command: string[], which: string, prompt: string): Promise<unknown> {
  const started = Date.now();
  let proc;
  try { proc = Bun.spawn(command, { stdin: new Blob([prompt]), stdout: "pipe", stderr: "pipe" }); }
  catch (error) { throw new Error(`${which} command couldn't start: ${firstLine(error)}`); }
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) throw new Error(notLoggedIn(out, err) ? `${which} command: ${CLAUDE_LOGIN_FIX}` : `${which} command exited ${code}${err.trim() ? `: ${firstLine(err)}` : ""}`);
  let parsed = JSON.parse(out.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/, "$1")) as Record<string, unknown>;
  let cost = "";
  if (parsed && parsed.type === "result" && typeof parsed.result === "string") {
    if (typeof parsed.total_cost_usd === "number") cost = ` · $${parsed.total_cost_usd.toFixed(4)}`;
    parsed = JSON.parse(parsed.result.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/, "$1")) as Record<string, unknown>;
  }
  steps.push(`asked ${which} (${((Date.now() - started) / 1000).toFixed(1)} s${cost})`);
  return parsed;
}

/** The tile the ask was about, from the thread that carried it. */
const askedTile = () => input.properties?.["ask-tile"]?.[0];
const inThread = () => Array.isArray(input.thread);
/** Whether a person's press of `a` should name the asked tile: it's a tile's own action. Asked of the action's own scope. */
const tileFor = (a: ActionRecord) => (a.scope === "tile" || a.scope === input.properties?.["ask-tile-kind"]?.[0] ? askedTile() : undefined);

/** Press it, as yo: `door.act`, in the door and tile that asked (the dispatcher decides whether the action takes one). What came back says whether it ran. */
async function press(line: string, label: string): Promise<{ undo: string; wrote: boolean; changed: boolean } | { refused: string }> {
  const door = input.door ?? input.properties?.["ask-door"]?.[0];
  const noteId = input.note && !input.note.id.startsWith("resource:") ? input.note.id : undefined;
  const answer = await outline<{ undo: string; done: boolean; wrote?: boolean; changed?: boolean; error?: string }>({
    action: "door.act", line, label, ...(door ? { door } : {}), ...(noteId ? { blockId: noteId } : {}), ...(askedTile() ? { tile: askedTile() } : !inThread() && noteId ? { note: noteId } : {}),
  }, { timeoutMs: 30_000 }).catch((error: unknown) => ({ undo: "", done: false, wrote: false, error: firstLine(error) }));
  steps.push(answer.done ? `pressed ${line} as yo` : `the door refused ${line}: ${answer.error}`);
  // A host that doesn't say whether the run changed anything is taken as one that did: undo is offered, as before.
  return answer.done ? { undo: answer.undo, wrote: !!answer.wrote, changed: answer.changed ?? true } : { refused: answer.error ?? "the door refused it" };
}

/**
 * A run can take back what it wrote or a layout change (the action says whether it changes the layout: `touches`), and
 * only when its record holds a change (PIE-1626): a press that changed nothing offers no undo.
 */
const reversible = (a: ActionRecord | undefined, pressed: { wrote: boolean; changed: boolean }) => pressed.changed && (pressed.wrote || a?.touches === "shape");
const withSteps = (lines: readonly string[]) => [...lines, ...stepsFold(steps)].join("\n");

/** yo's own newest answer: in a thread its newest reply, in a note the newest fold above the line. Nothing else here is pressed. */
function pending(): { ask: string; button: { line: string; at?: number; label: string; act: string } | null } | null {
  if (inThread()) {
    const turns = input.thread!, at = turns.findLastIndex(t => t.author.startsWith("ext:yo"));
    if (at < 0) return null;
    const ask = turns.slice(0, at).reverse().flatMap(t => t.body.split("\n")).map(l => /^\s*@yo\b[:,]?\s*(.*)$/.exec(l)?.[1] ?? "").find(w => w && !isGo(w)) ?? "";
    return { ask, button: lastButton(turns[at]!.body.split("\n").filter(l => !l.startsWith(">"))) };
  }
  const lines = (input.note?.text ?? "").split("\n");
  return lastAnswer(lines.slice(0, Math.max(0, lines.lastIndexOf(input.mark ?? ""))));
}

/** `@yo do it`: the button in yo's own last answer, pressed. Nothing to work out, so no model. */
async function go() {
  const answer = pending(), button = answer?.button;
  if (!button) return ok({ message: "nothing to press yet", reply: "nothing of mine to press here: ask me how to do something first." });
  const pressed = await press(button.act, button.label);
  if ("refused" in pressed) {
    const said = `the door refused ${button.label}: ${pressed.refused}`;
    return ok(inThread() ? { reply: said } : { message: said.slice(0, 480), reply: withSteps([said]) });
  }
  await remember(answer!.ask || button.act, button.act);
  const name = button.act.split(/\s/, 1)[0]!, action = (await catalog().catch(() => [] as ActionRecord[])).find(a => a.name === name);
  const row = doneRow(button.label, pressed.undo, reversible(action, pressed), pressed.changed);
  if (inThread()) return ok({ reply: withSteps([row]) });
  const prefix = /^[>\s]*/.exec(button.line)![0], text = input.note!.text;
  // Its own answer's button by where it is (PIE-1632): the same answer can be above it word for word. The question's
  // "say do it" line goes with the button it was about: the done row stands alone.
  const start = lineStart(text, button.at!), hinted = `${button.line}\n${prefix}${ASKED_HOW}`;
  const observed = text.startsWith(hinted, start) ? hinted : button.line;
  return ok({ message: `✓ pressed ${button.label} as yo`, patches: [{ observed, range: { start, end: start + observed.length }, replacement: `${prefix}${row}` }] });
}

/** What the line says while the person keeps typing: the action and its first keys. */
const said = (a: ActionRecord) => [a.name, keysOf(a, 2)].filter(Boolean).join(" · ");

/** Quote one action: its two lines and its button. */
function quoteAnswer(a: ActionRecord, asked: string, args?: Record<string, string>, note?: string): string[] {
  return [...quoted(a), buttonLine(a, pressLine(a, args), asked, { thread: inThread(), ...(tileFor(a) ? { tile: tileFor(a)! } : {}) }), ...(note ? [note] : [])];
}

async function respond() {
  const asked = (input.request ?? "").trim();
  if (isGo(asked)) return go();
  const tile = input.properties?.["ask-tile-kind"]?.[0];
  const known = await memories();
  const actions = await catalog();
  steps.push(`read ${actions.length} actions' own docs`);

  const { hit, conflict } = recalled(known.filter(m => m.kind === "answer"), asked);
  if (conflict) {
    steps.push(`memory disagrees: ${conflict.map(m => m.text).join("; ")}`);
    const named = conflict.flatMap(m => { const a = actions.find(x => x.name === m.action); return a ? [`\`${m.line}\`, for "${m.asked}"`, buttonLine(a, pressLine(a, argsOf(m.line)), m.asked, { thread: inThread() })] : []; });
    return ok({ message: "from memory: which one?", reply: withSteps(["you've used more than one for that. Which?", ...named]) });
  }
  const remembered = hit ? actions.find(a => a.name === hit.action) : undefined;
  if (remembered) {
    steps.push(`answered from memory: ${hit!.text}`);
    const [quote, keys] = quoted(remembered);
    return ok({ message: `from memory: ${said(remembered)}`, reply: withSteps([`${quote} · ${keys}`, buttonLine(remembered, pressLine(remembered, argsOf(hit!.line)), asked, { thread: inThread(), ...(tileFor(remembered) ? { tile: tileFor(remembered)! } : {}) })]) });
  }

  const boost = tile ? wordsOf(tile) : [];
  // The tile's own actions first when the ask is about it: each action says the scope it belongs to.
  const own = tile && wordsOf(asked).every(w => w === "tile") ? actions.filter(a => a.scope === tile) : [];
  const candidates = [...own, ...ranked(actions, asked || "tile", boost).filter(a => !own.includes(a))].slice(0, 12);
  steps.push(candidates.length ? `closest actions: ${candidates.slice(0, 4).map(a => a.name).join(", ")}` : "no action's words match");
  const docs = (await Promise.all(["scripts", "extensions"].map(d => ep0ch(["docs", d]).catch(() => "")))).flatMap(d => sections(d, asked));
  if (docs.length) steps.push(`read ${docs.length} doc section${docs.length === 1 ? "" : "s"}`);

  // Code reads the words first: a question never offers the model an act, and never presses (PIE-1629).
  const question = asksHow(asked);
  if (question) steps.push("a question by its words: quote and button, nothing pressed");
  const answerCommand = config.answer ?? defaults.answer.default;
  let plan: Plan | null = null;
  let trouble = "";
  if (answerCommand.length) {
    try {
      plan = planOf(await model(answerCommand, "the answer model", planPrompt({ asked, question, candidates, docs, habits: known.filter(m => m.kind === "habit").map(m => m.text), ...(tile ? { tile } : {}) })), candidates, docs);
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
  // A question is quoted, whatever the model picked: whether to press is code's (PIE-1629), and only a command presses.
  if (plan.kind === "act" && question) steps.push("the model said press it; it's a question, so code quoted it");
  if (plan.kind === "quote" || question) return ok({ message: said(action), reply: withSteps(quoteAnswer(action, asked, plan.args, question ? ASKED_HOW : undefined)) });

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
  const label = labelOf(action, line.line), pressed = await press(line.line, label);
  if ("refused" in pressed) return ok({ message: "the door refused it", reply: withSteps([...quoteAnswer(action, asked, args), `the door refused it as yo: ${pressed.refused}`]) });
  await remember(asked, line.line);
  return ok({ message: `✓ pressed ${label} as yo`, reply: withSteps([...quoted(action), doneRow(label, pressed.undo, reversible(action, pressed), pressed.changed)]) });
}

try {
  if (operation === "respond") await respond();
  else if (operation === "act" && input.action === "remember") {
    await remember((input.args?.asked ?? "").replaceAll("-", " "), lineOf(input.args?.act ?? "", input.args?.args));
    ok({ message: steps.at(-1) ?? "remembered" });
  } else process.stdout.write(JSON.stringify({ ok: false, code: "invalid-config" }));
} catch (error) {
  process.stderr.write(`yo couldn't answer: ${firstLine(error)}`);
  process.exitCode = 1;
}
