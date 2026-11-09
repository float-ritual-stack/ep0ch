import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { findOutputRegions } from "@ep0ch/outline-core/output-region";
import { ReaderPane } from "../../src/desk/panes";
import { outliner, ScratchHost, until } from "../scratch";
import { useShowcaseScreen } from "./harness";

describe.skipIf(!outliner)("sh:: lines in the showcase", () => {
  const h = useShowcaseScreen();
  const actor = { kind: "agent", id: "garden-helper" } as const;
  const act = (action: string, args = {}, tile?: string) => h.app.dispatch.act({ action, args, ...(tile ? { tile } : {}) }, actor);

  test("a shell line owns replaceable output, keeps edits, and explains failed commands and formatters", async () => {
    await h.app.dispatch.act({ action: "section", args: { name: "sh-lines" } }, { kind: "user" });
    await until(() => h.screen().includes("Shell lines keep their output"), "runbook reader");
    await h.app.dispatch.act({ action: "section.try" }, { kind: "user" });
    writeFileSync(join(h.scratch.root, "beds.md"), "Garden beds\n");
    const note = await h.board.createBlock(null, `Garden files [cwd::${h.scratch.root}]\n\nsh:: ls *.md | sed 's/.*/&/' | as files`);
    const reader = h.sc.tilesHere()!.pane("reader") as ReaderPane;
    reader.show(note, h.sc.tilesHere()!);
    h.screen();
    expect(h.screen()).toContain("ls *.md | sed 's/.*/&/' | as files");
    const run = () => act("ext.runbook.run-sh", { block: note.id, line: 2 });
    await run();
    let saved = (await h.board.get(note.id))!;
    expect(findOutputRegions(saved.text)[0]?.body).toContain(`- [file::${join(h.scratch.root, "beds.md")}]`);
    await until(() => h.screen().includes("as of") && h.screen().includes("run again"), "the shell output's provenance");
    writeFileSync(join(h.scratch.root, "seeds.md"), "Garden seeds\n");
    await run();
    saved = (await h.board.get(note.id))!;
    expect(findOutputRegions(saved.text)).toHaveLength(1);
    expect(findOutputRegions(saved.text)[0]!.body).toContain("seeds.md");
    await h.board.update(note.id, saved.text.replace("> - [file::", "> My own words\n> - [file::"), saved.revision!);
    await expect(run()).rejects.toThrow("edited");
    expect((await h.board.get(note.id))!.text).toContain("My own words");
    await h.app.dispatch.act({ action: "ext.runbook.run-sh", args: { block: note.id, line: 2 } }, { kind: "user" });
    await until(() => h.app.bar?.scope === "ask", "confirmation beside the edited output");
    expect(h.app.bar!.draw(200, 60).lines.join("\n")).toContain("This output was edited");
    h.press({ kind: "paste", text: "Replace output" });
    await until(() => h.app.bar?.items.some(i => i.row.data === "Replace output") ?? false, "replace choice");
    h.press({ kind: "enter" });
    for (let end = Date.now() + 10000; (await h.board.get(note.id))!.text.includes("My own words");) {
      if (Date.now() > end) throw new Error("confirmed replacement did not arrive");
      await Bun.sleep(30);
    }
    saved = (await h.board.get(note.id))!;
    await h.board.update(note.id, saved.text.replace("> - [file::", "> My own words\n> - [file::"), saved.revision!);
    await act("ext.runbook.keep-sh", { block: note.id, line: 2 });
    saved = (await h.board.get(note.id))!;
    expect(findOutputRegions(saved.text)).toHaveLength(0);
    expect(saved.text).toContain("\nMy own words\n");
    await h.board.update(note.id, "Garden failure\n\nsh:: printf 'bad pot\\n' >&2; exit 2", saved.revision!);
    await expect(run()).rejects.toThrow("exit 2: bad pot");
    saved = (await h.board.get(note.id))!;
    expect(findOutputRegions(saved.text)).toHaveLength(0);
    await until(() => h.screen().includes("exit 2: bad pot"), "failure beside the line");
    await h.board.update(note.id, "Garden formatter\n\nsh:: printf beds | as nothere", saved.revision!);
    await expect(run()).rejects.toThrow(/script.*nothere.*(nearest|mean|Scripts)/i);
    expect(findOutputRegions((await h.board.get(note.id))!.text)).toHaveLength(0);
  }, 45000);

  test("a step's ep0ch --machine reaches that machine, over the socket the host hands it (PIE-1643)", async () => {
    // The other machine: a scratch host behind the fake ssh, holding an outline this one doesn't.
    const far = new ScratchHost();
    await far.start();
    await far.create("far-orchard");
    const bin = join(h.scratch.root, "fake-bin");
    mkdirSync(bin, { recursive: true });
    const main = resolve(import.meta.dir, "../../src/main.ts");
    writeFileSync(join(bin, "ssh"), `#!/bin/sh\nexec ${process.execPath} ${join(outliner!, "test", "fake-ssh.ts")} "$@"\n`);
    writeFileSync(join(bin, "ep0ch"), `#!/bin/sh\nexec ${process.execPath} ${main} "$@"\n`);
    // A step gets the host's variables, not the test's: this wrapper says which ssh is the fake one.
    const fake = { EP0CH_SSH: join(bin, "ssh"), FAKE_SSH_BIN: bin, FAKE_SSH_HOME: join(h.scratch.root, "far-home"), FAKE_SSH_OUTLINES: far.outlines,
      FAKE_SSH_LOG: join(h.scratch.root, "ssh.log"), FAKE_SSH_OWNER_FILE: process.env.FAKE_SSH_OWNER_FILE! };
    mkdirSync(fake.FAKE_SSH_HOME, { recursive: true });
    writeFileSync(join(bin, "ep0ch-step"), `#!/bin/sh\n${Object.entries(fake).map(([k, v]) => `export ${k}='${v}'`).join("\n")}\nexec ${process.execPath} ${main} "$@"\n`);
    for (const f of ["ssh", "ep0ch", "ep0ch-step"]) chmodSync(join(bin, f), 0o755);
    try {
      const note = await h.board.createBlock(null, `Orchard on box-a\n\nsh:: printenv EP0CH_SOCKET\n\nsh:: ${join(bin, "ep0ch-step")} outline list --machine box-a --json`);
      await act("ext.runbook.run-sh", { block: note.id, line: 2 });
      expect(findOutputRegions((await h.board.get(note.id))!.text)[0]?.body).toContain(".sock");
      const at = (await h.board.get(note.id))!.text.split("\n").findIndex(l => l.includes("--machine box-a"));
      await act("ext.runbook.run-sh", { block: note.id, line: at });
      const regions = findOutputRegions((await h.board.get(note.id))!.text);
      expect(regions.at(-1)?.body).toContain("far-orchard");
    } finally {
      try { process.kill(Number(readFileSync(join(h.scratch.outlines, ".remote", "box-a.ctl"), "utf8"))); } catch { /* not started */ }
      await far.dispose();
    }
  }, 45000);

  test("stale shell opens warn once per read and leave the host answering", async () => {
    await h.board.request("extensions.install", { extension: "runbook", where: "outline" });
    const note = await h.board.createBlock(null, "Old shell note\n\nsh:: true");
    await h.board.request("delete", { blockId: note.id });
    await h.board.request("resources.projection.read", { blockId: note.id, opened: true });
    await h.board.request("trash.purge", { blockId: note.id, confirmation: note.id.slice(0, 8) });
    for (let i = 0; i < 6; i++) {
      await expect(h.board.request("resources.projection.read", { blockId: note.id, opened: true })).rejects.toThrow("Block not found");
    }
    await h.board.info();
    const log = readFileSync(join(h.scratch.root, "host.log"), "utf8");
    expect(log).not.toContain("unhandled rejection");
    expect(log.split("\n").filter(line => line.startsWith("outliner:") && line.includes(note.id) && line.includes("Block not found"))).toHaveLength(6);
    expect((await h.board.createBlock(null, "Garden host still answers")).text).toBe("Garden host still answers");
  }, 15000);
});
