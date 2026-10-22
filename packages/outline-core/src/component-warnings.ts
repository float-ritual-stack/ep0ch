// What a note's `::` components will draw, said when the note is written (PIE-721) instead of found only when someone
// draws it: the components it holds (a write's confirmation), a `::name` that is a typo of one (with the one it may
// mean), a figure whose YAML doesn't read, a YAML key its component doesn't take that is a typo of one it does, and a
// value outside what a property takes. A component is known by the opener its own schema writes (`source.use`), so an
// extension's `::forecast` is found by its name, not its id. Read with the door's own figure reader (figure-props.ts)
// and the merged schemas, so it says what the drawing would; a figure written without its `---` lines is
// syntax-warnings.ts's to say. Never a reason to refuse a write: what is written always lands. Pure: no I/O.

import { COMPONENT_OPEN, componentBlocks } from "./component-block";
import { checkValue, type ComponentSchema } from "./component-schema";
import { figureProps, figureSource, figureYaml, graphKind } from "./figure-props";
import { closest } from "./tool-args";

export interface ComponentReading {
  /** The components the text holds, by id, in the order written, each once. */
  components: string[];
  /** A sentence for each thing that won't draw as written, with what to write instead when there is one. */
  warnings: string[];
}

/** The `::name` a component is written with: the opener its own source writes, or null for one written otherwise (a callout's `> [!…]`, a property, a line). */
export function blockNameOf(schema: ComponentSchema): string | null {
  return COMPONENT_OPEN.exec(schema.source.use.split("\n", 1)[0]!)?.[1] ?? null;
}

/** A figure's top-level YAML keys, as written: their values are the parsed YAML's (a comment, quotes and `{{ }}` read as YAML reads them). */

/** What the text's components are and what in them won't draw as written; `schemas` are the outline's merged ones. */
export function componentReading(text: string, schemas: readonly ComponentSchema[]): ComponentReading {
  const lines = text.split("\n");
  const byName = new Map(schemas.flatMap(s => { const name = blockNameOf(s); return name ? [[name, s] as const] : []; }));
  const names = [...byName.keys()];
  const components: string[] = [], warnings: string[] = [];
  for (const block of componentBlocks(lines)) {
    const at = `the ::${block.name} on line ${block.start + 1}`;
    const schema = byName.get(block.name);
    if (!schema) {
      // Only a name plainly meant as one: a near miss of a component's, or a figure's. Any other `::name` may be an
      // extension's whose schema the outline doesn't have, and is left alone.
      const near = closest(block.name, names);
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
    // The keys and values as the figure reads its YAML: a quoted key, a flow map and a boolean are what they parse to.
    const yaml = (figureYaml(src) as { yaml: Record<string, unknown> }).yaml;
    const props = schema.props.filter(p => p.where === "yaml");
    const known = props.map(p => p.key);
    for (const [key, value] of Object.entries(yaml)) {
      const prop = props.find(p => p.key === key);
      if (!prop) {
        const near = closest(key, known);
        if (near) warnings.push(`${at} doesn't take ${key}: did you mean ${near}?`);
        continue;
      }
      // A scalar as YAML read it; a `{{ }}` value is the Site's to fill when the figure is drawn.
      if ((typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") || String(value).includes("{{")) continue;
      const wrong = checkValue(prop, String(value));
      if (wrong) warnings.push(`${at}: ${wrong}`);
    }
    // A list written in the YAML whose items take named keys (a stat's tile): a near miss there draws a static tile.
    for (const prop of props.filter(p => p.each?.length && p.key in yaml)) {
      const each = prop.each!.map(e => e.key), told = new Set<string>();
      for (const item of Array.isArray(yaml[prop.key]) ? yaml[prop.key] as unknown[] : []) {
        if (!item || typeof item !== "object") continue;
        for (const key of Object.keys(item).filter(k => !each.includes(k) && !told.has(k))) {
          const near = closest(key, each);
          if (near) { told.add(key); warnings.push(`${at}: its ${prop.key} don't take ${key}: did you mean ${near}?`); }
        }
      }
    }
  }
  return { components, warnings };
}
