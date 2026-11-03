// The test-time budget (PIE-1422, scripts/test-budget.ts): made-up JUnit reports and logs, held to a made-up budget.
// The nightly goes red only through `compare`, so a file that grew past its budget must come out named, with exit 4.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type Budget, compare, junitTimes, propose, timeLines, timesOf } from "../../../scripts/test-budget";

const script = resolve(import.meta.dir, "../../../scripts/test-budget.ts");
const dir = mkdtempSync(join(tmpdir(), "test-budget-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A Bun JUnit report: one top-level <testsuite> per file, its time the file's (hooks included), nested describes inside. */
const junit = (files: Record<string, number>) => `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="bun test" tests="3" time="9">
${Object.entries(files).map(([f, t]) => `  <testsuite name="${f}" file="${f}" tests="2" time="${t}" hostname="box">
    <testsuite name="a describe" file="${f}" line="3" tests="2" time="${t / 10}" hostname="box">
      <testcase name="one" classname="a describe" time="${t / 20}" file="${f}" line="4" />
      <testcase name="two" classname="a describe" time="0" file="${f}" line="5"><skipped /></testcase>
    </testsuite>
  </testsuite>`).join("\n")}
  <testsuite name="test/empty.test.ts" file="test/empty.test.ts" tests="0" time="0.5" hostname="box" />
</testsuites>
`;

const budget: Budget = {
  packages: {
    door: { total: 100, file: 30, files: { "test/parity-lanterns.test.ts": 60 } },
    outliner: { total: 50, file: 30 },
  },
};
/** A run's log: a suite's own output, then the test-time lines box-test's run script prints. */
const log = (door: Record<string, number>, outliner: Record<string, number> = { "test/harbour.test.ts": 10 }) =>
  ["━━ door: bun run test --parallel=8", "(pass) a lantern > lights [12.00ms]", "", "━━ test time (scripts/test-budget.ts)",
    timeLines("door", new Map(Object.entries(door))), timeLines("outliner", new Map(Object.entries(outliner))), "box-test: exit 0"].join("\n");
const lastGreen = log({ "test/parity-lanterns.test.ts": 40, "test/kettle.test.ts": 5, "test/teapot.test.ts": 9 });

function run(...args: string[]) {
  const r = Bun.spawnSync([process.execPath, script, ...args], { stdout: "pipe", stderr: "pipe" });
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
}
function files(name: string, text: string) { const p = join(dir, name); writeFileSync(p, text); return p; }

describe("reading JUnit", () => {
  test("each file's time is its top-level testsuite's, hooks included; nested describes and testcases aren't counted again", () => {
    const t = junitTimes(junit({ "test/kettle.test.ts": 4.5, "test/teapot.test.ts": 2 }));
    expect([...t]).toEqual([["test/kettle.test.ts", 4.5], ["test/teapot.test.ts", 2], ["test/empty.test.ts", 0.5]]);
  });

  test("the times command prints them as test-time lines, and the log reader reads them back from among other output", () => {
    const xml = files("door.xml", junit({ "test/kettle.test.ts": 4.5 }));
    const printed = run("times", "door", xml);
    expect(printed.code).toBe(0);
    const back = timesOf(`noise\n${printed.out}\nmore noise\ttabbed`);
    expect(back.get("door")?.get("test/kettle.test.ts")).toBe(4.5);
    expect(back.get("door")?.size).toBe(2);
    // A package whose tests died before writing a report: said, and no lines.
    const missing = run("times", "door", join(dir, "nowhere.xml"));
    expect(missing.code).toBe(0);
    expect(missing.out).toContain("no JUnit report");
  });
});

describe("holding a run to the budget", () => {
  test("a file grown past its own budget turns it over, names that file first among the files that grew since the last green night", () => {
    const now = timesOf(log({ "test/parity-lanterns.test.ts": 41, "test/kettle.test.ts": 31, "test/teapot.test.ts": 9, "test/lamp.test.ts": 2 }));
    const v = compare(budget, now, timesOf(lastGreen));
    expect(v.status).toBe("over");
    expect(v.over.map(f => f.file)).toEqual(["test/kettle.test.ts"]);
    // Most growth first; a file new since the last green night is "grew" from nothing; one that held steady isn't listed.
    expect(v.grew.map(g => [g.file, g.was])).toEqual([["test/kettle.test.ts", 5], ["test/lamp.test.ts", null], ["test/parity-lanterns.test.ts", 40]]);
  });

  test("the summed time past a package's total is over even when every file is within its own: more shards can't hide it", () => {
    const many = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`test/wick-${i}.test.ts`, 20]));
    const v = compare(budget, timesOf(log(many)), timesOf(lastGreen));
    expect(v.over).toEqual([]);
    expect(v.status).toBe("over");
    expect(v.packages.find(p => p.pkg === "door")).toMatchObject({ seconds: 120, budget: 100 });
  });

  test("80% of a package's total is near; under it is ok; a package with no budget is shown, never red", () => {
    expect(compare(budget, timesOf(log({ "test/kettle.test.ts": 25, "test/teapot.test.ts": 25, "test/lamp.test.ts": 30 }))).status).toBe("near");
    expect(compare(budget, timesOf(log({ "test/kettle.test.ts": 5 }))).status).toBe("ok");
    const v = compare(budget, new Map([["claude-mod", new Map([["t.test.ts", 999]])]]));
    expect(v).toMatchObject({ status: "ok", packages: [{ pkg: "claude-mod", budget: null }] });
  });

  test("the compare command: red output naming the grown file and exit 4; 3 near; 0 within; 5 with no times", () => {
    const b = files("budget.json", JSON.stringify(budget));
    const last = files("last-green.tsv", `# 2026-03-01 abc123def456\n${lastGreen}`);
    const md = join(dir, "request.md"), line = join(dir, "line.txt");
    const over = run("compare", "--log", files("over.log", log({ "test/kettle.test.ts": 45, "test/teapot.test.ts": 9 })), "--budget", b, "--last", last, "--markdown", md, "--line", line);
    expect(over.code).toBe(4);
    expect(over.out).toContain("test-budget: over test budget: investigate");
    expect(over.out).toContain("door/test/kettle.test.ts  45.0 s of 30.0 s");
    expect(over.out).toContain("grew since the last green night (2026-03-01 abc123def456):");
    expect(over.out).toContain("door/test/kettle.test.ts  5.0 s → 45.0 s (+40.0 s)");
    expect(readFileSync(md, "utf8")).toContain("| `door/test/kettle.test.ts` | 5.0 s | 45.0 s | +40.0 s |");
    expect(readFileSync(line, "utf8")).toBe("over test budget: investigate: door 54% of 100.0 s, outliner 20% of 50.0 s; 1 file over their own");

    const near = run("compare", "--log", files("near.log", log({ "test/kettle.test.ts": 29, "test/teapot.test.ts": 29, "test/lamp.test.ts": 29 })), "--budget", b, "--last", last);
    expect(near.code).toBe(3);
    expect(near.out).toContain("near test budget (80%)");
    expect(run("compare", "--log", files("ok.log", log({ "test/kettle.test.ts": 5 })), "--budget", b, "--last", last).code).toBe(0);
    expect(run("compare", "--log", files("none.log", "━━ door: bun run test\n(pass) x [1ms]\n"), "--budget", b, "--last", last).code).toBe(5);
  });
});

describe("an estimated budget and the raise", () => {
  const overLog = () => files("est-over.log", log({ "test/kettle.test.ts": 45, "test/teapot.test.ts": 9 }));
  test("while the budget says it is estimated, an over-budget night warns, prints a measured budget and exits 0; measured, it is red", () => {
    const last = files("est-last.tsv", `# 2026-03-01 abc123def456\n${lastGreen}`);
    const line = join(dir, "est-line.txt");
    const estimated = run("compare", "--log", overLog(), "--budget", files("est.json", JSON.stringify({ ...budget, estimated: true })), "--last", last, "--line", line);
    expect(estimated.code).toBe(0);
    expect(estimated.out).toContain("test-budget: over the estimated test budget: no ticket");
    expect(estimated.out).toContain("door/test/kettle.test.ts  45.0 s of 30.0 s");
    expect(estimated.out).toContain("a measured budget from this run: door 68 s, outliner 13 s, 1 file of its own");
    expect(estimated.out).toContain("propose --log");
    expect(readFileSync(line, "utf8")).toStartWith("over the estimated test budget");
    const measured = run("compare", "--log", overLog(), "--budget", files("measured.json", JSON.stringify(budget)), "--last", last);
    expect(measured.code).toBe(4);
    expect(measured.out).toContain("test-budget: over test budget: investigate");
  });

  test("propose --write raises the budget in place, measured from then on; a run that fails leaves the file as it was", () => {
    const path = files("raise.json", JSON.stringify({ about: "made up", estimated: true, ...budget }));
    const raised = run("propose", "--log", overLog(), "--budget", path, "--write");
    expect(raised.code).toBe(0);
    const after = JSON.parse(readFileSync(path, "utf8")) as Budget & { estimated?: boolean };
    expect(after.estimated).toBeUndefined();
    expect(after.about).toBe("made up");
    expect(after.packages.door).toEqual({ total: 68, file: 30, files: { "test/kettle.test.ts": 57 } });
    const before = readFileSync(path, "utf8");
    expect(run("propose", "--log", join(dir, "no-such.log"), "--budget", path, "--write").code).not.toBe(0);
    expect(readFileSync(path, "utf8")).toBe(before);
  });
});

describe("the budget itself", () => {
  test("propose: these times plus 25%, a file of its own only past the package's default, the note on top kept", () => {
    const p = propose(timesOf(log({ "test/kettle.test.ts": 40, "test/teapot.test.ts": 8 })), { about: "made up", packages: { door: { total: 1, file: 30 } } }, "today");
    expect(p).toEqual({
      about: "made up", measured: "today",
      packages: { door: { total: 60, file: 30, files: { "test/kettle.test.ts": 50 } }, outliner: { total: 13, file: 60 } },
    });
  });

  test("the repository's budget reads: every package has a total and a file default, and its own files are past the default", () => {
    const real = JSON.parse(readFileSync(resolve(import.meta.dir, "../../../scripts/test-budget.json"), "utf8")) as Budget;
    for (const pkg of ["door", "outliner", "outline-core"]) {
      const b = real.packages[pkg]!;
      expect(b.total).toBeGreaterThan(0);
      expect(b.file).toBeGreaterThan(0);
      for (const s of Object.values(b.files ?? {})) expect(s).toBeGreaterThan(b.file);
    }
  });
});
