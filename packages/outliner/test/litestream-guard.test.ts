// The Litestream guard (PIE-607): a change to an outline's file is made with this machine's replicator for it
// stopped, and started again after; a replicator it can't stop refuses the change with the commands. A scratch home
// with fictional unit files and configs, and a fake systemctl: no real unit is asked or touched.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { metaDir, replicatorsFor, withLitestreamPaused } from "../src/litestream-guard";
import { instancesIn, litestreamUnits, templateInstance } from "../src/litestream-units";

const root = mkdtempSync(join(tmpdir(), "litestream-guard-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const home = join(root, "home"), outlines = join(root, "outlines"), elsewhere = join(root, "elsewhere");
mkdirSync(join(home, ".config/systemd/user"), { recursive: true });
mkdirSync(outlines, { recursive: true });
writeFileSync(join(home, "litestream.yml"), `dbs:\n  - dir: ${outlines}\n    pattern: "*.sqlite"\n    watch: true\n    replica:\n      type: file\n      path: ${root}/replica\n`);
writeFileSync(join(home, ".config/systemd/user/litestream.service"), `[Service]\nExecStart=%h/.local/bin/litestream replicate -config %h/litestream.yml\n`);
writeFileSync(join(home, ".config/systemd/user/litestream-mirror@.service"), `[Service]\nExecStart=%h/.local/bin/litestream restore -f -config %h/m.yml %h/outline-mirrors/laptop/%i.sqlite\n`);

/** A fake systemctl: the replicator's state, and every call made. */
function fakeSystemd(state: { active: boolean; stopFails?: boolean }) {
  const calls: string[] = [];
  const run = (argv: string[]) => {
    calls.push(argv.slice(1).join(" "));
    if (argv[2] === "is-active") return { code: state.active ? 0 : 3, out: state.active ? "active" : "inactive" };
    if (argv[2] === "stop") { if (state.stopFails) return { code: 1, out: "Failed to stop litestream.service: Access denied" }; state.active = false; return { code: 0, out: "" }; }
    if (argv[2] === "start") { state.active = true; return { code: 0, out: "" }; }
    return { code: 1, out: "?" };
  };
  return { run, calls };
}
const o = (run: ReturnType<typeof fakeSystemd>["run"]) => ({ platform: "linux" as const, home, run, env: {} });

describe("the Litestream guard", () => {
  test("only the replicator whose config names the outline's folder", () => {
    expect(replicatorsFor([join(outlines, "garden.sqlite")], { platform: "linux", home, env: {} }).map(u => u.name)).toEqual(["litestream.service"]);
    expect(replicatorsFor([join(elsewhere, "garden.sqlite")], { platform: "linux", home, env: {} })).toEqual([]);
  });

  test("stopped for the change, started after; two changes at once share one stop", async () => {
    const sd = fakeSystemd({ active: true });
    const order: string[] = [];
    await withLitestreamPaused([join(outlines, "garden.sqlite")], "deleting garden", async () => {
      order.push(`change while active=${sd.calls.includes("--user stop litestream.service")}`);
      await withLitestreamPaused([join(outlines, "pantry.sqlite")], "deleting pantry", () => { order.push("nested"); }, o(sd.run));
    }, o(sd.run));
    expect(order).toEqual(["change while active=true", "nested"]);
    expect(sd.calls.filter(c => c.includes("stop") || c.includes("start"))).toEqual(["--user stop litestream.service", "--user start litestream.service"]);
  });

  test("started again even when the change fails", async () => {
    const sd = fakeSystemd({ active: true });
    await expect(withLitestreamPaused([join(outlines, "garden.sqlite")], "deleting garden", () => { throw new Error("disk full"); }, o(sd.run))).rejects.toThrow("disk full");
    expect(sd.calls.at(-1)).toBe("--user start litestream.service");
  });

  test("a stopped replicator is left stopped; a scratch folder touches nothing", async () => {
    const sd = fakeSystemd({ active: false });
    expect(await withLitestreamPaused([join(outlines, "garden.sqlite")], "x", () => 7, o(sd.run))).toBe(7);
    expect(sd.calls).toEqual(["--user is-active litestream.service"]);
    const none = fakeSystemd({ active: true });
    await withLitestreamPaused([join(elsewhere, "garden.sqlite")], "x", () => {}, o(none.run));
    expect(none.calls).toEqual([]);
  });

  test("one it can't stop refuses the change, with the commands, and keeps the meta folder", async () => {
    const sd = fakeSystemd({ active: true, stopFails: true });
    let ran = false;
    const refused = withLitestreamPaused([join(outlines, "garden.sqlite")], "deleting the outline garden", () => { ran = true; }, o(sd.run));
    await expect(refused).rejects.toThrow("systemctl --user stop litestream.service, then deleting the outline garden again, then systemctl --user start litestream.service");
    await expect(refused).rejects.toThrow("never litestream reset");
    expect(ran).toBe(false);
    expect(metaDir(join(outlines, "garden.sqlite"))).toBe(join(outlines, ".garden.sqlite-litestream"));
  });

  test("a template unit is its instances", () => {
    const tpl = litestreamUnits("linux", home).find(u => u.name === "litestream-mirror@.service")!;
    const names = instancesIn("litestream-mirror@float-hub.service loaded active running x\nlitestream-mirror@notes.service loaded active running y\nother.service loaded", tpl.name);
    expect(names).toEqual(["float-hub", "notes"]);
    expect(templateInstance(tpl, "notes")).toMatchObject({ name: "litestream-mirror@notes.service", output: join(home, "outline-mirrors/laptop/notes.sqlite") });
  });
});
