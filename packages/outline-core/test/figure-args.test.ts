// PIE-533 S1: a figure's call-site arguments (`::graph-table{project=lego}`) and a `{{ }}` that starts a YAML value.
import { expect, test } from "bun:test";
import { componentBlocks } from "../src/component-block";
import { figureProps, figureSource, graphKind, quoteBraces } from "../src/figure-props";

const lines = ["::graph-table{project=lego title=\"Lego night\"}", "---", "columns: [title]", "title: {{this.title}}", "---", "::"];

test("a figure with {…} arguments is still a figure, and its arguments are props under its YAML", () => {
  const [block] = componentBlocks(lines);
  expect(graphKind(block!)).toBe("table");
  const src = figureSource(lines.slice(block!.start + 1, block!.end), undefined, undefined, block!.attrs);
  const read = figureProps("table", src);
  if ("error" in read) throw new Error(read.error);
  expect(read.args).toEqual({ project: "lego", title: "Lego night" });
  // The YAML wins where both say a prop; the argument fills what the YAML leaves open.
  expect(read.props.project).toBe("lego");
  expect(read.props.title).toBe("{{this.title}}");
});

test("a plain YAML value that starts with {{ is text, not a flow map", () => {
  expect(quoteBraces("of: {{parent.x}}\n- {{this.a}} and more\nplain: 1")).toBe('of: "{{parent.x}}"\n- "{{this.a}} and more"\nplain: 1');
  expect(Bun.YAML.parse(quoteBraces('where: "a"\ntitle: {{this.title}}'))).toEqual({ where: "a", title: "{{this.title}}" });
});
