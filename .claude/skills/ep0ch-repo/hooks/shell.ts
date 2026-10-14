/**
 * Just enough of a shell command's shape for the guards and the sweep's read-only check: the simple commands in it,
 * each as words, with what wraps them taken off (`VAR=x`, `timeout 900`, `scripts/agent-env loki --`, `bash -c '…'`)
 * and a heredoc's body left out (a PR body that mentions `pkill` is not a pkill). Pure.
 */

/** The command lines of `command`: a backslash-newline joins two, and a heredoc's body is dropped. */
function linesOf(command: string): string[] {
  const out: string[] = []
  let until: string | null = null
  for (const line of command.replace(/\\\n/g, ' ').split('\n')) {
    if (until !== null) {
      if (line.trim() === until) until = null
      continue
    }
    out.push(line)
    until = heredocOf(line)
  }
  return out
}

/** The delimiter of a heredoc this line opens (`<<EOF`, `<<-'EOF'`), outside quotes and not `<<<`; else null. */
function heredocOf(line: string): string | null {
  let quote: string | null = null
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!
    if (quote) { if (c === quote) quote = null; else if (c === '\\' && quote === '"') i++; continue }
    if (c === '"' || c === "'") { quote = c; continue }
    if (c === '\\') { i++; continue }
    if (c === '<' && line[i + 1] === '<' && line[i + 2] !== '<' && line[i - 1] !== '<') {
      const m = /^<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/.exec(line.slice(i))
      if (m) return m[2]!
    }
  }
  return null
}

/** Where the `$(…)` that opens just before `from` closes (the index of its `)`), counting nested parentheses. */
function closingParen(line: string, from: number): number {
  let depth = 1
  for (let i = from; i < line.length; i++) {
    if (line[i] === '(') depth++
    else if (line[i] === ')' && --depth === 0) return i
  }
  return line.length
}

export type ShellOptions = {
  /** Look through wrappers (`timeout`, `env`, `sudo`, `xargs`, `bash -c '…'`) to the command they run. Default true. */
  unwrap?: boolean
}

/**
 * The words of each simple command: split at unquoted `;`, `&&`, `||`, `|`, `&` and newlines, quotes kept together
 * (and taken off). A `$(…)` or backtick substitution, inside double quotes too, is read as commands of its own.
 */
export function simpleCommands(command: string, options: ShellOptions = {}): string[][] {
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
      if (quote === "'") {
        if (c === quote) quote = null
        else word += c
        continue
      }
      if (quote === '"') {
        if (c === '"') quote = null
        else if (c === '\\' && i + 1 < line.length) word += line[++i]
        else if (c === '$' && line[i + 1] === '(') {
          const end = closingParen(line, i + 2)
          commands.push(...simpleCommands(line.slice(i + 2, end), options))
          i = end
        } else if (c === '`') {
          const end = line.indexOf('`', i + 1)
          commands.push(...simpleCommands(line.slice(i + 1, end < 0 ? line.length : end), options))
          i = end < 0 ? line.length : end
        } else word += c
        continue
      }
      if (c === '"' || c === "'") { quote = c; inWord = true; continue }
      if (c === '\\' && i + 1 < line.length) { word += line[++i]; inWord = true; continue }
      if (c === '#' && !inWord) break
      // `2>&1`: the & is the redirection's, not a separator.
      if (c === '&' && line[i - 1] === '>') { word += c; inWord = true; continue }
      if (c === ';' || c === '|' || c === '&' || c === '(' || c === ')' || c === '`' || c === '{' || c === '}') { endCommand(); continue }
      if (c === '$' && line[i + 1] === '(') { endCommand(); i++; continue }
      if (c === ' ' || c === '\t') { endWord(); continue }
      word += c
      inWord = true
    }
    endCommand()
  }
  return options.unwrap === false ? commands.map(dropKeywords).filter(w => w.length) : commands.flatMap(unwrap)
}

/** Shell keywords that come before a command (`if`, `then`, `do`, `!` …): not the command. */
const KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'fi', 'do', 'done', 'while', 'until', '!', 'case', 'esac'])

function dropKeywords(words: string[]): string[] {
  let i = 0
  while (i < words.length && KEYWORDS.has(words[i]!)) i++
  return words.slice(i)
}

/** Skips a wrapper's own options (`-u root`: `valued` names those that take the next word). */
function afterOptions(words: readonly string[], valued: readonly string[]): number {
  let i = 1
  while (i < words.length && words[i]!.startsWith('-')) i += valued.includes(words[i]!) ? 2 : 1
  return i
}

/** Words that run the rest as a command of their own: how many words of their own come first. */
const WRAPPERS: Record<string, (words: string[]) => number> = {
  sudo: w => afterOptions(w, ['-u', '-g', '-h', '-p', '-C', '-D', '-r', '-t', '-U']),
  xargs: w => afterOptions(w, ['-I', '-n', '-P', '-L', '-d', '-E', '-s', '-a']),
  nohup: () => 1, exec: () => 1, command: () => 1, time: () => 1,
  nice: w => afterOptions(w, ['-n']),
  env: words => { let i = 1; while (i < words.length && (words[i]!.startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]!))) i++; return i },
  timeout: words => afterOptions(words, ['-s', '-k', '--signal', '--kill-after']) + 1,
}

/** One simple command with what wraps it taken off; `sh -c '…'` is read as the commands in its string. */
function unwrap(words: string[]): string[][] {
  let rest = dropKeywords(words)
  for (;;) {
    while (rest.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(rest[0]!)) rest = rest.slice(1)
    if (!rest.length) return []
    const name = baseName(rest[0]!)
    const wrapper = Object.hasOwn(WRAPPERS, name) ? WRAPPERS[name] : undefined
    if (wrapper) { rest = rest.slice(wrapper(rest)); continue }
    // scripts/agent-env <name> [--test] [--parallel …] -- <command>
    if (name === 'agent-env') {
      const at = rest.indexOf('--')
      if (at < 0) return [rest]
      rest = rest.slice(at + 1)
      continue
    }
    // sh -c '…', bash -lc '…'
    if (['sh', 'bash', 'zsh', 'dash'].includes(name)) {
      const at = rest.findIndex((w, i) => i > 0 && /^-[A-Za-z]*c[A-Za-z]*$/.test(w))
      if (at > 0 && rest[at + 1] !== undefined) return simpleCommands(rest[at + 1]!)
    }
    return [rest]
  }
}

export function baseName(word: string): string {
  return word.slice(word.lastIndexOf('/') + 1)
}
