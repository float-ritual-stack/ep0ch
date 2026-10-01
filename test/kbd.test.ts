// Shift+Enter: the Kitty keyboard protocol on both sides of the door (src/kbd.ts). The door asks its terminal
// for the protocol and gives it back on every exit and suspend; reads its key reports as keys; and hands a
// terminal tile's program the person's keys as that program asked: the protocol, or legacy bytes.
import { afterEach, describe, expect, test } from "bun:test";
import { KBD_POP, KBD_PUSH, KbdModes, keyBytes, legacyBytes, parseReport, rawKey, reportKey, translateReports } from "../src/kbd";
import { TERM_RESET, Term, type Key } from "../src/term";
import { PtyPane } from "../src/desk/pty";

const key = (seq: string) => { const r = parseReport(seq); return r ? reportKey(r) : null; };

describe("reading key reports", () => {
  test("Enter with shift, ctrl or alt; Esc; tab and backspace", () => {
    expect(key("\x1b[13;2u")).toEqual({ kind: "enter", shift: true });
    expect(key("\x1b[13;5u")).toEqual({ kind: "enter", ctrl: true });
    expect(key("\x1b[13;3u")).toEqual({ kind: "alt-enter" });
    expect(key("\x1b[13u")).toEqual({ kind: "enter" });
    expect(key("\x1b[27u")).toEqual({ kind: "esc" });
    expect(key("\x1b[9;2u")).toEqual({ kind: "backtab" });
    expect(key("\x1b[127;3u")).toEqual({ kind: "backspace" });
    expect(key("\x1b[27;2;13~")).toEqual({ kind: "enter", shift: true });       // xterm's modifyOtherKeys form
  });

  test("ctrl and alt keys legacy can't tell apart; ctrl+[ i m h keep their old meanings", () => {
    expect(key("\x1b[99;5u")).toEqual({ kind: "char", ch: "c", ctrl: true });
    expect(key("\x1b[93;5u")).toEqual({ kind: "char", ch: "]", ctrl: true });   // ctrl+]: the escape chord
    expect(key("\x1b[97;6u")).toEqual({ kind: "char", ch: "a", ctrl: true });   // ctrl+shift+a
    expect(key("\x1b[91;5u")).toEqual({ kind: "esc" });
    expect(key("\x1b[105;5u")).toEqual({ kind: "tab" });
    expect(key("\x1b[109;5u")).toEqual({ kind: "enter" });
    expect(key("\x1b[104;5u")).toEqual({ kind: "backspace" });
    expect(key("\x1b[108;3u")).toEqual({ kind: "alt", ch: "l" });               // Option-as-Alt (#75) under the protocol
    expect(key("\x1b[97;4u")).toEqual({ kind: "alt", ch: "A" });
    expect(key("\x1b[49:33;4u")).toEqual({ kind: "alt", ch: "!" });             // alternate keys: what shift typed
    expect(key("\x1b[97;1:3u")).toBeNull();                                     // a release
    expect(key("\x1b[57441;2u")).toBeNull();                                    // a lone modifier (private use)
    expect(key("\x1b[?5u")).toBeNull();                                         // the query's answer isn't a key
  });

  test("a raw piece: a report or legacy ESC-and-a-letter, whole", () => {
    expect(rawKey("\x1b[97;3u")).toEqual({ kind: "alt", ch: "a" });
    expect(rawKey("\x1ba")).toEqual({ kind: "alt", ch: "a" });
    expect(rawKey("\x1b[97;3uxyz")).toBeNull();
    expect(rawKey("a")).toBeNull();
  });
});

describe("the door's terminal", () => {
  const realWrite = process.stdout.write;
  let written = "";
  afterEach(() => { process.stdout.write = realWrite; });
  function term(): { t: Term; keys: Key[]; feed: (s: string) => void } {
    written = "";
    process.stdout.write = ((s: string) => { written += String(s); return true; }) as typeof process.stdout.write;
    const t = new Term();
    const keys: Key[] = [];
    t.onKey(k => keys.push(k));
    return { t, keys, feed: s => (t as unknown as { feed(s: string): void }).feed(s) };
  }

  test("reports are keys; Esc, alt, paste and mouse work as before", async () => {
    const { keys, feed } = term();
    feed("\x1b[13;2u\x1b[27u\x1bl\x1b[108;3u\x1b[200~a\nb\x1b[201~\x1b[<0;3;4M\r");
    expect(keys).toEqual([
      { kind: "enter", shift: true }, { kind: "esc" }, { kind: "alt", ch: "l" }, { kind: "alt", ch: "l" },
      { kind: "paste", text: "a\nb" }, { kind: "mouse", action: "down", button: 0, x: 2, y: 3 }, { kind: "enter" },
    ]);
    keys.length = 0;
    feed("\x1b");                                                               // a lone ESC is still Esc, after the wait
    expect(keys).toEqual([]);
    await Bun.sleep(60);
    expect(keys).toEqual([{ kind: "esc" }]);
    keys.length = 0;
    feed("\x1b[13;");                                                           // a report cut off waits for the rest
    feed("2u");
    expect(keys).toEqual([{ kind: "enter", shift: true }]);
  });

  test("TERM_RESET pops the protocol first, on the alternate screen where it was pushed", () => {
    expect(TERM_RESET.startsWith(KBD_POP)).toBe(true);
    expect(TERM_RESET.indexOf(KBD_POP)).toBeLessThan(TERM_RESET.indexOf("\x1b[?1049l"));
  });

  // start, stop and resume take stdin's raw mode: stubbed here, put back after each test.
  const stdin = process.stdin as unknown as Record<string, unknown>;
  const saved = { setRawMode: stdin.setRawMode, resume: stdin.resume, pause: stdin.pause, on: stdin.on };
  afterEach(() => { Object.assign(stdin, saved); });
  async function started(answer: string): Promise<Term> {
    const { t, feed } = term();
    Object.assign(stdin, { setRawMode: () => {}, resume: () => {}, pause: () => {}, on: () => stdin });
    const up = t.start();
    feed(answer);
    await up;
    return t;
  }

  test("a terminal that answers the query is asked for the protocol; it's given back on stop, asked again on resume", async () => {
    const t = await started("\x1b[?0u\x1b[?62c");
    expect(t.kbd).toBe(true);
    expect(written).toContain("\x1b[?u");
    expect(written.indexOf(KBD_PUSH)).toBeGreaterThan(written.indexOf("\x1b[?1049h"));
    written = "";
    t.stop();                                                                   // suspend ($EDITOR, drop to shell) and exit
    expect(written).toContain(KBD_POP);
    expect(written.indexOf(KBD_POP)).toBeLessThan(written.indexOf("\x1b[?1049l"));
    written = "";
    t.resume();
    expect(written).toContain(KBD_PUSH);
    t.stop();
  });

  test("a terminal without the protocol isn't asked: nothing changes", async () => {
    const t = await started("\x1b[?62c");
    expect(t.kbd).toBe(false);
    expect(written).not.toContain(KBD_PUSH);
    t.stop();
  });

  test("in a terminal tile, each report goes to it alone; ctrl+] as a report is still the escape chord", async () => {
    const { t, keys, feed } = term();
    const sent: string[] = [];
    t.rawSink = () => (s: string) => sent.push(s);
    feed("ab\x1b[13;2ucd\x1b[93;5uef");
    expect(sent).toEqual(["ab", "\x1b[13;2u", "cd", "ef"]);
    expect(keys).toEqual([{ kind: "char", ch: "]", ctrl: true }]);
    sent.length = 0;
    feed("x\x1b[13");                                                           // cut off: the rest is waited for
    expect(sent).toEqual(["x"]);
    feed(";2u");
    expect(sent).toEqual(["x", "\x1b[13;2u"]);
    sent.length = 0;
    feed("\x1b[");                                                              // never finished: sent as it was
    await Bun.sleep(60);
    expect(sent).toEqual(["\x1b["]);
  });
});

describe("a terminal tile's program", () => {
  test("follows push, pop, set and the alternate screen, and answers the query", () => {
    const m = new KbdModes();
    expect(m.observe("\x1b[?u")).toBe("\x1b[?0u");
    m.observe("hello\x1b[>1u");
    expect(m.flags).toBe(1);
    expect(m.observe("\x1b[?u")).toBe("\x1b[?1u");
    m.observe("\x1b[=4;2u");
    expect(m.flags).toBe(5);
    m.observe("\x1b[?1049h");                                                   // the alternate screen has its own stack
    expect(m.flags).toBe(0);
    m.observe("\x1b[>8u");
    expect(m.flags).toBe(8);
    m.observe("\x1b[?1049l");
    expect(m.flags).toBe(5);
    m.observe("\x1b[");                                                         // split across reads
    m.observe(">3u");
    expect(m.flags).toBe(3);
    m.observe("\x1b[<2u");
    expect(m.flags).toBe(0);
    m.observe("\x1b[>1u\x1bc");                                                 // a full reset
    expect(m.flags).toBe(0);
  });

  test("Shift+Enter: CSI 13;2u with the protocol, ESC CR without; plain Enter is always CR", () => {
    expect(translateReports("\x1b[13;2u", 0)).toBe("\x1b\r");
    expect(translateReports("\x1b[13;2u", 1)).toBe("\x1b[13;2u");
    expect(translateReports("\r", 1)).toBe("\r");
    expect(keyBytes({ kind: "enter", shift: true })).toBe("\x1b\r");
    expect(keyBytes({ kind: "enter", shift: true }, false, 1)).toBe("\x1b[13;2u");
    expect(keyBytes({ kind: "enter" }, false, 1)).toBe("\r");
    expect(keyBytes({ kind: "enter", ctrl: true })).toBe("\r");
    expect(keyBytes({ kind: "enter", ctrl: true }, false, 1)).toBe("\x1b[13;5u");
  });

  test("legacy bytes for a program that didn't ask: Esc, ctrl, alt", () => {
    expect(translateReports("a\x1b[27ub\x1b[99;5u\x1b[97;3u\x1b[13;3u\x1b[1;3D", 0)).toBe("a\x1bb\x03\x1ba\x1b\r\x1b[1;3D");
    expect(legacyBytes(parseReport("\x1b[97;1:3u")!)).toBe("");               // a release: nothing
    expect(legacyBytes(parseReport("\x1b[120;7u")!)).toBe("\x1b\x18");        // ctrl+alt+x
  });

  test("with the protocol, only what the program asked for: no alternate keys unless flag 4", () => {
    expect(translateReports("\x1b[49:33;4u", 1)).toBe("\x1b[49;4u");
    expect(translateReports("\x1b[49:33;4u", 5)).toBe("\x1b[49:33;4u");
    expect(translateReports("\x1b[27;2;13~", 1)).toBe("\x1b[13;2u");
  });

  test("end to end: a program gets ESC CR until it pushes the protocol, then CSI 13;2u, and its query is answered", async () => {
    // A tiny program that prints, in hex, each read it gets; `P` makes it push the protocol and ask for it.
    const script = "import os,tty\ntty.setraw(0)\nwhile True:\n b=os.read(0,64)\n if b==b'q': break\n if b==b'P':\n  os.write(1,b'\\x1b[>1u\\x1b[?u'); continue\n os.write(1,(b.hex()+'\\r\\n').encode())\n";
    const p = new PtyPane({ cmd: ["python3", "-c", script] });
    try {
      p.render(60, 8, false, null as never);
      const until = async (line: string) => {                                 // a line of the program's output, whole
        for (let i = 0; i < 200 && !p.text().some(l => l.trim() === line); i++) await Bun.sleep(25);
        expect(p.text().map(l => l.trim())).toContain(line);
      };
      await Bun.sleep(300);
      p.inputRaw("\x1b[13;2u");                                                // the person's Shift+Enter, as the door's terminal reports it
      await until("1b0d");
      p.inputRaw("P");
      await until("1b5b3f3175");                                               // the door answered its query: CSI ? 1 u
      expect(p.kbd.flags).toBe(1);
      p.inputRaw("\x1b[13;2u");
      await until("1b5b31333b3275");                                           // CSI 13;2u
      p.inputRaw("\r");
      await until("0d");                                                      // plain Enter: CR
    } finally { p.input("q"); p.kill(); }
  });
});
