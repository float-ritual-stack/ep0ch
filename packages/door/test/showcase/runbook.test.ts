import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync, existsSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { ReaderPane } from "../../src/desk/panes";
import { PtyPane } from "../../src/desk/pty";
import { formState } from "../../src/bar/ask";
import { outliner, until } from "../scratch";
import { useShowcaseScreen } from "./harness";

const USER = { kind: "user" } as const;
const TOKEN = "fictional-runbook-token-1098";
const files = (dir: string): string[] => readdirSync(dir).flatMap(name => {
  const path = join(dir, name), st = statSync(path);
  return st.isDirectory() ? files(path) : st.isFile() ? [path] : [];
});
const waitFor = async (ok: () => Promise<boolean>, what: string) => {
  const end = Date.now() + 10000;
  while (!(await ok())) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await Bun.sleep(30); }
};

describe.skipIf(!outliner)("the runbook showcase", () => {
  const h = useShowcaseScreen();
  const act = (action: string, args = {}, tile?: string) => h.app.dispatch.act({ action, args, ...(tile ? { tile } : {}) }, USER);
  const reader = () => h.sc.tilesHere()!.pane("reader") as ReaderPane;
  const records = async (root: string) => (await h.board.children(root)).filter(b => b.text.includes("[type::run]"));
  const waitRecord = async (root: string, status: string, n = 1) => {
    await waitFor(async () => (await records(root)).filter(b => b.text.includes(`[run.status::${status}]`)).length >= n, `record ${status}`);
    return (await records(root)).filter(b => b.text.includes(`[run.status::${status}]`)).at(-1)!;
  };
  let shown = false;
  const show = async (text: string) => {
    await act("section", { name: "runbook" });
    if (!shown) await until(() => h.screen().includes("Try a terminal runbook"), "the showcase reader");
    shown = true;
    h.screen();
    await act("section.try");
    const book = await h.board.createBlock(null, text);
    reader().show(book, h.sc.tilesHere()!);
    h.screen();
    return book;
  };
  const controls = () => { h.screen(); return reader().surface.describeElements().filter(e => e.kind === "control" && e.label === "[run]"); };
  const run = async (index: number, keyboard = false) => {
    await act("tile.focus", {}, "reader");
    await until(() => controls().length > index, "runnable fence control");
    if (keyboard) {
      await act("element.select", { n: controls()[index]!.n }, "reader");
      h.press({ kind: "enter" });
    } else {
      const painted = h.screen().split("\n"), rows = painted.map((line, y) => ({ line, y })).filter(r => r.line.includes("[run]"));
      const { line, y } = rows[index]!, x = line.indexOf("[run]") + 2;
      h.press({ kind: "mouse", action: "down", button: 0, x, y });
      h.press({ kind: "mouse", action: "up", button: 0, x, y });
    }
  };
  const answer = async (field: string, value: string) => {
    await until(() => formState()?.focus === field, `field ${field}`);
    await act("bar.form", { op: "set", field, value });
  };
  afterEach(async () => {
    if (h.app.bar && !h.app.bar.ended()) await act("bar.close");
    const desk = h.sc.tilesHere();
    for (const name of desk?.dispatch.list().tiles ?? []) {
      const tile = desk!.pane(name);
      if (!(tile instanceof PtyPane)) continue;
      if (tile.running) await act("tile.close", {}, name).catch(() => {});
      await act("tile.close", {}, name);
    }
  });

  test("the README pasted as one note runs each fence by mouse or keyboard and leaves examples plain", async () => {
    const book = await show("Draft runbook");
    const readme = readFileSync(join(outliner!, "extensions/runbook/README.md"), "utf8");
    const example = /````text\n([\s\S]*?)\n````/.exec(readme)![1]!;
    await act("edit.text", { text: "" }, "reader");
    h.press({ kind: "paste", text: example });
    await act("edit.save", {}, "reader");
    if (reader().surface.editing) await act("edit.save", {}, "reader");
    await until(() => controls().length === 3, "a control for every README step");
    const saved = (await h.board.get(book.id))!.text;
    expect(saved).toContain("^step-print-the-label");
    await run(0);
    expect((await waitRecord(book.id, "ok")).text).toContain("The herb garden: sage");
    await run(1, true);
    await answer("ask.pot", "clay"); h.press({ kind: "enter" });
    expect((await waitRecord(book.id, "ok", 2)).text).toContain("Pot: clay");
    await run(2);
    await until(() => formState()?.focus === "secret.token", "masked token prompt");
    for (const ch of TOKEN) h.ch(ch);
    expect(JSON.stringify(h.app.bar!.describe())).not.toContain(TOKEN);
    expect(h.app.bar!.draw(200, 60).lines.join("\n")).not.toContain(TOKEN);
    await until(() => h.app.bar?.items.some(i => i.row.key === "private-answer") ?? false, "the typed masked answer");
    h.press({ kind: "enter" });
    await until(() => formState()?.focus === "run", "run the masked form");
    h.press({ kind: "enter" });
    const last = await waitRecord(book.id, "ok", 3);
    expect(last.text).toContain("Token received");
    expect(last.text).toContain("Masking is best-effort");
    expect(h.screen()).not.toContain(TOKEN);
    expect((await h.board.get(book.id))!.text).toContain("::graph-table");
    for (const path of files(h.scratch.root)) expect(readFileSync(path).includes(Buffer.from(TOKEN))).toBe(false);
  }, 45000);

  test("inline context with seven literal env lines lets a client run while its stub server stays up; stop records stopped", async () => {
    const book = await show([
      "Garden service [type::runbook] [herb::sage]", "", "Context", `cwd:: ${h.scratch.root}`,
      "```env", "HERB={{self.herb}}", "LABEL=the garden", "ONE=1", "TWO=2", "THREE=3", "FOUR=4", "TOKEN={{secret.token}}", "```", "",
      "Start the stub", "```sh run", `bun -e 'const server=Bun.serve({port:0,fetch:()=>new Response(process.env.HERB+":"+process.env.LABEL)}); await Bun.write("stub-port", String(server.port)); console.log("stub up");'`, "```", "",
      "Ask the stub", "run::", "```sh", 'curl -fsS "http://127.0.0.1:$(cat stub-port)"; test "$ONE$TWO$THREE$FOUR" = 1234; test -n "$TOKEN"', "```", "",
      "Example", "```sh", "exit 91", "```",
    ].join("\n"));
    await until(() => controls().length === 2, "only the two command fences run");
    await run(0);
    await answer("secret.token", TOKEN); h.press({ kind: "enter" });
    await until(() => (h.sc.tilesHere()!.pane("Start the stub") as PtyPane | undefined)?.text().join("\n").includes("stub up") ?? false, "stub server");
    await run(1);
    await answer("secret.token", TOKEN); h.press({ kind: "enter" });
    const client = await waitRecord(book.id, "ok");
    expect(client.text).toContain("sage:the garden");
    expect(client.text).toContain(`[run.cwd::${h.scratch.root}]`);
    expect(client.text).toContain("ONE,TWO,THREE,FOUR");
    expect((h.sc.tilesHere()!.pane("Start the stub") as PtyPane).running).toBe(true);
    await run(0);
    await until(() => h.app.bar?.items.some(i => i.row.label === "stop it") ?? false, "focus or stop choices");
    await act("bar.pick", { n: h.app.bar!.items.findIndex(i => i.row.label === "stop it") + 1 });
    expect((await waitRecord(book.id, "stopped")).text).not.toContain(TOKEN);
    expect(h.screen()).not.toContain(TOKEN);
  }, 45000);

  test("editing a failed command preserves its anchor; rerunning makes two rows and leaves Go templates literal", async () => {
    const book = await show("Garden check [type::runbook]\n\nCheck the pot\nrun::\n```sh\nprintf '\\033[31mempty pot\\033[0m\\r\\n'; exit 7\n```");
    await run(0, true);
    const failed = await waitRecord(book.id, "failed");
    expect(failed.text).toContain("[run.exit::7]");
    expect(failed.text).not.toContain("\x1b");
    expect(failed.text).not.toContain("\r");
    await act("tile.focus", {}, "reader");
    const was = (await h.board.get(book.id))!;
    const anchor = /\^step-[a-z0-9-]+/.exec(was.text)![0];
    await act("edit.text", { text: was.text.replace("empty pot", "{{.Names}}").replace("exit 7", "exit 0").replace("Check the pot", "Check the planted pot") }, "reader");
    await act("edit.save", {}, "reader");
    await run(0);
    expect((await waitRecord(book.id, "ok")).text).toContain("{{.Names}}");
    expect((await records(book.id)).map(r => r.text)).toHaveLength(2);
    expect((await h.board.get(book.id))!.text).toContain(anchor);
    await act("tile.focus", {}, "reader");
    await until(() => h.screen().includes("run.status") && h.screen().includes("failed") && h.screen().includes("ok"), "both results in the live table");
  }, 30000);

  test("asked values stay data inside every shell quote style, and records scrub terminal escapes and encoded secrets", async () => {
    const book = await show("Literal values [type::runbook]\n\nPrint data\n```sh run\nprintf '%s\\n' {{ask.label}} \"{{ask.label}}\" '{{ask.label}}'; printf '%s' {{secret.token}} | base64; printf '\\033[31mplain\\033[0m\\r\\n'\n```");
    const value = 'spaces "quotes" \'apostrophe\' $(printf INJECTED) `printf INJECTED` *\na second line';
    await run(0);
    await answer("ask.label", value);
    await answer("secret.token", TOKEN); h.press({ kind: "enter" });
    const done = await waitRecord(book.id, "ok");
    expect(done.text.split(value)).toHaveLength(4);
    expect(done.text).toContain("[redacted]");
    expect(done.text).not.toContain(Buffer.from(TOKEN).toString("base64"));
    expect(done.text).not.toContain("\x1b");
    expect(done.text).not.toContain("\r");
    for (const path of files(h.scratch.root)) expect(readFileSync(path).includes(Buffer.from(TOKEN))).toBe(false);
  }, 30000);

  test("cancelling a masked prompt creates no run, and an agent's supplied answer is attributed", async () => {
    const book = await show("Private prompt [type::runbook]\n\nCheck the answer\n```sh run\ntest -n {{secret.token}}; printf '%s\\n' {{ask.label}}\n```");
    await run(0);
    await until(() => formState()?.focus === "secret.token", "the private prompt");
    h.press({ kind: "paste", text: TOKEN });
    await act("bar.close");
    expect(await records(book.id)).toHaveLength(0);
    await expect(h.app.dispatch.act({ action: "ext.runbook.run-step", args: { block: book.id } }, { kind: "agent", id: "garden-agent" })).rejects.toThrow("Supply");
    await h.app.dispatch.act({ action: "ext.runbook.run-step", args: { block: book.id, with: JSON.stringify({ "secret.token": TOKEN, "ask.label": "agent answer" }) } }, { kind: "agent", id: "garden-agent" });
    const done = await waitRecord(book.id, "ok");
    expect(done.text).toContain("[run.by::garden-agent]");
    expect(done.text).toContain("agent answer");
    for (const path of files(h.scratch.root)) expect(readFileSync(path).includes(Buffer.from(TOKEN))).toBe(false);
  }, 30000);
  test.skipIf(!existsSync("/bin/zsh"))("child fences inherit document-order context and PATH from a real login-shell startup file", async () => {
    const bin = join(h.scratch.root, "garden-bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "garden-profile"), "#!/bin/sh\nprintf 'profile loaded: '\n");
    chmodSync(join(bin, "garden-profile"), 0o755);
    writeFileSync(join(h.scratch.root, ".zprofile"), `export PATH="${bin}:$PATH"\n`);
    const book = await show(`Child context [type::runbook] [cwd::${h.scratch.root}]`);
    const context = await h.board.createBlock(book.id, `Garden context\n\`\`\`env\nLABEL=child value\nZDOTDIR=${h.scratch.root}\n\`\`\``);
    const step = await h.board.createBlock(context.id, "Read the context\nrun::\n```sh\ngarden-profile; printf '%s' \"$LABEL\"\n```".replaceAll('\\"', '"'));
    const current = (await h.board.get(book.id))!;
    await h.board.update(book.id, `${current.text}\n\n!((${step.id}))`, current.revision!);
    const savedShell = process.env.SHELL;
    process.env.SHELL = "/bin/zsh";
    try {
      await run(0);
      expect((await waitRecord(book.id, "ok")).text).toContain("profile loaded: child value");
    } finally { if (savedShell === undefined) delete process.env.SHELL; else process.env.SHELL = savedShell; }
  }, 30000);

  test("bad context is saved and warned inline; a missing folder refuses only the requested step", async () => {
    const book = await show("Bad garden context [type::runbook]\n\nContext\n```env\nnot an assignment\n```\n\nCheck the beds\n```sh run\nprintf beds\n```");
    await until(() => h.screen().includes("Invalid env line"), "an inline context warning");
    expect((await h.board.get(book.id))!.text).toContain("not an assignment");
    await expect(act("ext.runbook.run-step", { block: book.id })).rejects.toThrow("Invalid env line");
    const current = (await h.board.get(book.id))!;
    await h.board.update(book.id, current.text.replace("not an assignment", "LABEL=literal $(printf untouched)").replace("Context\n", `Context\ncwd:: ${h.scratch.root}/missing-folder\n`), current.revision!);
    await expect(act("ext.runbook.run-step", { block: book.id })).rejects.toThrow("Set cwd::");
    expect(await records(book.id)).toHaveLength(0);
  }, 30000);

});
