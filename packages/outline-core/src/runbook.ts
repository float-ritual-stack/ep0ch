import { codeFenceLines, codeBlocks } from "./code-fence";
import { parsePropertyRecords } from "./property-parse";
import { PROPERTY_KEY_SOURCE, propertyTokenMatches } from "./property-grammar";

export interface RunbookNode { id: string; text: string; children?: RunbookNode[] }
export interface RunbookField { name: string; variable: string; secret: boolean; choices?: string[] }
export interface RunbookStep {
  block: string; root: string; anchor: string; line: number; title: string;
  command: string; cwd?: string; env: Record<string, string>; fields: RunbookField[];
  variables: string[]; problems: string[];
}
export interface RunbookPlan { steps: RunbookStep[] }
export type RunbookStatus = "starting" | "running" | "stopping" | "ok" | "failed" | "stopped" | "failed-to-start" | "lost";

const RUN = /^\s*run::(?:\s|$)/;
const ANCHOR = /(?:^|\s)\^(step-[a-z0-9-]+)\s*$/;
const REFERENCE = /\{\{(self|ask|secret)\.([A-Za-z_][A-Za-z0-9_.-]*)\}\}/g;
const property = (text: string, key: string) => parsePropertyRecords(text).find(p => p.scope === "block" && p.key === key)?.value;
export const isRunbook = (text: string) => parsePropertyRecords(text).some(p => p.scope === "block" && p.key === "type" && p.value === "runbook");

export function runnableFences(text: string) {
  const lines = text.split("\n"), literal = codeFenceLines(lines);
  const fences = codeBlocks(lines).fences.filter(f => f.closed && (/^(?:sh|bash|zsh)\s+run$/.test(f.fence.info) || RUN.test(lines[f.start - 1] ?? "")));
  const keyLine = new RegExp(`^\\s*${PROPERTY_KEY_SOURCE}::`);
  const claimed = new Set<number>();
  return fences.map(f => {
    const control = RUN.test(lines[f.start - 1] ?? "") ? f.start - 1 : f.start;
    const separate = /^\s*\^step-[a-z0-9-]+\s*$/.test(lines[control - 1] ?? "") ? control - 1 : -1;
    let titleLine = -1, title = "Step";
    for (let i = control - 1; i >= 0; i--) {
      if (literal[i] !== -1) continue;
      const line = lines[i]!.replace(ANCHOR, "").trim();
      if (!line || keyLine.test(line) || RUN.test(line) || /^(?:>|[-+*]\s|\d+[.)]\s|`{3,}|~{3,})/.test(line)) continue;
      let plain = line;
      for (const token of propertyTokenMatches(line).reverse()) plain = plain.slice(0, token.start) + plain.slice(token.end);
      if (!plain.trim()) continue;
      title = line.replace(/^#{1,6}\s+/, "");
      if (!claimed.has(i)) { titleLine = i; claimed.add(i); }
      break;
    }
    const anchorLine = separate >= 0 ? separate : titleLine;
    return { ...f, control, titleLine: anchorLine, title, anchor: ANCHOR.exec(lines[anchorLine] ?? "")?.[1] };
  });
}

/** Called by the save path: the address belongs to the authored fence, before any run exists. */
export function anchorRunbookSteps(text: string, used: Set<string>): string {
  const lines = text.split("\n");
  const edits = runnableFences(text).map(f => {
    const base = f.anchor ?? `step-${f.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "command"}`;
    let anchor = base, suffix = 2;
    while (used.has(anchor)) anchor = `${base}-${suffix++}`;
    used.add(anchor);
    return { ...f, anchor };
  });
  for (const f of edits.reverse()) {
    if (f.titleLine >= 0) {
      const title = lines[f.titleLine]!.replace(ANCHOR, "");
      lines[f.titleLine] = title.trim() ? title + ` ^${f.anchor}` : `^${f.anchor}`;
    }
    else lines.splice(f.control, 0, `^${f.anchor}`);
  }
  return lines.join("\n");
}

/** Command references are shell data even inside an existing single or double quoted word. */
function commandReferences(text: string, use: (kind: string, name: string) => string): string {
  let quote = "", out = "", at = 0;
  for (const m of text.matchAll(REFERENCE)) {
    const before = text.slice(at, m.index);
    for (let i = 0; i < before.length; i++) {
      const c = before[i]!;
      if (c === "\\" && quote !== "'") { i++; continue; }
      if (c === quote) quote = "";
      else if (!quote && (c === "'" || c === '"')) quote = c;
    }
    const variable = '${' + use(m[1]!, m[2]!) + '}';
    out += before + (quote === '"' ? variable : quote === "'" ? `'"${variable}"'` : `"${variable}"`);
    at = m.index + m[0].length;
  }
  return out + text.slice(at);
}

/** The runbook's own text, then children depth first; context follows document order, not ancestry. */
export function runbookSteps(root: RunbookNode): RunbookStep[] {
  if (!isRunbook(root.text)) return [];
  const steps: RunbookStep[] = [];
  let cwd = property(root.text, "cwd");
  const env: Record<string, string> = {}, invalid = new Map<string, string>();
  const walk = (node: RunbookNode) => {
    if (property(node.text, "type") === "run") return;
    const lines = node.text.split("\n"), fences = codeBlocks(lines).fences;
    const starts = new Map(fences.map(f => [f.start, f]));
    const runnable = new Map(runnableFences(node.text).map(f => [f.start, f]));
    for (let i = 0; i < lines.length; i++) {
      const f = starts.get(i), line = lines[i]!;
      if (!f) {
        const folder = /^\s*cwd::\s*(.*)$/.exec(line);
        if (folder) cwd = folder[1]!;
        continue;
      }
      if (f.fence.info === "env") {
        for (const value of lines.slice(f.start + 1, f.end)) {
          if (!value.trim() || /^\s*#/.test(value)) continue;
          const pair = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(value);
          if (!pair) { invalid.set(value, `Invalid env line: ${value}. Write KEY=value (literal text).`); continue; }
          env[pair[1]!] = pair[2]!;
        }
      }
      const step = runnable.get(i);
      if (step) {
        const bindings = new Map<string, string>();
        const fields = new Map<string, RunbookField>(), variables = new Set<string>(), problems = [...invalid.values()];
        const own: Record<string, string> = {};
        const use = (kind: string, name: string) => {
          const ref = `${kind}.${name}`;
          variables.add(ref);
          const key = bindings.get(ref) ?? `RUNBOOK_VALUE_${bindings.size}`;
          bindings.set(ref, key);
          if (kind === "self") {
            const value = property(root.text, name);
            if (value === undefined) problems.push(`Missing {{${ref}}}: set [${name}::value] on the runbook.`);
            else own[key] = value;
          } else if (!fields.has(ref)) {
            const choices = property(node.text, "choices") ?? property(root.text, "choices");
            fields.set(ref, { name: ref, variable: key, secret: kind === "secret", ...(choices?.startsWith(name + " ") ? { choices: choices.slice(name.length + 1).split(",").map(s => s.trim()) } : {}) });
          }
          return key;
        };
        const literal = (value: string) => value.replace(REFERENCE, (_, kind: string, name: string) => `{{${use(kind, name)}}}`);
        const command = commandReferences(lines.slice(f.start + 1, f.end).join("\n"), use);
        const folder = cwd === undefined ? undefined : literal(cwd);
        const values = Object.fromEntries(Object.entries(env).map(([k, v]) => [k, literal(v)]));
        const flags = step.control < f.start ? lines[step.control]! : "";
        const override = /--cwd=(?:"([^"]*)"|'([^']*)'|(\S+))/.exec(flags);
        steps.push({ root: root.id, block: node.id, anchor: step.anchor ?? "", line: step.control, title: step.title,
          command, ...(folder !== undefined || override ? { cwd: override ? literal(override[1] ?? override[2] ?? override[3]!) : folder } : {}),
          env: { ...values, ...own }, fields: [...fields.values()], variables: [...Object.keys(env), ...variables], problems });
      }
      i = f.end;
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(root);
  return steps;
}
