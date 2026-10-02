// `ep0ch install` and `ep0ch doctor` progress (src/setup/progress.ts): the live frames at a terminal, plain
// lines without escapes, --json unchanged, the redraw throttle, Ctrl+C, the child's output streamed as it
// arrives, and a whole --apply in a scratch home (fictional databases; nothing real is read or written).
import { Database } from "bun:sqlite";
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setupCommand } from "../src/setup/apply";
import { run } from "../src/setup/facts";
import { ASCII_SPINNER, bar, elapsed, FRAME_MS, Progress, progressMode, size, SPINNER, spinnerFor, type Terminal } from "../src/setup/progress";
import { visible, width } from "../src/style";

const scratch = mkdtempSync(join(tmpdir(), "ep0ch-progress-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const ESC = /\x1b/;

/** A terminal that records what's written, and a hand-driven clock and redraw timer. */
function rig(o: { columns?: number; env?: Record<string, string> } = {}) {
  const writes: string[] = [];
  const lines: string[] = [];
  let t = 0;
  let tick: (() => void) | null = null;
  const terminal: Terminal = { isTTY: true, columns: o.columns ?? 80, write: s => { writes.push(s); } };
  const progress = new Progress({ mode: "live", out: s => lines.push(s), terminal, env: o.env ?? {}, now: () => t,
    every: fn => { tick = fn; return () => { tick = null; }; } });
  return {
    progress, writes, lines,
    advance(ms: number) { t += ms; tick?.(); },
    get ticking() { return tick !== null; },
    /** The last frame written, as a person reads it (colours gone, cursor moves gone). */
    last: () => visible(writes.at(-1)!).replace(/\x1b\[\?25[lh]|\x1b\[\d*[AB]|\r|\x1b\[2?[JK]/g, ""),
  };
}

describe("at a terminal", () => {
  test("a running step spins with its time, the child's line under it, then becomes its timed ✓", () => {
    const r = rig();
    const task = r.progress.task({ lead: "2", mark: "→", title: "Update the Outliner plugin (managed by Herdr)", body: ["    installed 239aaaa, main is at 246bbbb"] });
    expect(r.last()).toBe(`2 ${SPINNER[0]} Update the Outliner plugin (managed by Herdr) · 0.0s\n    installed 239aaaa, main is at 246bbbb`);
    expect(r.writes[0]).toStartWith("\x1b[?25l");
    task.child("Cloning into 'pi-herdr-outliner'...");
    r.advance(14_000);
    expect(r.last()).toBe(`2 ${SPINNER[1]} Update the Outliner plugin (managed by Herdr) · 14s\n    installed 239aaaa, main is at 246bbbb\n    Cloning into 'pi-herdr-outliner'...`);
    // Each redraw goes back to the step's line first: up over the lines drawn before, and clears below.
    expect(r.writes.at(-1)).toStartWith("\x1b[1A\r");
    task.child("\x1b[32mbuilt\x1b[0m in 3.1s\r");
    r.advance(24_000);
    expect(r.writes.at(-1)).toStartWith("\x1b[2A\r");
    task.say("    ✓ reinstalled float-ritual-stack/pi-herdr-outliner@main at 246bbbb");
    task.end(true);
    const final = r.writes.at(-2)!;
    // Fewer lines than were drawn (the child's line goes): the rows below are cleared, after the last line.
    expect(visible(final).replaceAll("\x1b[K", "")).toBe("\x1b[2A\r2 ✓ Update the Outliner plugin (managed by Herdr) · 38s\n    installed 239aaaa, main is at 246bbbb\n    ✓ reinstalled float-ritual-stack/pi-herdr-outliner@main at 246bbbb\n");
    expect(r.writes.at(-1)).toBe("\x1b[?25h");
    expect(r.ticking).toBe(false);
  });

  test("the child's line is dimmed, its escapes taken out, and every running line cut to the terminal's width", () => {
    const r = rig({ columns: 40 });
    const task = r.progress.task({ lead: "3", mark: "→", title: "Update the door checkout, a title longer than forty cells" });
    task.child(`remote: ${"x".repeat(100)}\x1b]52;c;aGk=\x07`);
    r.advance(FRAME_MS);
    const frame = r.writes.at(-1)!;
    expect(frame).toContain("\x1b[38;2;"); // the door's palette: dark grey for the child, cyan for the spinner
    expect(frame).not.toContain("\x1b]52");
    for (const l of r.last().split("\n")) expect(width(l)).toBeLessThanOrEqual(37);
    expect(r.last().split("\n")[1]).toEndWith("…");
  });

  test("items count up, with a bar when their sizes are known", () => {
    const r = rig();
    const task = r.progress.task({ lead: "1", mark: "→", title: "Back up every local outline database" });
    task.count(3, 9, `seed-library ${size(41_200_000)}`, { done: 2, total: 3 });
    task.flush();
    expect(r.last()).toBe(`1 ${SPINNER[0]} Back up every local outline database · 0.0s\n    [████████░░░░] 3/9 · seed-library 41 MB`);
    task.count(4, 9, "seed-library");
    task.flush();
    expect(r.last().split("\n")[1]).toBe("    4/9 · seed-library");
  });

  test("a chatty child can't flood the terminal: one redraw per frame, whatever it prints", () => {
    const r = rig();
    const task = r.progress.task({ lead: "2", mark: "→", title: "Update the Outliner plugin" });
    const before = r.writes.length;
    for (let i = 0; i < 10_000; i++) task.child(`compiling module ${i}`);
    expect(r.writes.length).toBe(before);
    for (let i = 0; i < 5; i++) r.advance(FRAME_MS);
    expect(r.writes.length).toBe(before + 5);
    expect(r.last()).toContain("compiling module 9999");
    task.end(true);
  });

  test("a phase (checking the stack) leaves nothing behind", () => {
    const r = rig();
    const phase = r.progress.task({ mark: "·", title: "Checking the stack", transient: true });
    phase.count(5, 8, "waiting on the door checkout");
    phase.child("door: Receiving objects:  45% (90/200)");
    r.advance(3_000);
    expect(r.last()).toBe(`${SPINNER[1]} Checking the stack · 3.0s\n    5/8 · waiting on the door checkout\n    door: Receiving objects:  45% (90/200)`);
    phase.end(true);
    expect(r.writes.slice(-2)).toEqual(["\x1b[2A\r\x1b[2K\x1b[1B\x1b[2K\x1b[1B\x1b[2K\x1b[2A", "\x1b[?25h"]);
    expect(r.lines).toEqual([]);
  });

  test("Ctrl+C: the step's line says it was interrupted, the cursor comes back, and which step it was is returned", () => {
    const r = rig();
    r.progress.task({ lead: "2", mark: "→", title: "Update the Outliner plugin" });
    r.advance(14_000);
    const head = r.progress.interrupt();
    expect(head).toMatchObject({ lead: "2", title: "Update the Outliner plugin" });
    expect(visible(r.writes.at(-2)!)).toContain("2 ✗ Update the Outliner plugin · interrupted after 14s");
    expect(r.writes.at(-1)).toBe("\x1b[?25h");
    expect(r.ticking).toBe(false);
  });

  test("NO_COLOR: still redrawn in place, but no colour", () => {
    const r = rig({ env: { NO_COLOR: "1" } });
    const task = r.progress.task({ lead: "2", mark: "→", title: "Update the Outliner plugin" });
    task.child("Cloning");
    r.advance(FRAME_MS);
    task.end(false);
    const all = r.writes.join("");
    expect(all).not.toMatch(/\x1b\[[\d;]*m/);
    expect(all).toContain("\x1b[1A\r");
    expect(all).toContain("2 ✗ Update the Outliner plugin · ");
  });
});

describe("the mode and the glyphs", () => {
  const tty: Terminal = { isTTY: true, write: () => {} };
  test("live only at a TTY; piped, CI and dumb terminals get plain lines; --json gets nothing", () => {
    expect(progressMode({ json: false, terminal: tty, env: {} })).toBe("live");
    expect(progressMode({ json: false, terminal: { ...tty, isTTY: false }, env: {} })).toBe("plain");
    expect(progressMode({ json: false, env: {} })).toBe("plain");
    expect(progressMode({ json: false, terminal: tty, env: { CI: "true" } })).toBe("plain");
    expect(progressMode({ json: false, terminal: tty, env: { TERM: "dumb" } })).toBe("plain");
    expect(progressMode({ json: true, terminal: tty, env: {} })).toBe("quiet");
  });

  test("braille where the font has it; | / - \\ on a dumb terminal or where the door draws in cells", () => {
    expect(spinnerFor({ TERM: "xterm-kitty" })).toBe(SPINNER);
    expect(spinnerFor({ TERM: "dumb" })).toBe(ASCII_SPINNER);
    expect(spinnerFor({ EP0CH_KITTY: "0" })).toBe(ASCII_SPINNER);
  });

  test("times, sizes and bars", () => {
    expect([elapsed(400), elapsed(9_960), elapsed(14_000), elapsed(125_000)]).toEqual(["0.4s", "10.0s", "14s", "2m 05s"]);
    expect([size(512), size(41_200_000), size(2_400_000_000)]).toEqual(["512 B", "41 MB", "2.4 GB"]);
    expect([bar(0, 9), bar(9, 9), bar(1, 0)]).toEqual([`[${"░".repeat(12)}]`, `[${"█".repeat(12)}]`, `[${"░".repeat(12)}]`]);
  });

  test("plain: the lines as before, no escapes; a child's output and counts aren't printed", () => {
    const lines: string[] = [];
    const p = new Progress({ mode: "plain", out: s => lines.push(s), env: {} });
    const task = p.task({ lead: "1", mark: "→", title: "Back up every local outline database", body: ["    before anything changes"] });
    task.child("noise"); task.count(1, 2, "seed-library"); task.say("    ✓ seed-library: a → b (integrity ok)"); task.end(true);
    p.task({ mark: "·", title: "Checking the stack", transient: true }).end(true);
    expect(lines).toEqual(["1 → Back up every local outline database", "    before anything changes", "    ✓ seed-library: a → b (integrity ok)"]);
    expect(lines.join("\n")).not.toMatch(ESC);
  });
});

test("a child's output reaches the line as it arrives, not when it exits", async () => {
  const seen: { line: string; at: number }[] = [];
  const start = Date.now();
  const r = await run(["sh", "-c", "printf 'Cloning into x...\\n'; sleep 0.4; printf 'Receiving objects: 50%%\\rReceiving objects: 100%%\\n' >&2; sleep 0.2"],
    { onLine: line => seen.push({ line, at: Date.now() - start }) });
  expect(r.code).toBe(0);
  expect(r.out).toBe("Cloning into x...");
  expect(seen[0]!.line).toBe("Cloning into x...");
  expect(seen[0]!.at).toBeLessThan(350);
  expect(seen.at(-1)!.line).toBe("Receiving objects: 100%");
});

describe("the whole command, in a scratch home", () => {
  /** A fictional home: two outline databases, ~/.local/bin on PATH, a door that isn't a git checkout. */
  function home(name: string) {
    const h = join(scratch, name);
    const outlines = join(h, ".local/state/pi-herdr-outliner/outlines");
    mkdirSync(outlines, { recursive: true });
    mkdirSync(join(h, ".local/bin"), { recursive: true });
    mkdirSync(join(h, "door/src"), { recursive: true });
    writeFileSync(join(h, "door/src/main.ts"), "");
    for (const n of ["field-notes", "seed-library"]) {
      const db = new Database(join(outlines, `${n}.sqlite`));
      db.run("CREATE TABLE notes (id TEXT, body TEXT)");
      db.run("INSERT INTO notes VALUES ('n1', 'a fictional note')");
      db.close();
    }
    const env = { HOME: h, PATH: [join(h, ".local/bin"), dirname(process.execPath), "/usr/bin", "/bin"].join(":"), TERM: "xterm-256color" };
    return { h, env, doorRoot: join(h, "door") };
  }

  test("--json is unchanged by a terminal: nothing drawn, the same JSON", async () => {
    const { env, doorRoot } = home("json");
    const drawn: string[] = [];
    const terminal: Terminal = { isTTY: true, columns: 80, write: s => { drawn.push(s); } };
    const a: string[] = [], b: string[] = [];
    expect(await setupCommand(["install", "--json"], { out: s => a.push(s), err: s => a.push(s), env, doorRoot, platform: "linux", terminal })).toBe(0);
    expect(await setupCommand(["install", "--json"], { out: s => b.push(s), err: s => b.push(s), env, doorRoot, platform: "linux" })).toBe(0);
    expect(drawn).toEqual([]);
    expect(a).toHaveLength(1);
    expect(a.join("")).not.toMatch(ESC);
    const plan = (s: string) => JSON.parse(s).steps.map((x: { id: string; status: string }) => `${x.id}:${x.status}`);
    expect(plan(a[0]!)).toEqual(plan(b[0]!));
  });

  test("doctor at a terminal: the check spins, then goes; the report follows as before", async () => {
    const { env, doorRoot } = home("doctor");
    const drawn: string[] = [];
    const out: string[] = [];
    const terminal: Terminal = { isTTY: true, columns: 80, write: s => { drawn.push(s); } };
    await setupCommand(["doctor"], { out: s => out.push(s), err: s => out.push(s), env, doorRoot, platform: "linux", terminal });
    expect(visible(drawn.join(""))).toContain("Checking the stack · ");
    expect(drawn.at(-1)).toBe("\x1b[?25h");
    expect(out.join("\n")).toStartWith("ep0ch doctor · linux · ~");
    expect(out.join("\n")).not.toMatch(ESC);
  });

  test("--apply at a terminal: each step counts its items and ends timed; piped, the same lines without escapes", async () => {
    const live = home("apply-live");
    const drawn: string[] = [];
    const errs: string[] = [];
    const terminal: Terminal = { isTTY: true, columns: 100, write: s => { drawn.push(s); } };
    const now = new Date("2026-03-14T09:26:53Z");
    expect(await setupCommand(["install", "--apply"], { out: () => {}, err: s => errs.push(s), env: live.env, doorRoot: live.doorRoot, platform: "linux", now, terminal })).toBe(0);
    expect(errs).toEqual([]);
    const screen = visible(drawn.join("")).replaceAll("\x1b[K", "");
    expect(screen).toContain("    [░░░░░░░░░░░░] 0/2 · field-notes");
    expect(screen).toMatch(/1 ✓ Back up every local outline database · \d+\.\ds\n/);
    expect(screen).toMatch(/4 ✓ Put ep0ch on PATH · \d+\.\ds\n/);
    expect(screen).toContain("2 ! Update the Outliner plugin");
    expect(readdirSync(join(live.h, "backups/ep0ch")).sort()).toEqual(["field-notes-20260314T092653Z.sqlite", "seed-library-20260314T092653Z.sqlite"]);
    expect(lstatSync(join(live.h, ".local/bin/ep0ch")).isSymbolicLink()).toBe(true);

    const piped = home("apply-piped");
    const out: string[] = [];
    expect(await setupCommand(["install", "--apply"], { out: s => out.push(s), err: s => out.push(s), env: piped.env, doorRoot: piped.doorRoot, platform: "linux", now, terminal: { isTTY: false, write: () => { throw new Error("not a terminal"); } } })).toBe(0);
    const text = out.join("\n");
    expect(text).not.toMatch(ESC);
    expect(text).toContain("1 → Back up every local outline database\n");
    expect(text).toContain("    ✓ field-notes: ~/.local/state/pi-herdr-outliner/outlines/field-notes.sqlite → ~/backups/ep0ch/field-notes-20260314T092653Z.sqlite (integrity ok)");
    expect(existsSync(join(piped.h, ".local/bin/ep0ch"))).toBe(true);
  });
});
