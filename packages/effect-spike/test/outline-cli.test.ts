import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Stdio from "effect/Stdio";
import * as Terminal from "effect/Terminal";
import { ChildProcessSpawner } from "effect/process";
import { TestConsole } from "effect/testing";
import { HostSocket, runOutline } from "../src/outline-cli";
import { fakeHost } from "./fake-host";

const dir = mkdtempSync(join(tmpdir(), "effect-spike-cli-"));
const host = fakeHost(dir);
afterAll(() => { host.server.stop(true); rmSync(dir, { recursive: true, force: true }); });

/** The CLI's Environment, stubbed: what the Bun layer gives in one line, a test gives in ten. */
const env = Layer.mergeAll(
  FileSystem.layerNoop({}),
  Path.layer,
  Stdio.layerTest({ args: Effect.succeed([]) }),
  Layer.succeed(Terminal.Terminal, Terminal.make({ columns: Effect.succeed(80), rows: Effect.succeed(24), readInput: Effect.die("unused"), readLine: Effect.die("unused"), display: () => Effect.void })),
  Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, ChildProcessSpawner.make(() => Effect.die("unused"))),
  TestConsole.layer,
  Layer.succeed(HostSocket, host.path),
);

/** Run the words; what was logged, what was said on stderr, and the error if it failed. */
async function cli(words: string[]) {
  return Effect.runPromise(Effect.gen(function*() {
    const result = yield* Effect.result(runOutline(words));
    const out = (yield* TestConsole.logLines).map(String), err = (yield* TestConsole.errorLines).map(String);
    return { out, err, failed: result._tag === "Failure" ? (result.failure as any) : null };
  }).pipe(Effect.provide(env)));
}

describe("ep0ch outline on effect/cli", () => {
  test("list: the host's outlines, plain and as JSON; ls is an alias", async () => {
    const plain = await cli(["list"]);
    expect(plain.failed).toBeNull();
    expect(plain.out).toEqual(["jam-shelf (open) (default)  /home/sam/outlines/jam-shelf.sqlite", "garden  /home/sam/outlines/garden.sqlite"]);
    const json = await cli(["--json", "ls"]);
    expect(JSON.parse(json.out.join("\n")).defaultOutline).toBe("jam-shelf");
  });

  test("create: the name is checked by Schema before anything is sent; a refusal from the host is typed", async () => {
    const bad = await cli(["create", "Bad Name"]);
    // Parse errors arrive wrapped: ShowHelp carries them, and the runner has already printed them on stderr.
    expect(bad.failed?._tag).toBe("ShowHelp");
    expect(bad.failed?.errors.map((e: any) => e._tag)).toEqual(["InvalidValue"]);
    expect(bad.err.join("\n")).toContain("an outline name: lowercase letters, digits and hyphens, up to 32");
    expect(host.opened).toBe(2);   // nothing was sent
    const taken = await cli(["create", "garden"]);
    expect(taken.failed).toMatchObject({ _tag: "Refused", error: `"garden" exists already` });
    const made = await cli(["create", "seed-order"]);
    expect(made.out).toEqual(["created seed-order at /home/sam/outlines/seed-order.sqlite"]);
  });

  test("a typo gets 'Did you mean this?' for a subcommand and for a flag, from the module", async () => {
    const sub = await cli(["lits"]);
    expect(sub.failed?.errors[0]).toMatchObject({ _tag: "UnknownSubcommand", suggestions: ["list", "ls"] });
    expect(sub.err.join("\n")).toContain("Did you mean this?");
    // A flag typo is named but gets no suggestion: the module's "did you mean" covers subcommands, not flags (cli-words.ts's `closest` does both).
    const flag = await cli(["list", "--jsno"]);
    expect(flag.failed?.errors[0]).toMatchObject({ _tag: "UnrecognizedOption", suggestions: [] });
    expect(flag.err.join("\n")).toContain("Unrecognized flag: --jsno in command outline list");
  });

  test("--machine is checked as an ssh config name; delete asks for --yes", async () => {
    const m = await cli(["--machine", "box a!", "list"]);
    expect(m.failed?.errors[0]?._tag).toBe("InvalidValue");
    expect(m.err.join("\n")).toContain("an ssh config name");
    // A value that looks like a flag is read as one, so the Schema never sees it: "Missing value for flag --machine" instead of ep0ch's refusal.
    expect((await cli(["--machine", "-oProxyCommand=x", "list"])).failed?.errors.map((e: any) => e._tag)).toEqual(["InvalidValue", "UnrecognizedOption"]);
    const d = await cli(["delete", "garden"]);
    expect(d.err).toEqual(["ep0ch: outline delete garden moves its files aside; add --yes to do it"]);
    expect((await cli(["delete", "garden", "--yes"])).out).toEqual(["garden moved to /home/sam/outlines/.trash/garden"]);
  });

  test("--help is rendered by the module", async () => {
    const h = await cli(["--help"]);
    expect(h.failed).toBeNull();
    expect(h.out.join("\n")).toMatch(/outline[\s\S]*list[\s\S]*create[\s\S]*delete/);
    expect(h.out.join("\n")).toContain("--machine");
  });
});
