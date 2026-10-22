// What a note's components will draw, said when the note is written (PIE-721) instead of found only when someone draws it:
// the components it holds (a write's confirmation), a `::graph-` name that isn't a component (with the one it may mean),
// a figure whose YAML doesn't read, a YAML key its component doesn't take that is a typo of one it does, and a value
// outside what a property takes. Read with the door's own figure reader (figure-props.ts) and the merged schemas, so it
// says what the drawing would. Never a reason to refuse a write: what is written always lands. Pure: no I/O.

import { componentBlocks } from "./component-block";
import { checkValue, type ComponentSchema } from "./component-schema";
import { figureProps, figureSource, graphKind } from "./figure-props";

export interface ComponentReading {
  /** The components the text holds, by id, in the order written, each once. */
  components: string[];
  /** A sentence for each thing that won't draw as written, with what to write instead when there is one. */
  warnings: string[];
}

/** How many single-character edits turn `a` into `b` (Levenshtein), for a did-you-mean. */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const was = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = was;
    }
  }
  return row[b.length]!;
}

/** The name in `names` a typo of `wanted` most likely meant: within two edits (one for a short name), else none. */
export function nearestName(wanted: string, names: readonly string[]): string | undefined {
  const most = wanted.length <= 4 ? 1 : 2;
  let best: string | undefined, bestD = most + 1;
  for (const n of names) {
    const d = distance(wanted.toLowerCase(), n.toLowerCase());
    if (d > 0 && d < bestD) { best = n; bestD = d; }
  }
  return best;
}

/** A figure's top-level YAML keys and their scalar values, as written (a nested or listed value is left out). */
function yamlKeys(yaml: string): { key: string; value?: string }[] {
  const out: { key: string; value?: string }[] = [];
  for (const line of yaml.split("\n")) {
    const m = /^([A-Za-z][\w-]*):(?:[ \t]+(.*))?$/.exec(line);
    if (!m) continue;
    const raw = m[2]?.trim();
    const scalar = raw && !/^[[{|>&*!]/.test(raw) ? raw.replace(/^(["'])(.*)\1$/, "$2") : undefined;
    out.push({ key: m[1]!, ...(scalar !== undefined ? { value: scalar } : {}) });
  }
  return out;
}

/** What the text's components are and what in them won't draw as written; `schemas` are the outline's merged ones. */
export function componentReading(text: string, schemas: readonly ComponentSchema[]): ComponentReading {
  const lines = text.split("\n");
  const byId = new Map(schemas.map(s => [s.id, s]));
  const ids = [...byId.keys()];
  const components: string[] = [], warnings: string[] = [];
  for (const block of componentBlocks(lines)) {
    const at = `the ::${block.name} on line ${block.start + 1}`;
    const schema = byId.get(block.name);
    if (!schema) {
      // Only a name that is plainly meant as one: a figure's, or a near miss of a component's. Other `::name` blocks may be
      // an extension's own, which the outline draws by a name its schema doesn't carry.
      const near = nearestName(block.name, ids);
      if (near) warnings.push(`${at} isn't a component: did you mean ::${near}?`);
      else if (block.name.startsWith("graph-")) warnings.push(`${at} isn't a component (outline_components lists them); it is drawn as plain text`);
      continue;
    }
    if (!components.includes(schema.id)) components.push(schema.id);
    const kind = graphKind(block);
    if (!kind) continue;
    const src = figureSource(lines.slice(block.start + 1, block.end), undefined, false, block.attrs);
    const read = figureProps(kind, src);
    if ("error" in read) { warnings.push(`${at} doesn't draw: ${read.error}`); continue; }
    if (read.warning) warnings.push(`${at}: ${read.warning}`);
    const props = schema.props.filter(p => p.where === "yaml");
    const known = props.map(p => p.key);
    for (const { key, value } of yamlKeys(src.yaml)) {
      const prop = props.find(p => p.key === key);
      if (!prop) {
        const near = nearestName(key, known);
        if (near) warnings.push(`${at} doesn't take ${key}: did you mean ${near}?`);
        continue;
      }
      const wrong = value === undefined ? null : checkValue(prop, value);
      if (wrong) warnings.push(`${at}: ${wrong}`);
    }
  }
  return { components, warnings };
}
