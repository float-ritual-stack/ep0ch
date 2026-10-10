// Jira's resource provider as its extension folder declares it (extensions/jira/extension.json), in the process-wide
// `key::` table, for tests that read `jira::` lines without a service whose registry would put it there.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useResourceDirectiveProviders, type ResourceProviderEntry } from "../src/resource-references";

const manifest = JSON.parse(readFileSync(join(import.meta.dir, "..", "extensions", "jira", "extension.json"), "utf8")) as {
  name: string; handlers: Array<{ key: string; kind: string; keyPattern?: string; fields?: string[]; link?: string }>;
};
const handler = manifest.handlers.find((candidate) => candidate.kind === "resource")!;

export const JIRA_PROVIDER: ResourceProviderEntry = {
  provider: "ext:jira", key: handler.key, label: manifest.name,
  ...(handler.keyPattern ? { keyPattern: handler.keyPattern } : {}),
  ...(handler.fields ? { fields: handler.fields } : {}),
  ...(handler.link ? { link: handler.link } : {}),
};

/** Jira's `jira::` lines read as a service with the Jira extension reads them. */
export function useJiraProvider(): void {
  useResourceDirectiveProviders("test-jira", [JIRA_PROVIDER]);
}
