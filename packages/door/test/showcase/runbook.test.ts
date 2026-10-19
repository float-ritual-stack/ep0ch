import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, writeFileSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { traceActions } from "../../src/surface/actions";
import { ReaderPane } from "../../src/desk/panes";
import { PtyPane } from "../../src/desk/pty";
import { formState } from "../../src/bar/ask";
import { findOutputRegions } from "@ep0ch/outline-core/output-region";
import { outliner, until } from "../scratch";
import { useShowcaseScreen } from "./harness";

const USER = { kind: "user" } as const;
const TOKEN = "fictional-runbook-token-1061";
const files = (dir: string): string[] => readdirSync(dir).flatMap(name => {
  const path = join(dir, name), st = statSync(path);
  return st.isDirectory() ? files(path) : st.isFile() ? [path] : [];
});

describe.skipIf(!outliner)("the runbook showcase", () => {
  const h = useShowcaseScreen();
  afterEach(async () => {
    await h.app.dispatch.act({ action: "runbook.stop" }, USER).catch(() => {});
    if (h.app.bar && !h.app.bar.ended()) await h.app.dispatch.act({ action: "bar.close" }, USER);
    const tile = h.sc.tilesHere()?.pane("Runbook") as PtyPane | undefined;
    if (tile) {
      await until(() => !tile.running, "the stopped terminal exits");
      await h.app.dispatch.act({ action: "tile.close", tile: "Runbook" }, USER);
    }
  });
  test("run all prompts in a real terminal, masks its form, records redacted output and leaves the tile", async () => {
    const { app, board, sc } = h;
    await app.dispatch.act({ action: "section", args: { name: "runbook" } }, USER);
    await until(() => h.screen().includes("Try a terminal runbook"), "the runbook reader", 10000);
    const listed = await board.listExtensions();
    const book = (await board.children(listed.pages!.runbook!)).find(b => b.text.startsWith("Try a terminal runbook"))!;
    const steps = await board.children(book.id);
    await until(() => h.screen().includes("[run all]"), "the run-all control");
    expect(h.screen().split("\n").find(line => line.includes("Try a terminal runbook"))).toContain("[run all]");
    const painted = h.screen().split("\n"), row = painted.findIndex(line => line.includes("[run all]"));
    const x = painted[row]!.indexOf("run all") + 2;
    const actions: string[] = [], untrace = traceActions(r => { actions.push(r.name); });
    h.press({ kind: "mouse", action: "down", button: 0, x, y: row });
    h.press({ kind: "mouse", action: "up", button: 0, x, y: row });
    await until(() => actions.includes("ext.runbook.run-all"), "the click dispatches run all").catch(e => { throw new Error(`${e.message}\n${h.screen()}\n${JSON.stringify(actions)}`); });
    untrace();
    const desk = sc.tilesHere()!;
    await until(() => desk.pane("Runbook") instanceof PtyPane, "the terminal tile");
    const tile = desk.pane("Runbook") as PtyPane;
    await until(() => tile.text().join("\n").includes("Which herb?"), "the terminal prompt");
    await app.dispatch.act({ action: "tile.type", tile: "Runbook", args: { text: "sage\r" } }, USER);
    await until(() => formState()?.focus === "token", "the masked field", 10000);
    for (const ch of TOKEN) h.ch(ch);
    await until(() => !!app.bar?.items.some(i => i.row.key === "private-answer"), "masked answer row");
    expect(JSON.stringify(app.bar!.describe())).not.toContain(TOKEN);
    expect(app.bar!.draw(200, 60).lines.join("\n")).not.toContain(TOKEN);
    h.press({ kind: "enter" });
    await until(() => formState()?.focus === "run", "the form's run control");
    h.press({ kind: "enter" });
    await until(() => tile.exited === 0, "the masked command exits", 10000);
    let saved = "";
    for (let i = 0; i < 100; i++) {
      saved = (await board.get(steps[1]!.id))!.text;
      if (saved.includes("[run.last::ok]")) break;
      await Bun.sleep(50);
    }
    expect(saved).toContain("Token received: [redacted]");
    expect(saved).not.toContain(TOKEN);
    const first = (await board.get(steps[0]!.id))!.text;
    expect(first).toContain("Planting sage");
    expect(findOutputRegions(first)[0]!.body).toContain("[run.exit::0]");
    expect(desk.pane("Runbook")).toBe(tile);
    expect(formState()).toBeNull();
    await expect(app.dispatch.act({ action: "tile.restart", tile: "Runbook" }, USER)).rejects.toThrow("from the note");
    for (const path of files(h.scratch.root)) expect(readFileSync(path).includes(Buffer.from(TOKEN))).toBe(false);
    await app.dispatch.act({ action: "tile.close", tile: "Runbook" }, USER);
    const reader = desk.pane("reader") as ReaderPane;
    await until(() => { h.screen(); return reader.surface.describeElements().some(e => e.kind === "control" && e.label === "[run]"); }, "the embedded step control").catch(e => { throw new Error(`${e.message}\n${JSON.stringify(reader.surface.describeElements())}`); });
    const stepControl = reader.surface.describeElements().find(e => e.kind === "control" && e.label === "[run]")!;
    await app.dispatch.act({ action: "element.select", tile: "reader", args: { n: stepControl.n } }, USER);
    const keyed: string[] = [], done = traceActions(r => { keyed.push(r.name); });
    h.ch("x");
    await until(() => keyed.includes("ext.runbook.run-step"), "x dispatches the step action");
    done();
    await until(() => (desk.pane("Runbook") as PtyPane | undefined)?.text().join("\n").includes("Which herb?") ?? false, "the step runs from its key");
  }, 30000);
  test("a failed step pauses; continue uses the same tile and stop ends the next command", async () => {
    const { app, board, sc } = h;
    await app.dispatch.act({ action: "section", args: { name: "runbook" } }, USER);
    const book = await board.createBlock(null, "A walk with a failure [type::runbook]");
    const failed = await board.createBlock(book.id, "Fail visibly\nrun::\n```sh\nprintf 'the first failed\\n'; exit 7\n```");
    const last = await board.createBlock(book.id, "Wait for a line\nrun::\n```sh\nprintf 'waiting for a line\\n'; read -r line\n```");
    await app.dispatch.act({ action: "ext.runbook.run-all", args: { block: book.id } }, USER);
    await until(() => app.bar?.items.some(i => i.row.label === "continue") ?? false, "continue after failure");
    const tile = sc.tilesHere()!.pane("Runbook") as PtyPane;
    expect((await board.get(failed.id))!.text).toContain("[run.exit::7]");
    expect((await board.get(last.id))!.text).not.toContain("[run.last::");
    const ran: string[] = [];
    const untrace = traceActions(r => { ran.push(r.name); });
    h.press({ kind: "enter" });
    await until(() => tile.text().join("\n").includes("waiting for a line"), "continue starts the next step");
    untrace();
    expect(ran).toContain("runbook.continue");
    expect(sc.tilesHere()!.pane("Runbook")).toBe(tile);
    await app.dispatch.act({ action: "runbook.stop" }, USER);
    await until(() => tile.exited !== null, "stop ends the process");
    await app.dispatch.act({ action: "tile.close", tile: "Runbook" }, USER);
  }, 30000);

  test("a kept value remains literal shell data, confirmation is a form field, and successful close removes the tile", async () => {
    const { app, board, sc } = h;
    const book = await board.createBlock(null, "Remember a label [type::runbook]");
    const step = await board.createBlock(book.id, "Print the label\nrun:: --keep --confirm=print --close=on-success\n```sh\nprintf '%s\\n' {{ask.label}}; test -t 0\n```");
    await app.dispatch.act({ action: "ext.runbook.run-step", args: { block: step.id } }, USER);
    expect(formState()?.focus).toBe("label");
    const label = "sage; $(printf injected)";
    await app.dispatch.act({ action: "bar.form", args: { op: "set", field: "label", value: label } }, USER);
    expect(formState()?.focus).toBe("confirm");
    await app.dispatch.act({ action: "bar.form", args: { op: "set", field: "confirm", value: "wrong" } }, USER);
    await expect(app.dispatch.act({ action: "bar.form", args: { op: "run" } }, USER)).rejects.toThrow("type print");
    await app.dispatch.act({ action: "bar.form", args: { op: "set", field: "confirm", value: "print" } }, USER);
    await app.dispatch.act({ action: "bar.form", args: { op: "run" } }, USER);
    await until(() => !sc.tilesHere()!.pane("Runbook"), "close on success", 10000);
    expect((await board.get(book.id))!.properties).toContainEqual({ key: "label", value: label });
    expect((await board.get(step.id))!.text).toContain(label);
    expect((await board.get(step.id))!.text).toContain("[run.exit::0]");
  }, 30000);

  test("a step's choices and file picker pass selected values as literal environment data", async () => {
    const { app, board, scratch, sc } = h;
    const path = join(scratch.root, "garden seeds.txt");
    writeFileSync(path, "basil seeds");
    const step = await board.createBlock(null, "Pick seeds [choices::herb basil,mint] [form-field::path file]\nrun::\n```sh\nprintf '%s: ' {{ask.herb}}; cat {{ask.path}}\n```");
    await app.dispatch.act({ action: "ext.runbook.run-step", args: { block: step.id } }, USER);
    await until(() => app.bar?.items.some(i => i.row.label === "basil") ?? false, "the choice list");
    h.press({ kind: "enter" });
    await until(() => formState()?.focus === "path", "the file picker");
    for (const ch of scratch.root + "/") h.ch(ch);
    await until(() => app.bar?.items.some(i => i.row.label === "garden seeds.txt") ?? false, "the scratch file is listed");
    await app.dispatch.act({ action: "bar.pick", args: { n: app.bar!.items.findIndex(i => i.row.label === "garden seeds.txt") + 1 } }, USER);
    await until(() => formState()?.focus === "run", "the file has been chosen");
    h.press({ kind: "enter" });
    await until(() => (sc.tilesHere()!.pane("Runbook") as PtyPane | undefined)?.exited === 0, "the file command exits");
    let saved = "";
    for (let i = 0; i < 100; i++) { saved = (await board.get(step.id))!.text; if (saved.includes("[run.last::ok]")) break; await Bun.sleep(50); }
    expect(saved).toContain("basil: basil seeds");
  }, 30000);

  test("host mode uses the same masked form and records no secret in SQLite or door state", async () => {
    const { app, board, sc } = h;
    const step = await board.createBlock(null, "Print on the host\nrun:: --mode=host\n```sh\nprintf 'host: %s\\n' {{secret.token}}\n```");
    await app.dispatch.act({ action: "ext.runbook.run-step", args: { block: step.id } }, USER);
    for (const ch of TOKEN) h.ch(ch);
    await app.dispatch.act({ action: "bar.close" }, USER);
    expect(formState()).toBeNull();
    expect((await board.get(step.id))!.text).not.toContain("[run.last::");
    await app.dispatch.act({ action: "ext.runbook.run-step", args: { block: step.id } }, USER);
    for (const ch of TOKEN) h.ch(ch);
    await until(() => !!app.bar?.items.some(i => i.row.key === "private-answer"), "host token field");
    h.press({ kind: "enter" });
    await until(() => formState()?.focus === "run", "host run control");
    h.press({ kind: "enter" });
    let saved = "";
    for (let i = 0; i < 100; i++) { saved = (await board.get(step.id))!.text; if (saved.includes("[run.last::ok]")) break; await Bun.sleep(50); }
    expect(saved).toContain("host: [redacted]");
    expect(sc.tilesHere()!.pane("Runbook")).toBeUndefined();
    for (const path of files(h.scratch.root)) expect(readFileSync(path).includes(Buffer.from(TOKEN))).toBe(false);
  }, 30000);

  test("a host restart leaves the terminal running and Continue saves its result without rerunning the command", async () => {
    const { app, board, sc, scratch } = h;
    const count = join(scratch.root, "ran-once");
    const step = await board.createBlock(null, `Survive the host restart\nrun::\n\`\`\`sh\nprintf x >> '${count}'; printf 'ready for host restart\\n'; read -r line; printf 'finished once\\n'\n\`\`\``);
    await app.dispatch.act({ action: "ext.runbook.run-step", args: { block: step.id } }, USER);
    const tile = sc.tilesHere()!.pane("Runbook") as PtyPane;
    await until(() => tile.text().join("\n").includes("ready for host restart"), "the command started");
    await scratch.stop();
    await app.dispatch.act({ action: "tile.type", tile: "Runbook", args: { text: "done\r" } }, USER);
    await until(() => app.bar?.items.some(i => i.row.label === "continue") ?? false, "the unsaved result offers Continue", 15000);
    await scratch.start();
    await board.info();
    h.press({ kind: "enter" });
    let saved = "";
    for (let i = 0; i < 100; i++) { saved = (await board.get(step.id))!.text; if (saved.includes("[run.last::ok]")) break; await Bun.sleep(50); }
    expect(saved).toContain("finished once");
    expect(readFileSync(count, "utf8")).toBe("x");
  }, 45000);

  test("SSH receives values through its terminal input, and an unreachable machine leaves a pasteable waiting step without secrets", async () => {
    const { app, board, sc, scratch } = h;
    const bin = join(scratch.root, "remote-bin"), home = join(scratch.root, "remote-home");
    mkdirSync(bin); mkdirSync(home);
    const ssh = join(bin, "ssh");
    writeFileSync(ssh, `#!/bin/sh\nexec ${process.execPath} ${join(outliner!, "test/fake-ssh.ts")} "$@"\n`);
    chmodSync(ssh, 0o755);
    const env = { EP0CH_SSH: ssh, EP0CH_OUTLINES: scratch.outlines, FAKE_SSH_HOME: home, FAKE_SSH_OUTLINES: scratch.outlines, FAKE_SSH_BIN: bin, FAKE_SSH_LOG: join(scratch.root, "ssh.log"), FAKE_SSH_DOWN: "0" };
    const old = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
    Object.assign(process.env, env);
    try {
      const book = await board.createBlock(null, "Run on the other machine [type::runbook]");
      const step = await board.createBlock(book.id, "A remote token\nrun:: --on=box-garden\n```sh\nprintf 'remote: %s\\n' {{secret.token}}; test -t 0\n```");
      const start = async () => {
        await app.dispatch.act({ action: "ext.runbook.run-step", args: { block: step.id } }, USER);
        for (const ch of TOKEN) h.ch(ch);
        await until(() => !!app.bar?.items.some(i => i.row.key === "private-answer"), "remote token field");
        h.press({ kind: "enter" });
        await until(() => formState()?.focus === "run", "remote run control");
        h.press({ kind: "enter" });
      };
      await start();
      await until(() => (sc.tilesHere()!.pane("Runbook") as PtyPane | undefined)?.exited === 0, "remote terminal exits", 10000);
      let text = "";
      for (let i = 0; i < 100; i++) { text = (await board.get(step.id))!.text; if (text.includes("remote: [redacted]")) break; await Bun.sleep(50); }
      expect(text).toContain("remote: [redacted]");
      expect(readFileSync(env.FAKE_SSH_LOG, "utf8")).not.toContain(TOKEN);
      await app.dispatch.act({ action: "tile.close", tile: "Runbook" }, USER);
      process.env.FAKE_SSH_DOWN = "1";
      await start();
      await until(() => app.bar?.items.some(i => i.row.label === "continue") ?? false, "waiting for remote machine", 10000);
      text = (await board.get(step.id))!.text;
      expect(text).toContain("[run.last::waiting]");
      expect(text).toContain("Shown to paste on box-garden:");
      expect(text).not.toContain(TOKEN);
      await app.dispatch.act({ action: "runbook.stop" }, USER);
      await app.dispatch.act({ action: "bar.close" }, USER);
      await app.dispatch.act({ action: "tile.close", tile: "Runbook" }, USER);
    } finally {
      for (const [k, v] of Object.entries(old)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  }, 30000);

});
