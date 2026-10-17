import { describe, expect, test } from "bun:test";
import { findOutputRegions, outputRegionText } from "@ep0ch/outline-core/output-region";
import { resolveFragmentSlice } from "../src/fragments";
import { planPlace, type PlacePlan } from "../src/place";

const producer = { id: "scriptid1", name: "weekly" };
const note = ["Weekly notes", "", "## This week ^week", "", "my own paragraph", "", "- an item ^item1", "", "## Later ^later", "", "later text"].join("\n");
const apply = (text: string, plan: PlacePlan) => {
  if (!plan.ok && plan.kind === "refused") throw new Error(plan.reason);
  let out = text;
  for (const s of [...plan.spans].sort((a, b) => b.range!.start - a.range!.start)) out = out.slice(0, s.range!.start) + s.replacement + out.slice(s.range!.end);
  return out;
};

describe("output regions", () => {
  test("an anchor on a region's header slices the whole callout, whatever its body", () => {
    const t = `${outputRegionText({ label: "weekly", producer: "scriptid1", anchor: "out-weekly-7c2e", body: "| a | b |\n| 1 | 2 |\n\nlast line" })}\n\ntail`;
    const slice = resolveFragmentSlice(t, "out-weekly-7c2e");
    if (slice.status !== "resolved") throw new Error("not resolved");
    expect(slice.slice.anchor.kind).toBe("callout");
    expect(slice.slice.text).toContain("| 1 | 2 |");
    expect(slice.slice.text).toContain("last line");
    expect(slice.slice.text).not.toContain("tail");
  });
  test("a region whose body changed since its hash is edited; {{ is escaped unless interpolating", () => {
    const text = outputRegionText({ label: "w", producer: "p1", anchor: "out-w-1", body: "x {{this.status}}" });
    expect(text).toContain("\\{{this.status}}");
    expect(findOutputRegions(text)[0]!.edited).toBe(false);
    expect(findOutputRegions(text.replace("x ", "y "))[0]!.edited).toBe(true);
    expect(outputRegionText({ label: "w", producer: "p1", anchor: "a", body: "{{a}}", interpolate: true })).toContain("> {{a}}");
  });
});

describe("planPlace", () => {
  test("append is the default: a region after the anchor's heading, never touching the person's text", () => {
    const plan = planPlace(note, { producer, at: "^week", content: "table" });
    expect(plan.ok).toBe(true);
    const out = apply(note, plan);
    expect(out).toContain("## This week ^week\n\n> [!output]- weekly");
    expect(out).toContain("my own paragraph");
    expect(findOutputRegions(out)).toHaveLength(1);
  });
  test("a second append goes after the first region, under the heading", () => {
    const once = apply(note, planPlace(note, { producer, at: "^week", content: "one" }));
    const twice = apply(once, planPlace(once, { producer: { id: "scriptid2", name: "other" }, at: "^week", content: "two" }));
    const regions = findOutputRegions(twice);
    expect(regions.map(r => r.body)).toEqual(["one", "two"]);
    expect(twice.indexOf("two")).toBeLessThan(twice.indexOf("my own paragraph"));
  });
  test("prepend at a heading goes right after the heading line; at a list item, before it", () => {
    expect(apply(note, planPlace(note, { producer, at: "^week", mode: "prepend", content: "x" }))).toContain("## This week ^week\n\n> [!output]-");
    const out = apply(note, planPlace(note, { producer, at: "item1", mode: "prepend", content: "x" }));
    expect(out.indexOf("[!output]")).toBeLessThan(out.indexOf("- an item"));
  });
  test("upsert creates, then replaces its own region keeping the anchor; replace never creates", () => {
    const created = planPlace(note, { producer, at: "^week", mode: "upsert", content: "v1" });
    if (!created.ok) throw new Error("no");
    expect(created.created).toBe(true);
    const once = apply(note, created);
    const again = planPlace(once, { producer, at: "^week", mode: "upsert", content: "v2" });
    if (!again.ok) throw new Error("no");
    expect(again.created).toBe(false);
    const twice = apply(once, again);
    expect(findOutputRegions(twice)).toHaveLength(1);
    expect(findOutputRegions(twice)[0]!.anchor).toBe(created.anchor);
    expect(findOutputRegions(twice)[0]!.body).toBe("v2");
    expect(planPlace(note, { producer, at: `^${created.anchor}`, mode: "replace", content: "x" }).ok).toBe(false);
  });
  test("replace aimed at a heading or a paragraph is refused at the call, naming upsert and append", () => {
    expect(planPlace(note, { producer, at: "^week", mode: "replace", content: "x" })).toEqual({ ok: false, kind: "refused", reason: "^week is a heading section; replace needs an output region; use upsert or append" });
    expect(planPlace(note, { producer, at: "item1", mode: "replace", content: "x" })).toMatchObject({ kind: "refused", reason: expect.stringContaining("a list item") });
  });
  test("a missing anchor is one proposal at the caller with a did-you-mean, never the note's end", () => {
    const plan = planPlace(note, { producer, at: "^weak", content: "x", here: 4 });
    if (plan.ok || plan.kind !== "proposal") throw new Error("expected a proposal");
    expect(plan.reason).toBe("^weak isn't in this note; did you mean ^week?");
    expect(plan.mark).toBe("my own paragraph");
    expect(planPlace(note, { producer, at: "^weak", content: "x" })).toMatchObject({ kind: "refused" });
  });
  test("an edited region is the person's: the new output becomes a proposal and their text stays", () => {
    const once = apply(note, planPlace(note, { producer, at: "^week", mode: "upsert", content: "v1" }));
    const edited = once.replace("v1", "v1 and my note");
    const plan = planPlace(edited, { producer, at: "^week", mode: "upsert", content: "v2" });
    if (plan.ok || plan.kind !== "proposal") throw new Error("expected a proposal");
    expect(plan.reason).toContain("edited");
    expect(plan.spans[0]!.observed).toContain("v1 and my note");
  });
  test("another producer's region is never replaced; front matter is refused", () => {
    const text = apply(note, planPlace(note, { producer: { id: "other", name: "other" }, at: "^week", content: "o" }));
    const anchor = findOutputRegions(text)[0]!.anchor!;
    expect(planPlace(text, { producer, at: anchor, mode: "upsert", content: "x" })).toMatchObject({ kind: "refused" });
    const fm = "Title\n[status::draft] a line ^fm\n\nbody";
    expect(planPlace(fm, { producer, at: "fm", content: "x" })).toMatchObject({ kind: "refused", reason: expect.stringContaining("front matter") });
  });
  test("here appends right after the invocation line, and upsert finds it again after the line moved", () => {
    const t = "Title\n\nkids:: ran\n\nafter";
    const first = planPlace(t, { producer, here: 2, mode: "upsert", content: "v1" });
    const once = apply(t, first);
    expect(once.indexOf("[!output]")).toBeGreaterThan(once.indexOf("kids::"));
    const moved = `intro\n\n${once}`;
    const again = planPlace(moved, { producer, here: 4, mode: "upsert", content: "v2" });
    if (!again.ok) throw new Error("no");
    expect(again.created).toBe(false);
  });
});
