import { parsePropertyDirectiveLines } from "./property-parse";
import { propertyTokenMatches } from "./property-grammar";

export interface ShellLine { shell: "sh" | "nu"; command: string; line: number; anchor?: string; open: boolean }
const KEYS = new Set(["sh", "nu"]);

export function shellLines(text: string): ShellLine[] {
  return parsePropertyDirectiveLines(text, KEYS).map(line => {
    let command = line.rawValue;
    const anchor = /\s\^(step-[a-z0-9-]+)\s*$/.exec(command)?.[1];
    if (anchor) command = command.replace(/\s\^step-[a-z0-9-]+\s*$/, "");
    let open = false;
    for (const token of propertyTokenMatches(command).reverse()) if (token.key === "run" && !command.slice(token.end).trim()) {
      open = token.value === "open";
      command = command.slice(0, token.start) + command.slice(token.end);
    }
    return { shell: line.key as "sh" | "nu", command: command.trimEnd(), line: line.line, anchor, open };
  });
}

/** Only an unquoted trailing chain belongs to ep0ch; shell pipes and quoted words stay byte for byte. */
export function shellStages(command: string): { command: string; stages: string[] } {
  let quote = "";
  for (let i = 0; i < command.length; i++) {
    const char = command[i]!;
    if (char === "\\" && quote !== "'") { i++; continue; }
    if (char === quote) { quote = ""; continue; }
    if (!quote && (char === '"' || char === "'" || char === "`")) { quote = char; continue; }
    if (quote || char !== "|") continue;
    const tail = command.slice(i);
    if (!/^(?:\|\s+as\s+[a-zA-Z][\w-]*\s*)+$/.test(tail)) continue;
    return { command: command.slice(0, i).trimEnd(), stages: [...tail.matchAll(/\|\s+as\s+([a-zA-Z][\w-]*)/g)].map(m => m[1]!) };
  }
  return { command, stages: [] };
}
