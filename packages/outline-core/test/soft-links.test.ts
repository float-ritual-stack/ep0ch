import { describe, expect, test } from "bun:test";
import { softLinkOfValue, softLinkTokens } from "../src/soft-links";

const names = (text: string, ignore?: string[]) => softLinkTokens(text, { ...(ignore ? { ignore } : {}) }).map(token => ({ ...token, words: text.slice(token.start, token.end) }));

describe("soft link tokens", () => {
  test("a bracket value links its value, never its key", () => {
    expect(names("Thinking [thread::agent-labour] today")).toEqual([
      { kind: "value", value: "agent-labour", key: "thread", start: 18, end: 30, words: "agent-labour" },
    ]);
  });

  test("a line annotation links its value", () => {
    const [token] = names("title\nthread:: agent-labour");
    expect(token).toMatchObject({ kind: "value", value: "agent-labour", key: "thread", words: "agent-labour" });
  });

  test("a date's time is provenance: the link is the day", () => {
    const [token] = names("title\nctx:: 2026-11-06 @ 4:31 AM");
    expect(token).toMatchObject({ kind: "date", day: "2026-11-06", key: "ctx", words: "2026-11-06" });
    expect(names("title\nctx:: 2026-01-01 @ 04:31AM")[0]).toMatchObject({ kind: "date", day: "2026-01-01" });
  });

  test("a bare date and a PR in prose are links; neither in code, a URL or a link", () => {
    expect(names("Met on 2026-11-06 about PR#125.").map(t => t.words)).toEqual(["2026-11-06", "PR#125"]);
    expect(names("`PR#125` https://x.example/2026-11-06/PR#3 [[2026-11-06]] ((abcdef12|PR#9))")).toEqual([]);
    expect(names("a span 2026-11-06..2026-11-08 and 2026-13-45")).toEqual([]);
  });

  test("a date in a picture's or a file's name is its name", () => {
    expect(names("![diagram](2026-03-14.png) and ![diagram](PR#3.png)")).toEqual([]);
    expect(names("see 2026-03-14.png, then 2026-03-14.")[0]).toMatchObject({ day: "2026-03-14", start: 25 });
    expect(names("see 2026-03-14.png, then 2026-03-14.")).toHaveLength(1);
  });

  test("[PR::125] is a pull request whatever its key's case", () => {
    expect(names("See [PR::125] and [pr::#7]").map(t => [t.kind, t.kind === "pr" && t.number, t.words])).toEqual([["pr", 125, "125"], ["pr", 7, "#7"]]);
  });

  test("a list's items link one by one", () => {
    expect(names("Note [thread::[alpha, beta two]]").map(t => t.words)).toEqual(["alpha", "beta two"]);
  });

  test("what can't be a name stays text; any other key is open", () => {
    for (const value of ["5", "3.5", "true", "https://x.example", "/home/x/y.ts", "PC-1", "((abcdef12))", "[[Shed]]", "Oct 20", "a whole long sentence that keeps on going past a name"]) {
      expect(softLinkOfValue("anything", value)).toBeNull();
    }
    expect(softLinkOfValue("made-up-today", "Shed roof")).toEqual({ kind: "value", value: "Shed roof" });
  });

  test("a value no page could have is no name: a quoted time in a code span (PIE-1640)", () => {
    expect(softLinkOfValue("title", "- `[9:15 AM]` morning-dump")).toBeNull();
    expect(softLinkOfValue("title", "shed]")).toBeNull();
    expect(names("Tray [title::- `[9:15 AM]` morning-dump]")).toEqual([]);
  });

  test("a note's own address and a query's words aren't links; a key left out isn't either", () => {
    expect(names("Seeds [page::Seeds] [query::type=x] [soft-link-ignore::status]")).toEqual([]);
    expect(names("Seeds [status::open] [thread::x]", ["STATUS"]).map(t => t.words)).toEqual(["x"]);
  });
});
