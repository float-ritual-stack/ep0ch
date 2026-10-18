/** KEY=value lines (quotes taken off, # comments skipped). */
export function parseEnvFile(text: string): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const line of text.split("\n")) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trimStart().startsWith("#")) out[m[1]!] = m[2]!.replace(/^(["'])(.*)\1$/, "$2");
  }
  return out;
}

