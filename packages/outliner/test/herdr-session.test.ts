import { expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import {
  attachKeypressInput,
  createHerdrSession,
  screenEnter,
  screenLeave,
  type HerdrSessionOptions,
  type HerdrSignal,
} from "../src/herdr-session";
import { TextBuffer } from "../src/text-buffer";
import { applyTextBufferEditorCommand, textBufferEditorCommand } from "../src/text-buffer-editor";

const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));

test("a lone Escape reaches the popup at once, not after readline's escape wait", async () => {
  const input = new PassThrough();
  const keys: string[] = [];
  const detach = attachKeypressInput(input, { keypress: (_text, key) => keys.push(key.name ?? "") });
  input.write("\x1b");
  await tick(150);
  expect(keys).toEqual(["escape"]);
  detach();
  input.destroy();
});

test("input keeps split UTF-8 typing and a bracketed paste whole beside mouse frames", () => {
  const input = new PassThrough(), buffer = new TextBuffer(), clicks: string[] = [];
  const detach = attachKeypressInput(input, {
    keypress: (str, key, action) => { if (action === "pass") applyTextBufferEditorCommand(buffer, textBufferEditorCommand(str, key, false)); },
    paste: text => buffer.insert(text), mouse: sequence => clicks.push(sequence),
  });
  for (const byte of Buffer.from("é日😀👩‍💻é")) input.write(Buffer.from([byte]));
  input.write("\x1b[200~"); for (const byte of Buffer.from(" café\n日本")) input.write(Buffer.from([byte])); input.write("\x1b[201~");
  input.write("\x1b[<0;4;5M");
  expect(buffer.text).toBe("é日😀👩‍💻é café\n日本"); expect(clicks).toEqual(["\x1b[<0;4;5M"]);
  detach(); input.write("ignored"); expect(buffer.text).toBe("é日😀👩‍💻é café\n日本"); input.destroy();
});

test("without a paste or mouse handler, pastes and clicks are dropped, never typed as keys", () => {
  const input = new PassThrough(), keys: string[] = [];
  const detach = attachKeypressInput(input, { keypress: text => keys.push(text) });
  input.write("\x1b[200~qd\x1b[201~");
  input.write("\x1b[<0;4;5M\x1b[<0;4;5m");
  input.write("j");
  expect(keys).toEqual(["j"]);
  detach(); input.destroy();
});

test("a raw handler sees each chunk first and can take it", () => {
  const input = new PassThrough(), keys: string[] = [], raw: string[] = [];
  const detach = attachKeypressInput(input, { keypress: text => keys.push(text), raw: data => { raw.push(data); return data === "x"; } });
  input.write("x"); input.write("y");
  expect(raw).toEqual(["x", "y"]); expect(keys).toEqual(["y"]);
  detach(); input.destroy();
});

test("the screen leaves every mode it entered, in reverse", () => {
  expect(screenEnter({ mouse: "click", paste: true })).toBe("\x1b[?1049h\x1b[?25l\x1b[?1000h\x1b[?1006h\x1b[?2004h");
  expect(screenLeave({ mouse: "click", paste: true })).toBe("\x1b[?2004l\x1b[?1006l\x1b[?1000l\x1b[?25h\x1b[?1049l");
  expect(screenEnter({ mouse: "drag" })).toBe("\x1b[?1049h\x1b[?25l\x1b[?1000h\x1b[?1002h\x1b[?1006h");
  expect(screenLeave({ mouse: "drag" })).toBe("\x1b[?1006l\x1b[?1002l\x1b[?1000l\x1b[?25h\x1b[?1049l");
  expect(screenLeave({ paste: true })).toBe("\x1b[?2004l\x1b[?25h\x1b[?1049l");
});


function harness(options: Partial<HerdrSessionOptions> = {}) {
  const written: string[] = [], exits: number[] = [], signals = new Map<HerdrSignal, () => void>();
  const stdin = Object.assign(new PassThrough(), { isTTY: false, setRawMode() {} }) as unknown as NodeJS.ReadStream;
  const stdout = Object.assign(new PassThrough(), { columns: 80, rows: 24 }) as unknown as NodeJS.WriteStream;
  const errors: unknown[] = [];
  const session = createHerdrSession({
    input: { kind: "keypress", handlers: { keypress() {} } },
    modes: { mouse: "click", paste: true },
    onError: error => errors.push(error),
    ...options,
    io: {
      write: data => written.push(data), stdin, stdout,
      exit: (code: number) => { exits.push(code); return undefined as never; },
      onSignal: (signal, handler) => signals.set(signal, handler),
    },
  });
  return { session, written, exits, signals, errors };
}

test("queued work runs in order, a failure goes to onError, and nothing queued runs once stopping", async () => {
  const ran: string[] = [];
  const { session, errors, exits } = harness();
  session.start();
  session.enqueue(async () => { await tick(5); ran.push("a"); });
  session.enqueue(() => { throw new Error("boom"); });
  session.enqueue(() => { ran.push("b"); });
  await tick(20);
  expect(ran).toEqual(["a", "b"]);
  expect(errors.map(error => (error as Error).message)).toEqual(["boom"]);
  await session.stop(0);
  session.enqueue(() => { ran.push("late"); });
  await tick(5);
  expect(ran).toEqual(["a", "b"]);
  expect(exits).toEqual([0]);
});

test("one stop: teardown, then the screen put back, then exit; a refused stop leaves it running", async () => {
  const order: string[] = [];
  let refuse = true;
  const { session, written, exits } = harness({
    prepare: () => { order.push("prepare"); return !refuse; },
    leave: () => { order.push("leave"); },
  });
  session.start();
  expect(written).toEqual([screenEnter({ mouse: "click", paste: true })]);
  await session.stop(3);
  expect(session.stopping).toBe(false);
  expect(exits).toEqual([]);
  refuse = false;
  await Promise.all([session.stop(3), session.stop(4)]);
  expect(order).toEqual(["prepare", "prepare", "leave"]);
  expect(written.at(-1)).toBe(screenLeave({ mouse: "click", paste: true }));
  expect(exits).toEqual([3]);
});

test("signals stop with 128 + n unless the client says otherwise", async () => {
  const plain = harness();
  plain.session.start();
  plain.signals.get("SIGTERM")!();
  await tick(5);
  expect(plain.exits).toEqual([143]);
  const seen: string[] = [];
  const custom = harness({ onSignal: (signal, code) => seen.push(`${signal}:${code}`) });
  custom.session.start();
  custom.signals.get("SIGINT")!(); custom.signals.get("SIGHUP")!();
  expect(seen).toEqual(["SIGINT:130", "SIGHUP:129"]);
  expect(custom.exits).toEqual([]);
});

test("stopAfterQueue waits for queued work and its own last step, once", async () => {
  const order: string[] = [];
  const { session, exits } = harness();
  session.start();
  session.enqueue(async () => { await tick(10); order.push("writing"); });
  session.stopAfterQueue(130, () => { order.push("keep draft"); });
  session.stopAfterQueue(143, () => { order.push("again"); });
  await tick(30);
  expect(order).toEqual(["writing", "keep draft"]);
  expect(exits).toEqual([130]);
});

test("suspend hands the terminal over and resume takes it back", () => {
  let draws = 0;
  const { session, written } = harness({ draw: () => { draws++; } });
  session.start();
  session.suspend();
  session.resume();
  expect(written).toEqual([
    screenEnter({ mouse: "click", paste: true }),
    screenLeave({ mouse: "click", paste: true }),
    screenEnter({ mouse: "click", paste: true }),
  ]);
  expect(draws).toBe(1);
});

test("a Pi terminal is drained and stopped before the screen is put back; it brings its own paste mode", async () => {
  const order: string[] = [];
  const terminal = {
    start() { order.push("start"); },
    async drainInput() { order.push("drain"); },
    stop() { order.push("terminal stop"); },
  };
  const { session, written } = harness({
    modes: { mouse: "click", paste: true },
    input: { kind: "pi", terminal: terminal as never, onData() {} },
  });
  session.start();
  await session.stop();
  expect(order).toEqual(["start", "drain", "terminal stop"]);
  expect(written).toEqual([screenEnter({ mouse: "click" }), screenLeave({ mouse: "click" })]);
});
