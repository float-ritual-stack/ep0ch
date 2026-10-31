import { componentAttrs, type ComponentBlock } from "./component-block";
import { figureSource, figureYaml } from "./figure-props";
import { splitPropertyValue } from "./property-grammar";

export interface ViewSpec { props: Record<string, unknown>; args?: Record<string, string>; key?: string; error?: string }

/** Both spellings read the same record. A graph-table with authored rows remains a static figure. */
export function viewSpec(block: ComponentBlock, lines: readonly string[]): ViewSpec | null {
  if (block.name !== "view" && block.name !== "graph-table") return null;
  const yaml = figureYaml(figureSource(lines.slice(block.start + 1, block.end), undefined, false, block.attrs));
  const attrs = Object.fromEntries(componentAttrs(block.attrs ?? "").pairs.map(p => [p.key, p.value]));
  const props = { ...attrs, ...("yaml" in yaml ? yaml.yaml : {}) };
  if (block.name === "graph-table" && !props.query && !props.view) return null;
  return { props: block.name === "graph-table" ? { ...props, layout: "table", ...(props.view ? { of: props.view } : {}), ...(props.columns ? { "summary-properties": props.columns } : {}) } : props,
    args: attrs, ...(block.id ? { key: `^${block.id}` } : {}), ...("error" in yaml ? { error: yaml.error } : {}) };
}

export const viewWords = (value: unknown): string[] => value === undefined ? [] : Array.isArray(value) ? value.map(String) : splitPropertyValue(String(value).startsWith("[") ? String(value) : `[${value}]`);
