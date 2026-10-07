import { describe, expect, test } from "bun:test";
import {
  encodeProgramStatus, isStatusQueryReply, mostUrgent, parseProgramStatus, PROGRAM_STATUS_LIMITS, PROGRAM_STATUS_QUERY,
  statusDisplayText, StatusRecords, statusSegment, type StatusReport,
} from "../src/program-status";

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
const body = (seq: string) => seq.slice("\x1b]7501;".length, -2);
const report = (b: string): StatusReport => {
  const p = parseProgramStatus(b);
  if (p.t !== "report") throw new Error(`not a report: ${JSON.stringify(p)}`);
  return p.report;
};
const ignored = (b: string) => expect(parseProgramStatus(b).t).toBe("ignored");

describe("syntax", () => {
  test("the spec's Terraform example reads as blocked on a permission", () => {
    const r = report(`state=blocked:kind=permission:app=terraform:msg=${b64("Apply 3 to add, 1 to change, 0 to destroy?")}`);
    expect(r).toEqual({ state: "blocked", id: "", kind: "permission", app: "terraform", msg: "Apply 3 to add, 1 to change, 0 to destroy?" });
  });

  test("whitespace around keys and values is removed; a repeated key's last value wins", () => {
    expect(report(" state = working : app=a : app = b ")).toEqual({ state: "working", id: "", app: "b" });
  });

  test("a malformed pair is skipped and the rest still applies; unknown keys are ignored", () => {
    // no `=`, an empty key, an upper-case key, a value outside the set (`;` can't be in a body; `!` and space-inside can't either)
    expect(report("state=done:junk:=x:Msg=QQ:app=a b:future=1:app=cargo")).toEqual({ state: "done", id: "", app: "cargo" });
  });

  test("state is required and must be known: a later state never turns into idle", () => {
    ignored("app=cargo");
    ignored("state=paused:app=cargo");
    ignored("state=");
  });

  test("msg and title are standard base64 of UTF-8, padding optional", () => {
    expect(report(`state=done:msg=${b64("héllo ✓").replace(/=+$/, "")}`).msg).toBe("héllo ✓");
    expect(report(`state=done:title=${b64("Build")}`).title).toBe("Build");
  });

  test("base64 that doesn't decode, or isn't UTF-8, discards the whole report", () => {
    ignored("state=done:msg=a_b-");            // URL-safe alphabet isn't standard
    ignored("state=done:msg=QQ=A");            // padding inside
    ignored("state=done:msg=Q");               // one leftover character
    ignored(`state=done:msg=${Buffer.from([0xc3, 0x28]).toString("base64")}`);   // invalid UTF-8
    ignored(`state=done:msg=${Buffer.from([0xed, 0xa0, 0x80]).toString("base64")}`); // a surrogate
  });

  test("decoded text holding a control character is refused whole, C0, DEL and C1 alike", () => {
    for (const bad of ["line\nbreak", "esc\x1b[31m", "bell\x07", "del\x7f", "c1\u0085", "csi\u009b"]) {
      ignored(`state=done:app=x:msg=${b64(bad)}`);
      ignored(`state=done:title=${b64(bad)}`);
    }
  });

  test("kind only with blocked; an unknown kind is absent", () => {
    expect(report("state=blocked:kind=question").kind).toBe("question");
    expect(report("state=blocked:kind=coffee").kind).toBeUndefined();
    expect(report("state=working:kind=permission").kind).toBeUndefined();
  });

  test("progress 0 to 100 with working or blocked; anything else is absent", () => {
    expect(report("state=working:progress=40").progress).toBe(40);
    expect(report("state=blocked:progress=0").progress).toBe(0);
    expect(report("state=working:progress=100").progress).toBe(100);
    for (const p of ["101", "-1", "4.5", "x", ""]) expect(report(`state=working:progress=${p}`).progress).toBeUndefined();
    expect(report("state=done:progress=40").progress).toBeUndefined();
  });

  test("app outside its character set is treated as absent", () => {
    expect(report("state=idle:app=claude-code").app).toBe("claude-code");
    expect(report("state=idle:app=a,b").app).toBeUndefined();
    expect(report("state=idle:app=").app).toBeUndefined();
  });

  test("an id outside the grammar is ignored, never applied to the root", () => {
    expect(report("state=working:id=build/test").id).toBe("build/test");
    for (const id of ["", "a//b", "/a", "a/", "a,b", "a=b"]) ignored(`state=working:id=${id}`);
  });

  test("the feature query is `?`, and a reply is anything starting with it", () => {
    expect(parseProgramStatus("?")).toEqual({ t: "query" });
    expect(PROGRAM_STATUS_QUERY).toBe("\x1b]7501;?\x1b\\");
    expect(isStatusQueryReply("?")).toBe(true);
    expect(isStatusQueryReply("?:v=2")).toBe(true);
    expect(isStatusQueryReply("state=idle")).toBe(false);
  });
});

describe("limits: a report breaking one is discarded whole", () => {
  const L = PROGRAM_STATUS_LIMITS;
  test("the whole sequence is at most 4096 bytes", () => {
    const pad = `:x=${"a".repeat(4096)}`;
    ignored(`state=idle${pad}`);
    expect(parseProgramStatus(`state=idle:x=${"a".repeat(4096 - 9 - "state=idle:x=".length)}`).t).toBe("report");
    expect(parseProgramStatus(`state=idle:x=${"a".repeat(4096 - 9 - "state=idle:x=".length + 1)}`).t).toBe("ignored");
  });
  test("the largest legal report fits", () => {
    const seq = encodeProgramStatus({ state: "blocked", id: Array(8).fill("s".repeat(15)).join("/"), kind: "permission", progress: 100, app: "a".repeat(32), title: "t".repeat(400), msg: "m".repeat(4000) });
    expect(new TextEncoder().encode(seq).length).toBeLessThan(3300);
    expect(parseProgramStatus(body(seq)).t).toBe("report");
  });
  test("a key longer than 16 bytes", () => { ignored(`state=idle:${"k".repeat(L.key + 1)}=1`); expect(report(`state=idle:${"k".repeat(L.key)}=1`).state).toBe("idle"); });
  test("msg over 2732 encoded or 2048 decoded", () => {
    ignored(`state=done:msg=${"QUFB".repeat(684)}`); // 2736 encoded
    expect(report(`state=done:msg=${b64("a".repeat(2048))}`).msg).toHaveLength(2048);
    // 2049 bytes is 2732 characters encoded, within that limit: the decoded limit refuses it.
    ignored(`state=done:msg=${b64("a".repeat(2049))}`);
  });
  test("title over 256 encoded or 192 decoded", () => {
    ignored(`state=done:title=${b64("a".repeat(193))}`);
    expect(report(`state=done:title=${b64("a".repeat(192))}`).title).toHaveLength(192);
    ignored(`state=done:title=${"Q".repeat(257)}`);
  });
  test("app over 32 bytes", () => { ignored(`state=idle:app=${"a".repeat(33)}`); });
  test("an id over 128 bytes, 8 levels or 32 per segment", () => {
    ignored(`state=idle:id=${Array(9).fill("a").join("/")}`);
    ignored(`state=idle:id=${"a".repeat(33)}`);
    ignored(`state=idle:id=${Array(5).fill("a".repeat(30)).join("/")}`);
    expect(report(`state=idle:id=${Array(8).fill("a".repeat(15)).join("/")}`).id).toHaveLength(127);
  });
  test("a limit broken by a pair that a later one overrides still discards the report", () => {
    ignored(`state=done:msg=${"QUFB".repeat(700)}:msg=QQ`);
  });
  test("records per terminal: past the cap the least recently updated goes", () => {
    const r = new StatusRecords(64);
    for (let i = 0; i < 64; i++) r.apply({ state: "working", id: `w${i}` });
    r.apply({ state: "done", id: "w0" });            // w0 is now the most recent
    r.apply({ state: "working", id: "new" });        // w1 is the least recently updated
    expect(r.size).toBe(64);
    expect(r.get("w1")).toBeUndefined();
    expect(r.get("w0")?.state).toBe("done");
    expect(new StatusRecords().apply.length).toBe(1);
    const big = new StatusRecords();
    for (let i = 0; i < 300; i++) big.apply({ state: "idle", id: `i${i}` });
    expect(big.size).toBe(PROGRAM_STATUS_LIMITS.records);
  });
});

describe("records", () => {
  test("each report replaces its record whole: a key left out is gone", () => {
    const r = new StatusRecords();
    r.apply(report(`state=blocked:kind=auth:app=brew:msg=${b64("Password required")}`));
    r.apply(report(`state=working:msg=${b64("Installing")}`));
    expect(r.get("")).toEqual({ state: "working", id: "", msg: "Installing" });
  });

  test("clear removes the record and everything beneath it; with no id, every record", () => {
    const r = new StatusRecords();
    for (const id of ["", "build", "build/test", "build/test/unit", "builder", "deploy"]) r.apply({ state: "working", id });
    r.apply(report("state=clear:id=build"));
    expect(r.list().map(x => x.id)).toEqual(["", "builder", "deploy"]);
    r.apply(report("state=clear"));
    expect(r.size).toBe(0);
  });

  test("a parent needn't exist; a record without app takes its nearest ancestor's", () => {
    const r = new StatusRecords();
    r.apply(report("state=working:app=deploy"));
    r.apply(report("state=working:id=us-east/pods"));
    r.apply(report("state=blocked:id=eu-west:app=gate"));
    r.apply(report("state=done:id=eu-west/db"));
    const by = Object.fromEntries(r.list().map(x => [x.id, x.app]));
    expect(by).toEqual({ "": "deploy", "us-east/pods": "deploy", "eu-west": "gate", "eu-west/db": "gate" });
  });

  test("root and child records exist at once; the most urgent is blocked over error, done, working, idle", () => {
    const r = new StatusRecords();
    r.apply({ state: "idle", id: "" });
    r.apply({ state: "working", id: "a" });
    expect(r.urgent()?.state).toBe("working");
    r.apply({ state: "done", id: "b" });
    r.apply({ state: "error", id: "c" });
    r.apply({ state: "blocked", id: "d" });
    expect(r.urgent()?.id).toBe("d");
    expect(mostUrgent(["idle", "done", "working"])).toBe("done");
    expect(mostUrgent([])).toBeNull();
  });

  test("lifetimes: process exit and a new prompt drop working and blocked; done and error survive; seen drops them", () => {
    const r = new StatusRecords();
    const all = () => r.list().map(x => `${x.id}:${x.state}`);
    for (const [id, state] of [["i", "idle"], ["w", "working"], ["b", "blocked"], ["d", "done"], ["e", "error"]] as const) r.apply({ state, id });
    expect(r.prompt()).toBe(true);
    expect(all()).toEqual(["d:done", "e:error", "i:idle"]);
    r.apply({ state: "working", id: "w" });
    r.exited();
    expect(all()).toEqual(["d:done", "e:error", "i:idle"]);
    expect(r.seen()).toBe(true);
    expect(all()).toEqual(["i:idle"]);
    expect(r.seen()).toBe(false);
  });

  test("a full reset removes every record", () => {
    const r = new StatusRecords();
    r.apply({ state: "done", id: "" });
    r.apply({ state: "idle", id: "x" });
    r.reset();
    expect(r.size).toBe(0);
  });
});

describe("writing", () => {
  test("encode then parse gives back what was said", () => {
    const seq = encodeProgramStatus({ state: "blocked", id: "desk/claude", kind: "permission", progress: 30, app: "claude-code", title: "claude", msg: "Allow Bash: rm -rf build?" });
    expect(seq.startsWith("\x1b]7501;state=blocked:id=desk/claude:kind=permission:progress=30:app=claude-code:")).toBe(true);
    expect(seq.endsWith("\x1b\\")).toBe(true);
    expect(report(body(seq))).toEqual({ state: "blocked", id: "desk/claude", kind: "permission", progress: 30, app: "claude-code", title: "claude", msg: "Allow Bash: rm -rf build?" });
  });

  test("the spec's shell function and this agree", () => {
    expect(encodeProgramStatus({ state: "working", msg: "Syncing photos" })).toBe(`\x1b]7501;state=working:msg=${b64("Syncing photos")}\x1b\\`);
  });

  test("text is made one line and cut at a character to its limit", () => {
    expect(report(body(encodeProgramStatus({ state: "done", msg: "two\nlines\x1b[31m" }))).msg).toBe("two lines [31m");
    const long = report(body(encodeProgramStatus({ state: "done", msg: "é".repeat(2000), title: "✓".repeat(100) })));
    expect(new TextEncoder().encode(long.msg!).length).toBe(2048);
    expect(long.title).toBe("✓".repeat(64));
  });

  test("an id outside the grammar throws; a bad app or progress is left out", () => {
    expect(() => encodeProgramStatus({ state: "idle", id: "a b" })).toThrow();
    expect(encodeProgramStatus({ state: "working", app: "a b", progress: 140 })).toBe("\x1b]7501;state=working\x1b\\");
  });

  test("a name becomes an id segment", () => {
    expect(statusSegment("door-claude")).toBe("door-claude");
    expect(statusSegment("my shell #2")).toBe("my-shell-2");
    expect(statusSegment("///")).toBe("x");
    expect(statusSegment("a".repeat(40))).toHaveLength(32);
  });
});

test("security: text shown outside the grid has its direction overrides and invisible formatting taken out", () => {
  expect(statusDisplayText("safe‮txt.exe​⁦x⁩﻿")).toBe("safetxt.exex");
});

test("the Claude mod's copy (a hooks module can't import outside its plugin) stays this file, and writes the same", async () => {
  const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();
  const [own, copy] = await Promise.all([read("../src/program-status.ts"), read("../../claude-mod/hooks/program-status.ts")]);
  expect(copy.slice(copy.indexOf("\n") + 1)).toBe(own);
  const modCopy = await import("../../claude-mod/hooks/program-status");
  expect(modCopy.encodeProgramStatus({ state: "done", msg: "Stopped" })).toBe(encodeProgramStatus({ state: "done", msg: "Stopped" }));
});
