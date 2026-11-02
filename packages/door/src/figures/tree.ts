/** The tree figure and navigable trees share branch drawing and traversal. */
export function treeRows<T>(nodes: readonly T[], children: (node: T) => readonly T[]): { node: T; lead: string }[] {
  const rows: { node: T; lead: string }[] = [];
  const walk = (level: readonly T[], lead: string) => level.forEach((node, i) => {
    const last = i === level.length - 1;
    rows.push({ node, lead: lead + (last ? "└─ " : "├─ ") });
    walk(children(node), lead + (last ? "   " : "│  "));
  });
  walk(nodes, ""); return rows;
}
