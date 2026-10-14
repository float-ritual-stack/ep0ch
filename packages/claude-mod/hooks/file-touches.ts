import { FILE_TOOLS, lineCounts } from './tool-rows'

/**
 * The files this session touches, recorded in its outline (PIE-602): after each Edit or Write that ran, the
 * installed CLI's `agent touch-file` files it under [[recent-files]] › its day › its project › this session, one
 * block per file per session (the outliner's src/file-touches.ts owns that shape). This file is the pure half: what
 * a call says was touched, and the project it belongs to; register.ts runs the commands, since only it is handed `$`.
 */

/**
 * Whether the session has switched recording off: the `fileTouches` option or `PI_OUTLINER_FILE_TOUCHES` saying
 * off/false/no/0. Off wins over everything. Anything else (on, empty, unset) leaves it to the outline's globs
 * (PIE-870): recording was always on until Oct 14, when the edits of code drowned the plans and handoffs it was for,
 * and is now only where the Recent files page asks.
 */
export function fileTouchesOff(option: unknown, environment: string | undefined): boolean {
  const off = (v: unknown) => typeof v === 'string' && ['off', 'false', 'no', '0'].includes(v.trim().toLowerCase())
  return off(option) || off(environment)
}

/** The `[file-touches::<glob>]` values on the Recent files page's text: the areas whose touches are recorded. */
export function fileTouchGlobsOf(pageText: string): string[] {
  const prose = pageText.replace(/^(`{3,}|~{3,})[\s\S]*?^\1[ \t]*$/gm, '').replace(/`[^`\n]*`/g, '')
  return [...prose.matchAll(/\[file-touches::([^\]\n]+)\]/g)].map(m => m[1].trim()).filter(Boolean)
}

/**
 * A glob as a RegExp: `**` crosses folders (`**\/` also matches none), `*` and `?` stay in one, `{a,b}` is either (no `[ab]` classes).
 * One without a leading `/` matches anywhere in the path. The mod's hooks module can't use Bun.Glob (no Bun in the
 * engine) nor import the outliner, and the repo has no other glob code.
 */
export function globRegExp(glob: string): RegExp {
  let out = ''
  let braces = 0
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!
    if (c === '*') {
      if (glob[i + 1] === '*' && (i === 0 || glob[i - 1] === '/')) {
        if (glob[i + 2] === '/') { out += '(?:.*/)?'; i += 2 } else { out += '.*'; i += 1 }
      } else { out += '[^/]*'; while (glob[i + 1] === '*') i++ }
    } else if (c === '?') out += '[^/]'
    else if (c === '{') { out += '(?:'; braces++ }
    else if (c === '}' && braces) { out += ')'; braces-- }
    else if (c === ',' && braces) out += '|'
    else out += c.replace(/[.+^$()|\\[\]]/g, '\\$&').replace(/[{}]/g, '\\$&')
  }
  return new RegExp(`^${glob.startsWith('/') ? '' : '(?:.*/)?'}${out}$`)
}

/** Whether a touched file's absolute path falls in one of the page's globs (`~` is the home folder; `**\/plans/**` matches anywhere). */
export function touchAllowed(globs: readonly string[], path: string, home: string | undefined): boolean {
  return globs.some(glob => {
    const g = glob.startsWith('~/') && home ? `${home.replace(/\/+$/, '')}${glob.slice(1)}` : glob
    try { return globRegExp(g).test(path) } catch { return false }
  })
}

/** What one Edit or Write touched: the file, the lines it added and removed, and the file before it (first touch). */
export type Touch = { path: string; added: number; removed: number; original?: string }

/** The touch an Edit or Write's call and result say, or null (another tool, a denied or failed call, no path). */
export function touchOf(tool: string, input: unknown, result: unknown): Touch | null {
  if (!(FILE_TOOLS as readonly string[]).includes(tool)) return null
  const path = (input as { file_path?: unknown } | null)?.file_path
  if (typeof path !== 'string' || !path.startsWith('/')) return null
  const out = result && typeof result === 'object' && !Array.isArray(result) ? result as Record<string, unknown> : null
  if (!out) return null
  const counted = lineCounts(out) ?? { added: 0, removed: 0 }
  // The file as it was, for a file git doesn't track (no gitDiff), so its diff can be read later: empty for one made.
  const original = out.gitDiff ? undefined : typeof out.originalFile === 'string' ? out.originalFile : out.type === 'create' ? '' : undefined
  return { path, ...counted, ...(original !== undefined ? { original } : {}) }
}

/** `YYYY-MM-DD` of a time, in this machine's local time: the day a touch is filed under. */
export function localDay(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * The project a file belongs to: its git repository (`git rev-parse --show-toplevel`'s answer, `toplevel`), else the
 * session's folder when the file is in it, else the file's own folder. Named by the folder's name.
 */
export function projectOf(path: string, toplevel: string | null, cwd: string): { project: string; root: string } {
  const inside = (root: string) => path.startsWith(`${root.replace(/\/+$/, '')}/`)
  const root = toplevel?.trim() && inside(toplevel.trim()) ? toplevel.trim() : inside(cwd) ? cwd : path.slice(0, path.lastIndexOf('/')) || '/'
  const name = root.replace(/\/+$/, '').split('/').pop() || root
  return { project: name.replace(/[\]\n\r]/g, '_'), root }
}

/** The `agent touch-file` input for a touch. */
export function touchInputOf(t: Touch, p: { project: string; root: string }, session: string, at: number): Record<string, unknown> {
  return {
    path: t.path, project: p.project, projectRoot: p.root, session,
    at: new Date(at).toISOString(), day: localDay(at), added: t.added, removed: t.removed,
    ...(t.original !== undefined ? { original: t.original } : {}),
  }
}
