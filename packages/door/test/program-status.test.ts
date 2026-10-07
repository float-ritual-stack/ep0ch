// Program status in a terminal tile (OSC 7501, PIE-614): a real program on a real pty reports, and the tile keeps the
// records as the spec says (outline-core's test/program-status.test.ts holds the grammar and the limits): applied
// whole, the feature query answered, working and blocked gone when it exits or a prompt begins, done kept until the
// person comes back to the tile, everything gone on a full reset. Only `sh`, `printf`, `stty`, `dd`, `od` and `sleep` run.
import { afterEach, describe, expect, test } from "bun:test";
import { cttyPrefix, PtyPane } from "../src/desk/pty";
import { waitingCounts, waitingOnYou } from "../src/desk/program-status";
import { waitingText } from "../src/app";
import { until } from "./scratch";

const b64 = (s: string) => Buffer.from(s).toString("base64");
const osc = (body: string) => `\\033]7501;${body}\\033\\\\`;
const draw = (p: PtyPane) => p.render(60, 8, false, { redraw() {} } as any).lines.join("\n").replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
const tiles: PtyPane[] = [];
function tile(script: string, label = "prog"): PtyPane {
  const p = new PtyPane({ cmd: ["sh", "-c", script], label });
  tiles.push(p);
  draw(p);
  return p;
}
afterEach(() => { for (const p of tiles.splice(0)) p.dispose(); });
const states = (p: PtyPane) => p.status.records.list().map(r => `${r.id || "root"}:${r.state}`).join(" ");

describe.skipIf(!cttyPrefix())("a terminal tile reads its program's status", () => {
  test("a report becomes the tile's record, whole; its header shows the state; the waiting list and the status bar count it", async () => {
    const p = tile(`printf '${osc(`state=working:app=build:progress=40:msg=${b64("compiling")}`)}'; sleep 0.3; printf '${osc(`state=blocked:kind=permission:msg=${b64("Allow deploy?")}`)}'; sleep 30`);
    await until(() => p.status.urgent()?.state === "working", "working", 5000);
    expect(p.headStatus()?.glyph).toMatch(/^[◴◷◶◵] 40%$/);
    await until(() => p.status.urgent()?.state === "blocked", "blocked", 5000);
    // Replaced whole: no app or progress left over from the working report.
    expect(p.status.records.get("")).toEqual({ id: "", state: "blocked", kind: "permission", msg: "Allow deploy?" });
    expect(p.headStatus()?.glyph).toBe("◆");
    const row = waitingOnYou().find(r => r.holder === p);
    expect(row?.name).toBe("prog");
    expect(waitingText(waitingCounts()).plain).toContain("◆1");
    expect(p.describe().status).toEqual([{ id: "", state: "blocked", kind: "permission", msg: "Allow deploy?" }]);
  }, 15_000);

  test("the feature query is answered with the same bytes", async () => {
    const p = tile(`stty -icanon -echo min 0 time 20; printf '\\033]7501;?\\033\\\\'; r=$(dd bs=1 count=10 2>/dev/null | od -An -c | tr -s ' '); echo "got[$r]"; sleep 30`);
    await until(() => draw(p).includes("got["), "the reply", 5000);
    expect(draw(p)).toMatch(/got\[ 033 \] 7 5 0 1 ; \? 033 \\+\]/);
  }, 15_000);

  test("the program exits: working and blocked go, done stays until the person is back in the tile", async () => {
    const p = tile(`printf '${osc("state=done:id=a")}${osc("state=working:id=b")}${osc("state=blocked:id=c")}'; sleep 0.3`);
    await until(() => p.exited !== null, "the exit", 5000);
    await until(() => states(p) === "a:done", "only done left", 5000);
    expect(p.headStatus()?.glyph).toBe("✓");
    p.typed({ kind: "char", ch: "x" });
    expect(p.status.records.size).toBe(0);
    expect(p.headStatus()).toBeNull();
  }, 15_000);

  test("a new prompt (OSC 133 A) drops working and blocked; a full reset drops every record", async () => {
    const p = tile(`printf '${osc("state=working")}${osc("state=error:id=e")}${osc("state=idle:id=i")}'; sleep 0.3; printf '\\033]133;A\\033\\\\'; sleep 0.3; printf 'mark\\n'; sleep 0.5; printf '\\033c'; sleep 30`);
    await until(() => draw(p).includes("mark"), "the prompt", 5000);
    expect(states(p)).toBe("e:error i:idle");
    await until(() => p.status.records.size === 0, "the reset", 5000);
  }, 15_000);

  test("a report breaking the rules changes nothing: a control character in msg, an id outside the grammar, no state", async () => {
    const p = tile(`printf '${osc("state=done")}${osc(`state=error:msg=${b64("bad\x1b[2Jtext")}`)}${osc("state=error:id=a//b")}${osc("app=x")}'; printf 'end\\n'; sleep 30`);
    await until(() => draw(p).includes("end"), "the output", 5000);
    expect(states(p)).toBe("root:done");
  }, 15_000);
});

describe.skipIf(!cttyPrefix() || !Bun.which("tic") || !Bun.which("infocmp") || !Bun.which("tput"))("the door's terminfo", () => {
  test("a tile's program finds Pst in its xterm-256color (the door speaks OSC 7501), and the system's other entries as before", async () => {
    const p = tile(`tput Pst >/dev/null && echo "pst=yes" || echo "pst=no"; TERM=vt100 tput cols >/dev/null && echo "vt100=ok"; sleep 30`);
    await until(() => /pst=\w+/.test(draw(p)) && draw(p).includes("vt100=ok"), "tput", 5000);
    expect(draw(p)).toContain("pst=yes");
  }, 15_000);
});
