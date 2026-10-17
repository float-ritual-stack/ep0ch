import { expect, test } from "bun:test";
import { findOutputRegions, maskOutputRegions, outputHash, outputRegionText } from "../src/output-region";

const region = (body: string) => outputRegionText({ label: "weekly", producer: "aaaaaaaa-1111-4222-8333-444444444444", anchor: "out-weekly-7c2e", body });

test("a region is found, hashed and, once its body changes, edited (PIE-956)", () => {
  const text = `Note\n\n${region("one\ntwo")}\n\nafter`;
  const [r] = findOutputRegions(text);
  expect(r).toMatchObject({ type: "output", label: "weekly", anchor: "out-weekly-7c2e", body: "one\ntwo", edited: false });
  expect(findOutputRegions(text.replace("> one", "> one!"))[0]!.edited).toBe(true);
});

test("indenting a body line is an edit: prose turned into code is the person's", () => {
  expect(outputHash("x")).not.toBe(outputHash("    x"));
  expect(outputHash("x\n")).toBe(outputHash("x"));
  expect(findOutputRegions(region("x").replace("> x", ">     x"))[0]!.edited).toBe(true);
});

test("a `>` line in a longer code fence is code: the fence's own closer is the only one", () => {
  const text = "Title\n\n````md\n```\n````\n\n> [!output]- example\n> [status::done]";
  expect(findOutputRegions(text)).toHaveLength(1);
  const fenced = "Title\n\n````md\n```\n> [!output]- inside a fence\n> [status::done]\n````";
  expect(findOutputRegions(fenced)).toEqual([]);
  expect(maskOutputRegions(text)).not.toContain("status");
  expect(maskOutputRegions(fenced)).toContain("status");
});

test("a body line that looks like a header stays inside its region and its hash holds", () => {
  const [r, ...rest] = findOutputRegions(region("[!output]- literal\nx"));
  expect(rest).toEqual([]);
  expect(r!.edited).toBe(false);
});
