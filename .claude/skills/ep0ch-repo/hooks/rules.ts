/**
 * The path-scoped rules (`.claude/rules/*.md`, PIE-841) for what a Bash command touches. Claude Code loads a rule when
 * an agent reads a file its `paths:` match, never when it runs a command, so an agent that runs a test door from Bash
 * without opening a door file would miss door.md. Each rule's own `paths:` decide, so the rules stay the one place
 * that says where they apply. Pure: register.ts reads the files and attaches what this picks.
 */

import { simpleCommands } from './shell'

export type Rule = { file: string; globs: string[]; body: string }

/** A rule file: its `paths:` globs (frontmatter) and the text after the frontmatter. No `paths:`: null (it loads always). */
export function ruleOf(file: string, text: string): Rule | null {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text.replace(/\r\n/g, '\n'))
  if (!m) return null
  // The list under `paths:` (its `- "glob"` lines, quoted either way or not), up to the next key.
  const block = /^paths:\s*\n((?:[ \t]*-.*\n?)*)/m.exec(`${m[1]!}\n`)
  const globs = block ? [...block[1]!.matchAll(/^\s*-\s*(["']?)(.+?)\1\s*$/gm)].map(g => g[2]!) : []
  return globs.length ? { file, globs, body: text.replace(/\r\n/g, '\n').slice(m[0].length).trim() } : null
}

/** A `paths:` glob as a pattern: `**` any depth, `*` within a folder, `{a,b}` either; `dir/**` also matches `dir`. */
function globPattern(glob: string): RegExp {
  let out = ''
  let depth = 0
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!
    if (glob.startsWith('/**', i) && i + 3 === glob.length) { out += '(/.*)?'; i += 2 }
    else if (glob.startsWith('**/', i)) { out += '(.*/)?'; i += 2 }
    else if (glob.startsWith('**', i)) { out += '.*'; i++ }
    else if (c === '*') out += '[^/]*'
    else if (c === '{') { out += '('; depth++ }
    else if (c === '}' && depth) { out += ')'; depth-- }
    else if (c === ',' && depth) out += '|'
    else out += c.replace(/[.+?^$()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${out}$`)
}

/** `a/b/../c` → `a/c`; `./x` → `x`. */
function normal(path: string): string {
  const parts: string[] = []
  for (const p of path.split('/')) {
    if (p === '' || p === '.') continue
    if (p === '..') parts.pop()
    else parts.push(p)
  }
  return parts.join('/')
}

/**
 * The repository paths a command names, relative to the repository: the folder it runs in, and each word that looks
 * like a path (relative to that folder, or absolute). An absolute path outside this checkout (another checkout of
 * ep0ch, `~/projects/ep0ch/scripts/agent-env`) is read from each of its folders down, so it is matched too.
 */
export function pathsIn(command: string, cwd: string, root: string): string[] {
  const rel = (abs: string) => abs === root ? '' : abs.startsWith(`${root}/`) ? abs.slice(root.length + 1) : null
  const start = rel(cwd)
  const paths = new Set<string>()
  const at = (folder: string | null) => { if (folder) paths.add(normal(folder)) }
  at(start)
  // Read twice: with the wrappers' own words (`scripts/agent-env … --` is a path), and with what they run
  // (`bash -c '…'`). Each reading starts from the shell's folder, so a `cd` is followed once per reading.
  for (const reading of [simpleCommands(command, { unwrap: false }), simpleCommands(command)]) {
    let here = start
    for (const words of reading) {
      // `cd <dir> && …`: what follows runs there.
      if (words[0] === 'cd' && words[1] && !words[1].startsWith('-')) {
        const to = words[1].replace(/^~(?=\/)/, '/~')
        here = to.startsWith('/') ? rel(normal(to) ? `/${normal(to)}` : '/') : normal(`${here ?? ''}/${to}`)
        at(here)
        continue
      }
      for (const word of words) {
        // A path, or a file name in the folder the command runs in (`cat home.ts` in packages/door/src).
        const isFile = /^[\w.-]+\.[A-Za-z0-9]+$/.test(word)
        if (!word.includes('/') && !isFile) continue
        if (/^[a-z]+:\/\//.test(word)) continue
        const w = word.replace(/^~(?=\/)/, '/~')
        if (w.startsWith('/')) {
          const abs = `/${normal(w)}`
          const inside = rel(abs)
          if (inside !== null) { at(inside); continue }
          // Each tail of an absolute path elsewhere: /x/ep0ch/packages/door/… is tried as packages/door/… too.
          const parts = abs.split('/').filter(Boolean)
          for (let i = 1; i < parts.length; i++) paths.add(parts.slice(i).join('/'))
        } else if (here !== null) {
          at(`${here}/${w}`)
        } else if (!isFile) {
          // The shell is outside this checkout: a relative path is read from its root.
          at(w)
        }
      }
    }
  }
  return [...paths].filter(Boolean)
}

/** The rules whose `paths:` match one of `paths`, in the order given. */
export function rulesFor(paths: readonly string[], rules: readonly Rule[]): Rule[] {
  return rules.filter(rule => rule.globs.some(glob => {
    const pattern = globPattern(glob)
    return paths.some(p => pattern.test(p))
  }))
}

/** What the agent reads after the command's result: the rule, and why it is here. */
export function ruleContext(rule: Rule): string {
  return `${rule.file} applies to what this command touches (path-scoped rules load when a file is read, not when a command runs; the ep0ch-repo mod added it):\n\n${rule.body}`
}
