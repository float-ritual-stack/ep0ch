/**
 * Just enough of a shell command's shape for the guards and the sweep's read-only check: the simple commands in it,
 * each as words, with what wraps them taken off (`VAR=x`, `timeout 900`, `scripts/agent-env loki --`, `bash -c '…'`)
 * and a heredoc's body left out (a PR body that mentions `pkill` is not a pkill). Pure.
 */

/** The command lines of `command`, a heredoc's body dropped. */
function linesOf(command: string): string[] {
  const out: string[] = []
  let until: string | null = null
  for (const line of command.split('\n')) {
    if (until !== null) {
      if (line.trim() === until) until = null
      continue
    }
    out.push(line)
    const heredoc = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/.exec(line)
    if (heredoc) until = heredoc[2]!
  }
  return out
}

/**
 * The words of each simple command: split at unquoted `;`, `&&`, `||`, `|`, `&` and newlines, quotes kept together
 * (and taken off), `$(…)` and backticks read as words of their own command too.
 */
export function simpleCommands(command: string): string[][] {
  const commands: string[][] = []
  for (const line of linesOf(command)) {
    let words: string[] = []
    let word = ''
    let inWord = false
    let quote: '"' | "'" | null = null
    const endWord = () => { if (inWord) words.push(word); word = ''; inWord = false }
    const endCommand = () => { endWord(); if (words.length) commands.push(words); words = [] }
    for (let i = 0; i < line.length; i++) {
      const c = line[i]!
      if (quote) {
        if (c === quote) quote = null
        else if (c === '\\' && quote === '"' && i + 1 < line.length) word += line[++i]
        else word += c
        continue
      }
      if (c === '"' || c === "'") { quote = c; inWord = true; continue }
      if (c === '\\' && i + 1 < line.length) { word += line[++i]; inWord = true; continue }
      if (c === '#' && !inWord) break
      if (c === ';' || c === '|' || c === '&' || c === '(' || c === ')' || c === '`') { endCommand(); continue }
      if (c === '$' && line[i + 1] === '(') { endCommand(); i++; continue }
      if (c === ' ' || c === '\t') { endWord(); continue }
      word += c
      inWord = true
    }
    endCommand()
  }
  return commands.flatMap(unwrap)
}

/** Words that run the rest as a command of their own, and how many of their own arguments they take first. */
const WRAPPERS: Record<string, (words: string[]) => number | null> = {
  sudo: () => 1, nohup: () => 1, exec: () => 1, command: () => 1, nice: () => 1, time: () => 1, xargs: () => 1,
  env: words => { let i = 1; while (i < words.length && (words[i]!.startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]!))) i++; return i },
  timeout: words => { let i = 1; while (i < words.length && words[i]!.startsWith('-')) i++; return i + 1 },
}

/** One simple command with what wraps it taken off; `sh -c '…'` is read as the commands in its string. */
function unwrap(words: string[]): string[][] {
  let rest = words
  for (;;) {
    while (rest.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(rest[0]!)) rest = rest.slice(1)
    if (!rest.length) return []
    const name = baseName(rest[0]!)
    const wrapper = WRAPPERS[name]
    if (wrapper) { rest = rest.slice(wrapper(rest) ?? 1); continue }
    // scripts/agent-env <name> [--test] [--parallel …] -- <command>
    if (name === 'agent-env') {
      const at = rest.indexOf('--')
      if (at < 0) return [rest]
      rest = rest.slice(at + 1)
      continue
    }
    if ((name === 'sh' || name === 'bash' || name === 'zsh') && rest[1] === '-c' && rest[2] !== undefined) return simpleCommands(rest[2])
    return [rest]
  }
}

export function baseName(word: string): string {
  return word.slice(word.lastIndexOf('/') + 1)
}
