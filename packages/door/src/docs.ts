import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { outlinerRoot } from "./skills";

const REFERENCES = [
  { name: "scripts", title: "Scripts in a note", file: "docs/scripts.md" },
  { name: "extensions", title: "Extensions: the four kinds, and rules", file: "docs/extensions/README.md" },
] as const;

export const DOCS_USAGE = "  ep0ch docs [scripts|extensions]   list or read the scripting and extension references (no outline needed)";

export const docResources = () => REFERENCES.map(d => ({
  uri: `ep0ch://docs/${d.name}`, name: d.name, title: d.title, mimeType: "text/markdown",
}));

/** Repo links only survive when their target is also served; the rest keep their readable label. */
export function docResource(uri: unknown): { contents: { uri: string; mimeType: string; text: string }[] } | null {
  const base = typeof uri === "string" ? uri.split("#")[0] : uri;
  const doc = REFERENCES.find(d => base === `ep0ch://docs/${d.name}`);
  if (!doc) return null;
  const root = outlinerRoot();
  if (!root) throw new Error("The Outliner checkout wasn't found; run ep0ch doctor to check the installation.");
  const file = join(root, doc.file);
  const text = readFileSync(file, "utf8").replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (link, label: string, target: string) => {
    if (target.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(target)) return link;
    const [path, anchor] = target.split("#");
    const served = REFERENCES.find(d => resolve(root, d.file) === resolve(dirname(file), path!));
    return served ? `[${label}](ep0ch://docs/${served.name}${anchor ? `#${anchor}` : ""})` : label;
  });
  return { contents: [{ uri: `ep0ch://docs/${doc.name}`, mimeType: "text/markdown", text }] };
}

export function docsCommand(args: readonly string[]): number {
  if (!args.length) { console.log(REFERENCES.map(d => `${d.name}  ${d.title}`).join("\n")); return 0; }
  if (args.length !== 1 || !REFERENCES.some(d => d.name === args[0])) {
    console.error(`ep0ch: choose a reference with ep0ch docs scripts or ep0ch docs extensions\n${DOCS_USAGE}`);
    return 2;
  }
  try { console.log(docResource(`ep0ch://docs/${args[0]}`)!.contents[0]!.text); return 0; }
  catch (e) { console.error(`ep0ch: ${(e as Error).message}`); return 1; }
}
