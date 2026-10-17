import { expect, test } from "bun:test";
import {
  resolveContextKey,
  type ContextBlock,
  type ContextKeyMatcher,
} from "@ep0ch/outline-core/scope-walk";
import { previewPropertyParse } from "../src/properties";
import { parsePropertyDirectiveLines, parsePropertyRecords } from "@ep0ch/outline-core/property-parse";
import {
  authoredResourceReferenceOccurrences,
  mayHaveResourceProjections,
  providerKeyOccurrences,
  resourceDirectiveOccurrences,
  resourceDirectiveProviders,
} from "../src/resource-references";
import { useJiraProvider } from "./resource-providers";

// Fictional tickets: a Source claims project ACME; nothing claims PIE.
useJiraProvider();
const jira = resourceDirectiveProviders()[0]!;
const acme: ContextKeyMatcher = {
  propertyKey: "jira",
  keysIn: (text) => providerKeyOccurrences(jira, text).filter((key) => key.key.startsWith("ACME-")),
  keyFromProperty: (value) => jira.keyPattern.test(value.trim().toUpperCase()) ? value.trim().toUpperCase() : null,
};

function resolve(text: string, line: number, ancestors: ContextBlock[] = [], explicitKey?: string) {
  return resolveContextKey({ block: { id: "self", text }, line, ancestors, matcher: acme, ...(explicitKey ? { explicitKey } : {}) });
}

test("provider lines accept bullets and empty directives; nonempty values also have property scope", () => {
  const text = [
    "Call about the rollout ACME-12",
    "- jira:: --comments",
    "jira::",
    "  * jira:: ACME-7 --compact --wat",
    "- status:: done",
    "status::",
    "`jira::` in code",
  ].join("\n");
  expect(resourceDirectiveOccurrences(text).map(({ line, explicitKey, options, indent }) =>
    ({ line, explicitKey, options, indent }))).toEqual([
    { line: 1, explicitKey: undefined, options: { comments: 5, unknown: [] }, indent: "" },
    { line: 2, explicitKey: undefined, options: { unknown: [] }, indent: "" },
    { line: 3, explicitKey: "ACME-7", options: { compact: true, unknown: ["--wat"] }, indent: "  " },
  ]);
  // Nonempty bulleted values are properties; empty directives stay provider-owned.
  expect(previewPropertyParse(text).tokens.map(({ key, value }) => ({ key, value }))).toEqual([{ key: "jira", value: "--comments" }, { key: "jira", value: "ACME-7 --compact --wat" }, { key: "status", value: "done" }]);
  expect(previewPropertyParse("- status:: done").tokens).toMatchObject([{ key: "status", value: "done", scope: "block" }]);
  expect(previewPropertyParse("status::").tokens).toEqual([]);
  expect(previewPropertyParse("jira:: --comments").tokens.map(({ key, value, scope }) => ({ key, value, scope })))
    .toEqual([{ key: "jira", value: "--comments", scope: "block" }]);
  // Only supplied provider keys are recognized as provider lines.
  expect(parsePropertyDirectiveLines(text, new Set(["status"])).map(({ line }) => line)).toEqual([4, 5]);
  expect(parsePropertyDirectiveLines(text, new Set())).toEqual([]);
});

test("an option-only provider line is not a malformed key, while other bad values still are", () => {
  const text = "Notes ACME-3\njira:: --comments\njira:: hello\n- jira:: ACME-9\njira:: ACME-4 --full";
  const occurrences = authoredResourceReferenceOccurrences(text);
  expect(occurrences.map((occurrence) => occurrence.kind === "authored-resource"
    ? occurrence.reference
    : occurrence.message)).toEqual([
    "Jira Resource key HELLO doesn't match its key pattern (^[A-Z][A-Z0-9_]*-[1-9][0-9]*$)",
    { kind: "ext:jira", key: "ACME-9" },
    { kind: "ext:jira", key: "ACME-4" },
  ]);
  // A preamble `jira:: KEY` is the ticket page's property, not a provider line.
  expect(resourceDirectiveOccurrences("Ticket page\njira:: ACME-5")).toEqual([]);
  // With options it is a provider line, even in the preamble.
  expect(resourceDirectiveOccurrences("Ticket page\njira:: ACME-2 --comments"))
    .toMatchObject([{ line: 1, explicitKey: "ACME-2", options: { comments: 5 } }]);
  expect(authoredResourceReferenceOccurrences("Ticket page\njira:: ACME-2 --comments"))
    .toMatchObject([{ kind: "authored-resource", reference: { kind: "ext:jira", key: "ACME-2" } }]);
  expect(mayHaveResourceProjections("Ticket page\njira:: ACME-5")).toBe(true);
  expect(mayHaveResourceProjections("Ticket page [status::open]")).toBe(false);
  expect(parsePropertyRecords("Ticket page\njira:: ACME-5")[0]!.scope).toBe("block");
});

test("keys count only when claimed and outside code", () => {
  // The workboard prefix and dates never resolve as tickets for this Source.
  expect(resolve("PIE-445 on 2026-09-28\njira::", 1)).toEqual({ kind: "none" });
  expect(resolve("Subject\n`ACME-4` in code\njira::", 2)).toEqual({ kind: "none" });
});

test("literal regions hide keys, while indented lines are prose", () => {
  expect(resolve(["Subject", "<!-- literal -->", "ACME-9 pasted", "<!-- /literal -->", "jira::"].join("\n"), 4)).toEqual({ kind: "none" });
  expect(resolve(["Subject", "```", "ACME-9", "```", "jira::"].join("\n"), 4)).toEqual({ kind: "none" });
  expect(resolve(["Subject", "", "    ACME-7 indented thought", "    jira::"].join("\n"), 3))
    .toMatchObject({ key: "ACME-7", site: { step: "preceding-line" } });
  expect(resourceDirectiveOccurrences(["S", "<!-- literal -->", "jira::", "<!-- /literal -->"].join("\n"))).toEqual([]);
});

