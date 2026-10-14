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
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text)
  if (!m) return null
  const globs = [...m[1]!.matchAll(/^\s*-\s*"?([^"\n]+?)"?\s*$/gm)].map(g => g[1]!)
  return globs.length ? { file, globs, body: text.slice(m[0].length).trim() } : null
}

/** A `paths:` glob as a pattern: `**` any depth, `*` within a folder, `{a,b}` either; `dir/**` also matches `dir`. */
function globPattern(glob: string): RegExp {
  let out = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!
    if (glob.startsWith('/**', i) && i + 3 === glob.length) { out += '(/.*)?'; i += 2 }
    else if (glob.startsWith('**', i)) { out += '.*'; i++ }
    else if (c === '*') out += '[^/]*'
    else if (c === '{') out += '('
    else if (c === '}') out += ')'
    else if (c === ',') out += '|'
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
  const here = rel(cwd)
  const paths = new Set<string>()
  if (here) paths.add(normal(here))
  // The wrappers' own words too (`scripts/agent-env … --` is a path), and what they run (`bash -c '…'`).
  for (const words of [...simpleCommands(command, { unwrap: false }), ...simpleCommands(command)]) {
    for (const word of words) {
      if (!word.includes('/')) continue
      if (/^[a-z]+:\/\//.test(word)) continue
      const w = word.replace(/^~(?=\/)/, '/~')
      if (w.startsWith('/')) {
        const inside = rel(w)
        if (inside !== null) { if (inside) paths.add(normal(inside)); continue }
        // Each tail of an absolute path elsewhere: /x/ep0ch/packages/door/… is tried as packages/door/… too.
        const parts = w.split('/').filter(Boolean)
        for (let i = 1; i < parts.length; i++) paths.add(parts.slice(i).join('/'))
      } else {
        paths.add(normal(here === null ? w : `${here}/${w}`))
        paths.add(normal(w))
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
