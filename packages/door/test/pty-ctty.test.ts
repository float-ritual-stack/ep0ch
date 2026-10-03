// A terminal tile's program has the tile's pty as its controlling terminal: a resize reaches it as SIGWINCH,
// and ctrl+z stops a shell's job (review B F13). Linux does it with `setsid -c`, macOS with a perl launcher.
// Where neither is there, the real-pty tests are skipped. Only `sh`, `bash`, `stty` and `sleep` run.
import { describe, expect, test } from "bun:test";
import { cttyPrefix, PERL_CTTY, PtyPane } from "../src/desk/pty";
import { until } from "./scratch";

const has = (have: string[]) => (b: string) => (have.includes(b) ? `/usr/bin/${b}` : null);

describe("how a tile's program gets its controlling terminal", () => {
  test("Linux uses setsid -c; with no setsid, nothing (perl's TIOCSCTTY number is the BSDs')", () => {
    expect(cttyPrefix(has(["setsid", "perl"]), "linux")).toEqual(["/usr/bin/setsid", "-c"]);
    expect(cttyPrefix(has(["perl"]), "linux")).toBeNull();
  });
  test("macOS uses the perl launcher, which keeps the command's own arguments after --", () => {
    expect(cttyPrefix(has(["perl"]), "darwin")).toEqual(["/usr/bin/perl", "-e", PERL_CTTY, "--"]);
    expect(PERL_CTTY).toContain("0x20007461");
    expect(cttyPrefix(has([]), "darwin")).toBeNull();
  });
});

const screen = (p: PtyPane, w: number, h: number) =>
  p.render(w, h, false, { redraw() {} } as any).lines.map(l => l.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")).join("\n");

describe.skipIf(!cttyPrefix())("a tile's program on a real pty", () => {
  test("a resize reaches the program as SIGWINCH, and it reads the new size", async () => {
    const p = new PtyPane({ cmd: ["sh", "-c", `trap 'echo "size $(stty size)"' WINCH; echo "size $(stty size)"; while :; do sleep 0.1; done`], label: "sh" });
    try {
      await until(() => screen(p, 40, 6).includes("size 6 40"), "the first size", 5000);
      await until(() => screen(p, 57, 9).includes("size 9 57"), "the new size, told by SIGWINCH", 5000);
    } finally { p.dispose(); }
  }, 15_000);

  test.skipIf(!Bun.which("bash"))("ctrl+z stops a shell's job and fg brings it back", async () => {
    const p = new PtyPane({ cmd: ["bash", "--norc", "--noprofile", "-i"], label: "bash" });
    try {
      screen(p, 60, 10);
      await Bun.sleep(300);
      p.input("PS1='$ '; sleep 30\r");
      await Bun.sleep(400);
      p.input("\x1a");
      await until(() => /Stopped/.test(screen(p, 60, 10)), "the job to stop", 5000);
      p.input("fg\r");
      await until(() => screen(p, 60, 10).includes("sleep 30\n") || /\$ fg\s*\n\s*sleep 30/.test(screen(p, 60, 10)), "fg to resume it", 5000);
      p.input("\x03echo back-$((1+1))\r");
      await until(() => screen(p, 60, 10).includes("back-2"), "the shell to have its keys again", 5000);
    } finally { p.dispose(); }
  }, 15_000);
});
